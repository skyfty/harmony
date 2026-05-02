import * as THREE from 'three'
import { PHYSICS_SCENE_ASSET_VERSION, type PhysicsBodyDesc, type PhysicsBodyType, type PhysicsCompoundChildDesc, type PhysicsMaterialDesc, type PhysicsSceneAsset, type PhysicsShapeDesc, type PhysicsTransform, type PhysicsVector3, type PhysicsVehicleDesc, type PhysicsVehicleWheelDesc } from '@harmony/physics-core'
import type { SceneJsonExportDocument, SceneNode, SceneNodeComponentState, Vector3Like } from './index'
import { buildBoundaryWallSegments } from './boundaryWall'
import { buildAdaptiveGroundCollisionData, isGroundDynamicMesh } from './groundHeightfield'
import { resolveFloorShape, resolveModelCollisionFaceSegments, resolveWallShape, type FloorShapeCache, type WallTrimeshCache } from './physicsEngine'
import {
  BOUNDARY_WALL_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  VEHICLE_COMPONENT_TYPE,
  clampBoundaryWallComponentProps,
  clampRigidbodyComponentProps,
  resolveModelCollisionComponentPropsFromNode,
  clampVehicleComponentProps,
  type BoundaryWallComponentProps,
  type RigidbodyComponentMetadata,
  type RigidbodyComponentProps,
  type RigidbodyPhysicsShape,
  type VehicleComponentProps,
} from './components'

type BuildShapeInstance = {
  shapeId: number
  transform: PhysicsTransform
}

const matrix4Helper = new THREE.Matrix4()
const parentWorldMatrixHelper = new THREE.Matrix4()
const nodePositionHelper = new THREE.Vector3()
const nodeScaleHelper = new THREE.Vector3()
const nodeQuaternionHelper = new THREE.Quaternion()
const nodeEulerHelper = new THREE.Euler()
const worldPositionHelper = new THREE.Vector3()
const worldQuaternionHelper = new THREE.Quaternion()
const worldScaleHelper = new THREE.Vector3()
const identityPhysicsRotation: PhysicsTransform['rotation'] = [0, 0, 0, 1]

function createEmptyPhysicsSceneAsset(): PhysicsSceneAsset {
  return {
    format: 'harmony-physics',
    version: PHYSICS_SCENE_ASSET_VERSION,
    materials: [],
    shapes: [],
    bodies: [],
    vehicles: [],
  }
}

function toPhysicsVector3(vector: Vector3Like | null | undefined, fallback: PhysicsVector3 = [0, 0, 0]): PhysicsVector3 {
  if (!vector || typeof vector !== 'object') {
    return fallback
  }
  const x = typeof vector.x === 'number' && Number.isFinite(vector.x) ? vector.x : fallback[0]
  const y = typeof vector.y === 'number' && Number.isFinite(vector.y) ? vector.y : fallback[1]
  const z = typeof vector.z === 'number' && Number.isFinite(vector.z) ? vector.z : fallback[2]
  return [x, y, z]
}

function toPhysicsTransform(position: THREE.Vector3, rotation: THREE.Quaternion): PhysicsTransform {
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  }
}

function getPositiveScale(node: SceneNode): THREE.Vector3 {
  const scale = toPhysicsVector3(node.scale, [1, 1, 1])
  return new THREE.Vector3(
    Math.max(1e-4, Math.abs(scale[0])),
    Math.max(1e-4, Math.abs(scale[1])),
    Math.max(1e-4, Math.abs(scale[2])),
  )
}

function getNodeLocalMatrix(node: SceneNode): THREE.Matrix4 {
  const position = toPhysicsVector3(node.position)
  const rotation = toPhysicsVector3(node.rotation)
  nodePositionHelper.set(position[0], position[1], position[2])
  nodeEulerHelper.set(rotation[0], rotation[1], rotation[2], 'XYZ')
  nodeQuaternionHelper.setFromEuler(nodeEulerHelper).normalize()
  nodeScaleHelper.copy(getPositiveScale(node))
  return matrix4Helper.compose(nodePositionHelper, nodeQuaternionHelper, nodeScaleHelper).clone()
}

function mapBodyType(type: RigidbodyComponentProps['bodyType']): PhysicsBodyType {
  if (type === 'STATIC') {
    return 'static'
  }
  if (type === 'KINEMATIC') {
    return 'kinematic'
  }
  return 'dynamic'
}

function resolveRigidbodyComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<RigidbodyComponentProps> | null {
  const state = node?.components?.[RIGIDBODY_COMPONENT_TYPE] as SceneNodeComponentState<RigidbodyComponentProps> | undefined
  if (!state || state.enabled === false) {
    return null
  }
  return state
}

function resolveBoundaryWallComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<BoundaryWallComponentProps> | null {
  const state = node?.components?.[BOUNDARY_WALL_COMPONENT_TYPE] as SceneNodeComponentState<BoundaryWallComponentProps> | undefined
  if (!state || state.enabled === false) {
    return null
  }
  return state
}

function resolveVehicleComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<VehicleComponentProps> | null {
  const state = node?.components?.[VEHICLE_COMPONENT_TYPE] as SceneNodeComponentState<VehicleComponentProps> | undefined
  if (!state || state.enabled === false) {
    return null
  }
  return state
}

function extractRigidbodyShape(
  component: SceneNodeComponentState<RigidbodyComponentProps> | null,
): RigidbodyPhysicsShape | null {
  if (!component) {
    return null
  }
  const payload = component.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined
  return payload?.shape ?? null
}

function resolvePhysicsSceneRigidbodyComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<RigidbodyComponentProps> | null {
  const rigidbodyComponent = resolveRigidbodyComponent(node)
  if (rigidbodyComponent) {
    return rigidbodyComponent
  }
  if (!node) {
    return null
  }
  const hasBoundaryWall = Boolean(resolveBoundaryWallComponent(node))
  const hasWall = node.dynamicMesh?.type === 'Wall'
  const hasFloor = node.dynamicMesh?.type === 'Floor'
  const hasModelCollision = Boolean(resolveModelCollisionComponentPropsFromNode(node)?.faces?.length)
  if (!hasBoundaryWall && !hasWall && !hasFloor && !hasModelCollision) {
    return null
  }
  return {
    id: `__physicsSceneAssetRigidbody:${node.id}`,
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: true,
    props: clampRigidbodyComponentProps({
      bodyType: 'STATIC',
      targetNodeId: node.id ?? null,
    }),
  }
}

function scaleShapeOffset(shape: RigidbodyPhysicsShape, worldScale: THREE.Vector3): PhysicsVector3 {
  const [ox = 0, oy = 0, oz = 0] = shape.offset ?? [0, 0, 0]
  return [ox * worldScale.x, oy * worldScale.y, oz * worldScale.z]
}

function toCanonicalHeightfieldOffset(offset: PhysicsVector3): PhysicsVector3 {
  return [offset[0], offset[2], -offset[1]]
}

function getShapeScale(shape: RigidbodyPhysicsShape, worldScale: THREE.Vector3): PhysicsVector3 {
  if (shape.applyScale !== true) {
    return [1, 1, 1]
  }
  return [worldScale.x, worldScale.y, worldScale.z]
}

function pushShapeDescriptor(
  shapes: PhysicsShapeDesc[],
  shape: PhysicsShapeDesc,
): number {
  shapes.push(shape)
  return shape.id
}

function buildShapeInstancesFromDefinition(
  shape: RigidbodyPhysicsShape,
  worldScale: THREE.Vector3,
  nextShapeId: () => number,
  shapes: PhysicsShapeDesc[],
): BuildShapeInstance[] {
  const scale = getShapeScale(shape, worldScale)
  const scaledOffset = scaleShapeOffset(shape, worldScale)

  if (shape.kind === 'box') {
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'box',
      halfExtents: [
        shape.halfExtents[0] * scale[0],
        shape.halfExtents[1] * scale[1],
        shape.halfExtents[2] * scale[2],
      ],
    })
    return [{ shapeId, transform: { position: scaledOffset, rotation: identityPhysicsRotation } }]
  }

  if (shape.kind === 'sphere') {
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'sphere',
      radius: shape.radius * Math.max(scale[0], scale[1], scale[2]),
    })
    return [{ shapeId, transform: { position: scaledOffset, rotation: identityPhysicsRotation } }]
  }

  if (shape.kind === 'cylinder') {
    const radiusScale = Math.max(scale[0], scale[2])
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'cylinder',
      radiusTop: shape.radiusTop * radiusScale,
      radiusBottom: shape.radiusBottom * radiusScale,
      height: shape.height * scale[1],
      segments: shape.segments,
    })
    return [{ shapeId, transform: { position: scaledOffset, rotation: identityPhysicsRotation } }]
  }

  if (shape.kind === 'convex') {
    const vertices = new Float32Array(shape.vertices.length * 3)
    shape.vertices.forEach((vertex, index) => {
      vertices[index * 3] = vertex[0] * scale[0]
      vertices[index * 3 + 1] = vertex[1] * scale[1]
      vertices[index * 3 + 2] = vertex[2] * scale[2]
    })
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'convex-hull',
      vertices,
    })
    return [{ shapeId, transform: { position: scaledOffset, rotation: identityPhysicsRotation } }]
  }

  if (shape.kind === 'heightfield') {
    const rows = shape.matrix[0]?.length ?? 0
    const columns = shape.matrix.length
    const values = new Float32Array(rows * columns)
    let minHeight = Number.POSITIVE_INFINITY
    let maxHeight = Number.NEGATIVE_INFINITY
    let index = 0
    for (let column = 0; column < columns; column += 1) {
      const columnValues = shape.matrix[column] ?? []
      for (let row = 0; row < rows; row += 1) {
        const value = columnValues[row] ?? 0
        values[index] = value * scale[1]
        index += 1
        minHeight = Math.min(minHeight, values[index - 1]!)
        maxHeight = Math.max(maxHeight, values[index - 1]!)
      }
    }
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'heightfield',
      rows,
      columns,
      elementSize: shape.elementSize * Math.max(scale[0], scale[2]),
      heights: values,
      minHeight: Number.isFinite(minHeight) ? minHeight : 0,
      maxHeight: Number.isFinite(maxHeight) ? maxHeight : 0,
      localOffset: toCanonicalHeightfieldOffset(scaledOffset),
    })
    return [{ shapeId, transform: { position: [0, 0, 0], rotation: identityPhysicsRotation } }]
  }

  return []
}

function buildBoundaryWallShapeInstances(
  node: SceneNode,
  nextShapeId: () => number,
  shapes: PhysicsShapeDesc[],
): BuildShapeInstance[] {
  const boundaryWallComponent = resolveBoundaryWallComponent(node)
  if (!boundaryWallComponent) {
    return []
  }
  const props = clampBoundaryWallComponentProps(boundaryWallComponent.props as Partial<BoundaryWallComponentProps> | null | undefined)
  const segments = buildBoundaryWallSegments({
    node,
    object: null,
    props,
  })
  const children: BuildShapeInstance[] = []
  segments.forEach((segment) => {
    const halfExtents = (segment.shape as { halfExtents?: { x?: number; y?: number; z?: number } }).halfExtents
    const hx = halfExtents?.x
    const hy = halfExtents?.y
    const hz = halfExtents?.z
    if (![hx, hy, hz].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      return
    }
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'box',
      halfExtents: [hx as number, hy as number, hz as number],
    })
    children.push({
      shapeId,
      transform: {
        position: [segment.offset[0], segment.offset[1], segment.offset[2]],
        rotation: [segment.orientation[0], segment.orientation[1], segment.orientation[2], segment.orientation[3]],
      },
    })
  })
  return children
}

function buildFloorShapeInstances(
  node: SceneNode,
  worldScale: THREE.Vector3,
  nextShapeId: () => number,
  shapes: PhysicsShapeDesc[],
  floorShapeCache: FloorShapeCache,
): BuildShapeInstance[] {
  if (node.dynamicMesh?.type !== 'Floor') {
    return []
  }
  const entry = resolveFloorShape(node, node.dynamicMesh, floorShapeCache)
  if (!entry) {
    return []
  }
  return entry.segments.flatMap((segment) => buildShapeInstancesFromDefinition(segment.shape, worldScale, nextShapeId, shapes))
}

function buildWallShapeInstances(
  node: SceneNode,
  nextShapeId: () => number,
  shapes: PhysicsShapeDesc[],
  wallShapeCache: WallTrimeshCache,
): BuildShapeInstance[] {
  if (node.dynamicMesh?.type !== 'Wall') {
    return []
  }
  const entry = resolveWallShape({
    node,
    definition: node.dynamicMesh,
    cache: wallShapeCache,
  })
  if (!entry) {
    return []
  }
  return entry.segments.flatMap((segment) => {
    const halfExtents = (segment.shape as { halfExtents?: { x?: number; y?: number; z?: number } }).halfExtents
    const hx = halfExtents?.x
    const hy = halfExtents?.y
    const hz = halfExtents?.z
    if (![hx, hy, hz].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      return []
    }
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'box',
      halfExtents: [hx as number, hy as number, hz as number],
    })
    return [{
      shapeId,
      transform: {
        position: [segment.offset[0], segment.offset[1], segment.offset[2]],
        rotation: [segment.orientation[0], segment.orientation[1], segment.orientation[2], segment.orientation[3]],
      },
    }]
  })
}

function buildModelCollisionShapeInstances(
  node: SceneNode,
  worldScale: THREE.Vector3,
  nextShapeId: () => number,
  shapes: PhysicsShapeDesc[],
): BuildShapeInstance[] {
  const modelCollisionComponent = resolveModelCollisionComponentPropsFromNode(node)
  if (!modelCollisionComponent?.faces?.length) {
    return []
  }
  return resolveModelCollisionFaceSegments({
    type: 'ModelCollision',
    faces: modelCollisionComponent.faces,
    defaultThickness: modelCollisionComponent.defaultThickness,
  }).flatMap((segment) => buildShapeInstancesFromDefinition(segment.shape, worldScale, nextShapeId, shapes))
}

function buildRigidbodyShapeInstances(
  node: SceneNode,
  worldScale: THREE.Vector3,
  nextShapeId: () => number,
  shapes: PhysicsShapeDesc[],
): BuildShapeInstance[] {
  if (isGroundDynamicMesh(node.dynamicMesh)) {
    const collisionData = buildAdaptiveGroundCollisionData(node, node.dynamicMesh)
    if (collisionData?.segments.length) {
      return collisionData.segments.map((segment) => {
        const values = new Float32Array((segment.rows + 1) * (segment.columns + 1))
        let minHeight = Number.POSITIVE_INFINITY
        let maxHeight = Number.NEGATIVE_INFINITY
        let offset = 0
        for (let column = 0; column < segment.matrix.length; column += 1) {
          const columnValues = segment.matrix[column] ?? []
          for (let row = 0; row < columnValues.length; row += 1) {
            const value = columnValues[row] ?? 0
            values[offset] = value
            offset += 1
            minHeight = Math.min(minHeight, value)
            maxHeight = Math.max(maxHeight, value)
          }
        }
        const shapeId = pushShapeDescriptor(shapes, {
          id: nextShapeId(),
          kind: 'heightfield',
          rows: segment.rows + 1,
          columns: segment.columns + 1,
          elementSize: segment.elementSize,
          heights: values,
          minHeight: Number.isFinite(minHeight) ? minHeight : 0,
          maxHeight: Number.isFinite(maxHeight) ? maxHeight : 0,
          localOffset: toCanonicalHeightfieldOffset([segment.offset[0], segment.offset[1], segment.offset[2]]),
        })
        return {
          shapeId,
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
          },
        }
      })
    }
  }

  const shape = extractRigidbodyShape(resolveRigidbodyComponent(node))
  if (!shape) {
    return []
  }
  return buildShapeInstancesFromDefinition(shape, worldScale, nextShapeId, shapes)
}

export function buildPhysicsSceneAsset(document: SceneJsonExportDocument): PhysicsSceneAsset {
  const asset = createEmptyPhysicsSceneAsset()
  const materialIds = new Map<string, number>()
  const bodyIdsByNodeId = new Map<string, number>()
  const floorShapeCache: FloorShapeCache = new Map()
  const wallShapeCache: WallTrimeshCache = new Map()
  let nextMaterialId = 1
  let nextShapeIdValue = 1
  let nextBodyId = 1
  let nextVehicleId = 1
  let nextWheelId = 1

  const nextShapeId = (): number => {
    const id = nextShapeIdValue
    nextShapeIdValue += 1
    return id
  }

  const ensureMaterialId = (props: RigidbodyComponentProps): number => {
    const key = `${props.friction}|${props.restitution}`
    const existing = materialIds.get(key)
    if (typeof existing === 'number') {
      return existing
    }
    const materialId = nextMaterialId
    nextMaterialId += 1
    materialIds.set(key, materialId)
    const material: PhysicsMaterialDesc = {
      id: materialId,
      friction: props.friction,
      restitution: props.restitution,
    }
    asset.materials.push(material)
    return materialId
  }

  const visitNode = (node: SceneNode, parentWorldMatrix?: THREE.Matrix4): void => {
    const rigidbodyState = resolvePhysicsSceneRigidbodyComponent(node)
    const localMatrix = getNodeLocalMatrix(node)
    const worldMatrix = parentWorldMatrix
      ? parentWorldMatrix.clone().multiply(localMatrix)
      : localMatrix
    worldMatrix.decompose(worldPositionHelper, worldQuaternionHelper, worldScaleHelper)

    if (rigidbodyState) {
      const rigidbodyProps = clampRigidbodyComponentProps(
        rigidbodyState.props as Partial<RigidbodyComponentProps> | null | undefined,
      )
      const materialId = ensureMaterialId(rigidbodyProps)
      const primaryShapeInstances = buildRigidbodyShapeInstances(node, worldScaleHelper, nextShapeId, asset.shapes)
      const floorShapeInstances = buildFloorShapeInstances(node, worldScaleHelper, nextShapeId, asset.shapes, floorShapeCache)
      const wallShapeInstances = buildWallShapeInstances(node, nextShapeId, asset.shapes, wallShapeCache)
      const modelCollisionShapeInstances = buildModelCollisionShapeInstances(node, worldScaleHelper, nextShapeId, asset.shapes)
      const boundaryWallInstances = buildBoundaryWallShapeInstances(node, nextShapeId, asset.shapes)
      const shapeInstances = [
        ...primaryShapeInstances,
        ...floorShapeInstances,
        ...wallShapeInstances,
        ...modelCollisionShapeInstances,
        ...boundaryWallInstances,
      ]
      if (shapeInstances.length > 0) {
        let shapeId = shapeInstances[0]!.shapeId
        if (
          shapeInstances.length > 1
          || shapeInstances[0]!.transform.position.some((value) => Math.abs(value) > 1e-6)
          || shapeInstances[0]!.transform.rotation.some((value, index) => Math.abs(value - (index === 3 ? 1 : 0)) > 1e-6)
        ) {
          const children: PhysicsCompoundChildDesc[] = shapeInstances.map((entry) => ({
            shapeId: entry.shapeId,
            transform: entry.transform,
          }))
          shapeId = pushShapeDescriptor(asset.shapes, {
            id: nextShapeId(),
            kind: 'compound',
            children,
          })
        }

        const bodyId = nextBodyId
        nextBodyId += 1
        const body: PhysicsBodyDesc = {
          id: bodyId,
          type: mapBodyType(rigidbodyProps.bodyType),
          mass: rigidbodyProps.bodyType === 'DYNAMIC' ? Math.max(0, rigidbodyProps.mass) : 0,
          materialId,
          shapeId,
          transform: toPhysicsTransform(worldPositionHelper, worldQuaternionHelper),
          linearDamping: rigidbodyProps.linearDamping,
          angularDamping: rigidbodyProps.angularDamping,
          userDataKey: node.id,
        }
        asset.bodies.push(body)
        bodyIdsByNodeId.set(node.id, bodyId)
      }
    }

    const vehicleState = resolveVehicleComponent(node)
    const bodyId = bodyIdsByNodeId.get(node.id)
    if (vehicleState && typeof bodyId === 'number') {
      const vehicleProps = clampVehicleComponentProps(vehicleState.props as Partial<VehicleComponentProps> | null | undefined)
      const wheels: PhysicsVehicleWheelDesc[] = vehicleProps.wheels.map((wheel) => ({
        id: nextWheelId++,
        radius: wheel.radius,
        isFrontWheel: wheel.isFrontWheel,
        connectionPoint: toPhysicsVector3(wheel.chassisConnectionPointLocal),
        direction: toPhysicsVector3(wheel.directionLocal),
        axle: toPhysicsVector3(wheel.axleLocal),
        suspensionRestLength: wheel.suspensionRestLength,
        suspensionStiffness: wheel.suspensionStiffness,
        dampingRelaxation: wheel.dampingRelaxation,
        dampingCompression: wheel.dampingCompression,
        frictionSlip: wheel.frictionSlip,
        rollInfluence: wheel.rollInfluence,
        maxSuspensionTravel: wheel.maxSuspensionTravel,
        maxSuspensionForce: wheel.maxSuspensionForce,
      }))
      const vehicle: PhysicsVehicleDesc = {
        id: nextVehicleId++,
        bodyId,
        indexRightAxis: vehicleProps.indexRightAxis as 0 | 1 | 2,
        indexUpAxis: vehicleProps.indexUpAxis as 0 | 1 | 2,
        indexForwardAxis: vehicleProps.indexForwardAxis as 0 | 1 | 2,
        wheels,
      }
      asset.vehicles.push(vehicle)
    }

    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child) => visitNode(child, worldMatrix))
  }

  document.nodes.forEach((node) => visitNode(node, parentWorldMatrixHelper.identity()))
  return asset
}
