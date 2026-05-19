import * as THREE from 'three'
import { type PhysicsBodyDesc, type PhysicsBodyType, type PhysicsCompoundChildDesc, type PhysicsMaterialDesc, type PhysicsSceneAsset, type PhysicsShapeDesc, type PhysicsTransform, type PhysicsVector3, type PhysicsVehicleDesc, type PhysicsVehicleWheelDesc } from '@harmony/physics-core'
import type { SceneJsonExportDocument, SceneNode, SceneNodeComponentState, Vector3Like } from './index'
import { buildGroundAirWallDefinitions } from './airWall'
import { buildBoundaryWallSegments } from './boundaryWall'
import {
  isGroundDynamicMesh,
} from './groundHeightfield'
import { resolveFloorShape, resolveModelCollisionFaceSegments, resolveWallShape, type FloorShapeCache, type WallTrimeshCache } from './physicsShapeResolvers'
import { isRoadDynamicMesh } from './roadCollision'
import {
  extractRoadCollisionCompiledPackageFromUserData,
  type RoadCollisionCompiledPackage,
} from './roadCollisionCompiled'
import {
  BOUNDARY_WALL_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  ROAD_COMPONENT_TYPE,
  VEHICLE_COMPONENT_TYPE,
  clampBoundaryWallComponentProps,
  clampRigidbodyComponentProps,
  clampRoadProps,
  resolveModelCollisionComponentPropsFromNode,
  clampVehicleComponentProps,
  type BoundaryWallComponentProps,
  type RigidbodyComponentMetadata,
  type RigidbodyComponentProps,
  type RoadComponentProps,
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
const legacyConvexOffsetWorldHelper = new THREE.Vector3()
const legacyConvexOffsetLocalHelper = new THREE.Vector3()
const legacyConvexOffsetInverseQuaternionHelper = new THREE.Quaternion()
const groundAirWallPositionHelper = new THREE.Vector3()
const groundAirWallQuaternionHelper = new THREE.Quaternion()
const groundAirWallScaleHelper = new THREE.Vector3()
const identityPhysicsRotation: PhysicsTransform['rotation'] = [0, 0, 0, 1]

function createEmptyPhysicsSceneAsset(): PhysicsSceneAsset {
  return {
    format: 'harmony-physics',
    materials: [],
    shapes: [],
    bodies: [],
    vehicles: [],
  }
}

export type PhysicsSceneAssetBuildProgressPhase = 'collecting' | 'building' | 'finalizing'

export interface PhysicsSceneAssetBuildProgress {
  phase: PhysicsSceneAssetBuildProgressPhase
  loaded: number
  total: number
  label: string
  detail: string
}

export interface PhysicsSceneAssetBuildOptions {
  onProgress?: (progress: PhysicsSceneAssetBuildProgress) => void
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: () => void) => setTimeout(callback, 0)
    schedule(() => resolve())
  })
}

function reportPhysicsSceneAssetProgress(
  options: PhysicsSceneAssetBuildOptions | undefined,
  progress: PhysicsSceneAssetBuildProgress,
): void {
  options?.onProgress?.(progress)
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
  const hasGround = isGroundDynamicMesh(node.dynamicMesh)
  const hasRoad = isRoadDynamicMesh(node.dynamicMesh)
  const hasWall = node.dynamicMesh?.type === 'Wall'
  const hasFloor = node.dynamicMesh?.type === 'Floor'
  const hasModelCollision = Boolean(resolveModelCollisionComponentPropsFromNode(node)?.faces?.length)
  if (!hasBoundaryWall && !hasGround && !hasRoad && !hasWall && !hasFloor && !hasModelCollision) {
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

function findGroundNode(nodes: SceneNode[] | null | undefined): SceneNode | null {
  if (!Array.isArray(nodes)) {
    return null
  }
  for (const node of nodes) {
    if (isGroundDynamicMesh(node.dynamicMesh)) {
      return node
    }
    const nested = findGroundNode(Array.isArray(node.children) ? node.children : null)
    if (nested) {
      return nested
    }
  }
  return null
}

function scaleShapeOffset(shape: RigidbodyPhysicsShape, worldScale: THREE.Vector3): PhysicsVector3 {
  const [ox = 0, oy = 0, oz = 0] = shape.offset ?? [0, 0, 0]
  return [ox * worldScale.x, oy * worldScale.y, oz * worldScale.z]
}

function getShapeScale(shape: RigidbodyPhysicsShape, worldScale: THREE.Vector3): PhysicsVector3 {
  if (shape.applyScale !== true) {
    return [1, 1, 1]
  }
  return [worldScale.x, worldScale.y, worldScale.z]
}

function normalizeLegacyConvexWorldOffset(
  shape: RigidbodyPhysicsShape,
  worldScale: THREE.Vector3,
  bodyWorldPosition: THREE.Vector3,
  bodyWorldQuaternion: THREE.Quaternion,
): RigidbodyPhysicsShape {
  if (shape.kind !== 'convex' || shape.applyScale !== true || !shape.offset) {
    return shape
  }
  legacyConvexOffsetWorldHelper.set(
    (shape.offset[0] ?? 0) * worldScale.x,
    (shape.offset[1] ?? 0) * worldScale.y,
    (shape.offset[2] ?? 0) * worldScale.z,
  )
  if (legacyConvexOffsetWorldHelper.distanceToSquared(bodyWorldPosition) > 1e-8) {
    return shape
  }
  legacyConvexOffsetLocalHelper.copy(legacyConvexOffsetWorldHelper).sub(bodyWorldPosition)
  legacyConvexOffsetInverseQuaternionHelper.copy(bodyWorldQuaternion).invert()
  legacyConvexOffsetLocalHelper.applyQuaternion(legacyConvexOffsetInverseQuaternionHelper)
  return {
    ...shape,
    offset: [
      Math.abs(worldScale.x) > 1e-8 ? legacyConvexOffsetLocalHelper.x / worldScale.x : 0,
      Math.abs(worldScale.y) > 1e-8 ? legacyConvexOffsetLocalHelper.y / worldScale.y : 0,
      Math.abs(worldScale.z) > 1e-8 ? legacyConvexOffsetLocalHelper.z / worldScale.z : 0,
    ],
  }
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
      faces: Array.isArray(shape.faces)
        ? shape.faces
          .filter((face): face is number[] => Array.isArray(face) && face.length >= 3)
          .map((face) => face.map((index) => Math.trunc(index)))
        : undefined,
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
      localOffset: scaledOffset,
    })
    return [{ shapeId, transform: { position: [0, 0, 0], rotation: identityPhysicsRotation } }]
  }

  if (shape.kind === 'static-mesh') {
    const vertices = new Float32Array(shape.vertices.length * 3)
    shape.vertices.forEach((vertex, index) => {
      vertices[index * 3] = vertex[0] * scale[0]
      vertices[index * 3 + 1] = vertex[1] * scale[1]
      vertices[index * 3 + 2] = vertex[2] * scale[2]
    })
    const indices = new Uint32Array(
      (Array.isArray(shape.indices) ? shape.indices : [])
        .map((value) => Math.max(0, Math.trunc(Number(value) || 0))),
    )
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'static-mesh',
      vertices,
      indices,
    })
    return [{ shapeId, transform: { position: scaledOffset, rotation: identityPhysicsRotation } }]
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
    const [hx, hy, hz] = segment.halfExtents
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
    const [hx, hy, hz] = segment.halfExtents
    if (![hx, hy, hz].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      return []
    }
    const shapeId = pushShapeDescriptor(shapes, {
      id: nextShapeId(),
      kind: 'box',
      halfExtents: [hx, hy, hz],
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

function resolveRoadCollisionCompiledPackage(node: SceneNode): RoadCollisionCompiledPackage | null {
  return extractRoadCollisionCompiledPackageFromUserData(node.userData)
}

function shouldExpectRoadCollisionCompiledPackage(node: SceneNode): boolean {
  if (!isRoadDynamicMesh(node.dynamicMesh)) {
    return false
  }
  const roadState = node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
  const roadProps = clampRoadProps(roadState?.props as Partial<RoadComponentProps> | null | undefined)
  return roadProps.enableVehicleCollision !== false
}

function cloneRoadCollisionShapeDesc(
  shape: any,
  shapeIdMap: Map<number, number>,
): any {
  switch (shape.kind) {
    case 'box':
      return {
        id: shapeIdMap.get(shape.id) ?? shape.id,
        kind: 'box',
        halfExtents: [...shape.halfExtents] as [number, number, number],
      }
    case 'sphere':
      return {
        id: shapeIdMap.get(shape.id) ?? shape.id,
        kind: 'sphere',
        radius: shape.radius,
      }
    case 'cylinder':
      return {
        id: shapeIdMap.get(shape.id) ?? shape.id,
        kind: 'cylinder',
        radiusTop: shape.radiusTop,
        radiusBottom: shape.radiusBottom,
        height: shape.height,
        segments: shape.segments,
      }
    case 'convex-hull':
      return {
        id: shapeIdMap.get(shape.id) ?? shape.id,
        kind: 'convex-hull',
        vertices: Array.isArray(shape.vertices) ? [...shape.vertices] : Array.from(shape.vertices ?? []),
        faces: Array.isArray(shape.faces)
          ? shape.faces.map((face: any) => face.map((entry: any) => Math.trunc(entry)))
          : undefined,
      }
    case 'heightfield':
      return {
        id: shapeIdMap.get(shape.id) ?? shape.id,
        kind: 'heightfield',
        rows: shape.rows,
        columns: shape.columns,
        elementSize: shape.elementSize,
        heights: Array.isArray(shape.heights) ? [...shape.heights] : Array.from(shape.heights ?? []),
        minHeight: shape.minHeight,
        maxHeight: shape.maxHeight,
        localOffset: shape.localOffset ? [...shape.localOffset] as [number, number, number] : undefined,
      }
    case 'static-mesh':
      return {
        id: shapeIdMap.get(shape.id) ?? shape.id,
        kind: 'static-mesh',
        vertices: Array.isArray(shape.vertices) ? [...shape.vertices] : Array.from(shape.vertices ?? []),
        indices: Array.isArray(shape.indices) ? [...shape.indices] : Array.from(shape.indices ?? []),
      }
    case 'compound':
      return {
        id: shapeIdMap.get(shape.id) ?? shape.id,
        kind: 'compound',
        children: shape.children.map((child: any) => ({
          shapeId: shapeIdMap.get(child.shapeId) ?? child.shapeId,
          transform: {
            position: [...child.transform.position] as [number, number, number],
            rotation: [...child.transform.rotation] as [number, number, number, number],
          },
        })),
      }
    default: {
      return shape
    }
  }
}

function mergeCompiledRoadCollisionPackage(
  asset: PhysicsSceneAsset,
  compiledPackage: RoadCollisionCompiledPackage,
  materialIds: Map<string, number>,
  nextMaterialId: () => number,
  nextShapeId: () => number,
  nextBodyId: () => number,
): void {
  const shapeIdMap = new Map<number, number>()
  const materialIdMap = new Map<number, number>()

  compiledPackage.asset.materials.forEach((material: any) => {
    if (!material || typeof material.id !== 'number') {
      return
    }
    const key = `${material.friction}|${material.restitution}`
    const existing = materialIds.get(key)
    const resolvedId = typeof existing === 'number' ? existing : nextMaterialId()
    if (typeof existing !== 'number') {
      materialIds.set(key, resolvedId)
      asset.materials.push({
        id: resolvedId,
        friction: material.friction,
        restitution: material.restitution,
      })
    }
    materialIdMap.set(material.id, resolvedId)
  })

  compiledPackage.asset.shapes.forEach((shape: any) => {
    if (!shape || typeof shape.id !== 'number') {
      return
    }
    const nextId = nextShapeId()
    shapeIdMap.set(shape.id, nextId)
    asset.shapes.push(cloneRoadCollisionShapeDesc({
      ...shape,
      id: nextId,
    } as PhysicsShapeDesc, shapeIdMap))
  })

  compiledPackage.asset.bodies.forEach((body: any) => {
    if (!body || typeof body.id !== 'number') {
      return
    }
    const nextId = nextBodyId()
    asset.bodies.push({
      ...body,
      id: nextId,
      materialId: body.materialId == null ? null : (materialIdMap.get(body.materialId) ?? body.materialId),
      shapeId: shapeIdMap.get(body.shapeId) ?? body.shapeId,
      transform: {
        position: [...body.transform.position] as [number, number, number],
        rotation: [...body.transform.rotation] as [number, number, number, number],
      },
      userDataKey: body.userDataKey ?? null,
    })
  })
}

function buildRigidbodyShapeInstances(
  node: SceneNode,
  worldScale: THREE.Vector3,
  bodyWorldPosition: THREE.Vector3,
  bodyWorldQuaternion: THREE.Quaternion,
  nextShapeId: () => number,
  shapes: PhysicsShapeDesc[],
): BuildShapeInstance[] {
  const rawShape = extractRigidbodyShape(resolveRigidbodyComponent(node))
  const shape = rawShape
    ? normalizeLegacyConvexWorldOffset(rawShape, worldScale, bodyWorldPosition, bodyWorldQuaternion)
    : null
  if (!shape) {
    return []
  }
  return buildShapeInstancesFromDefinition(shape, worldScale, nextShapeId, shapes)
}

function countSceneNodes(nodes: SceneNode[] | null | undefined): number {
  if (!Array.isArray(nodes) || !nodes.length) {
    return 0
  }
  let count = 0
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    count += 1
    if (Array.isArray(current.children) && current.children.length) {
      stack.push(...current.children)
    }
  }
  return count
}

export async function buildPhysicsSceneAsset(
  document: SceneJsonExportDocument,
  options: PhysicsSceneAssetBuildOptions = {},
): Promise<PhysicsSceneAsset> {
  const asset = createEmptyPhysicsSceneAsset()
  const materialIds = new Map<string, number>()
  const bodyIdsByNodeId = new Map<string, number>()
  const floorShapeCache: FloorShapeCache = new Map()
  const wallShapeCache: WallTrimeshCache = new Map()
  const groundNode = findGroundNode(document.nodes)
  let groundWorldTransform: PhysicsTransform | null = null
  let groundWorldScale: PhysicsVector3 | null = null
  let nextMaterialId = 1
  let nextShapeIdValue = 1
  let nextBodyId = 1
  let nextVehicleId = 1
  let nextWheelId = 1
  const totalNodes = countSceneNodes(document.nodes)
  let processedNodes = 0
  let nextYieldAt = 64

  reportPhysicsSceneAssetProgress(options, {
    phase: 'collecting',
    loaded: 0,
    total: totalNodes,
    label: '正在分析物理节点',
    detail: '正在收集刚体、车辆和地形碰撞体...',
  })

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

  const visitNode = async (node: SceneNode, parentWorldMatrix?: THREE.Matrix4): Promise<void> => {
    const rigidbodyState = resolvePhysicsSceneRigidbodyComponent(node)
    const localMatrix = getNodeLocalMatrix(node)
    const worldMatrix = parentWorldMatrix
      ? parentWorldMatrix.clone().multiply(localMatrix)
      : localMatrix
    worldMatrix.decompose(worldPositionHelper, worldQuaternionHelper, worldScaleHelper)
    if (!groundWorldTransform && groundNode && node.id === groundNode.id && isGroundDynamicMesh(node.dynamicMesh)) {
      groundWorldTransform = toPhysicsTransform(worldPositionHelper, worldQuaternionHelper)
      groundWorldScale = [worldScaleHelper.x, worldScaleHelper.y, worldScaleHelper.z]
    }

    if (rigidbodyState) {
      const rigidbodyProps = clampRigidbodyComponentProps(
        rigidbodyState.props as Partial<RigidbodyComponentProps> | null | undefined,
      )
      const materialId = ensureMaterialId(rigidbodyProps)
      if (isRoadDynamicMesh(node.dynamicMesh)) {
        const shouldExpectCompiledRoadCollision = shouldExpectRoadCollisionCompiledPackage(node)
        const compiledRoadPackage = resolveRoadCollisionCompiledPackage(node)
        if (shouldExpectCompiledRoadCollision && !compiledRoadPackage) {
          throw new Error(`Missing compiled road collision package for road node: ${node.id}`)
        }
        if (compiledRoadPackage) {
          mergeCompiledRoadCollisionPackage(
            asset,
            compiledRoadPackage,
            materialIds,
            () => {
              const id = nextMaterialId
              nextMaterialId += 1
              return id
            },
            nextShapeId,
            () => {
              const id = nextBodyId
              nextBodyId += 1
              return id
            },
          )
        }
      } else {
        const floorShapeInstances = buildFloorShapeInstances(node, worldScaleHelper, nextShapeId, asset.shapes, floorShapeCache)
        const wallShapeInstances = buildWallShapeInstances(node, nextShapeId, asset.shapes, wallShapeCache)
        const modelCollisionShapeInstances = buildModelCollisionShapeInstances(node, worldScaleHelper, nextShapeId, asset.shapes)
        const primaryShapeInstances = wallShapeInstances.length > 0
          ? []
          : buildRigidbodyShapeInstances(
            node,
            worldScaleHelper,
            worldPositionHelper,
            worldQuaternionHelper,
            nextShapeId,
            asset.shapes,
          )
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
            || shapeInstances[0]!.transform.position.some((value: number) => Math.abs(value) > 1e-6)
            || shapeInstances[0]!.transform.rotation.some((value: number, index: number) => Math.abs(value - (index === 3 ? 1 : 0)) > 1e-6)
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
        maxSpeedKmh: vehicleProps.maxSpeedKmh,
        wheels,
      }
      asset.vehicles.push(vehicle)
    }

    processedNodes += 1
    if (processedNodes >= nextYieldAt || processedNodes === totalNodes) {
      reportPhysicsSceneAssetProgress(options, {
        phase: 'building',
        loaded: processedNodes,
        total: Math.max(totalNodes, 1),
        label: '正在构建物理场景',
        detail: `正在处理节点 ${processedNodes}/${Math.max(totalNodes, 1)}`,
      })
      nextYieldAt = processedNodes + 64
      await yieldToMainThread()
    }

    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) {
      await visitNode(child, worldMatrix)
    }
  }

  for (const node of document.nodes) {
    await visitNode(node, parentWorldMatrixHelper.identity())
  }

  if (groundNode && isGroundDynamicMesh(groundNode.dynamicMesh) && document.groundSettings?.enableAirWall !== false) {
    const staticMaterialId = ensureMaterialId(clampRigidbodyComponentProps({ bodyType: 'STATIC' }))
    if (groundWorldTransform && groundWorldScale) {
      const resolvedGroundWorldTransform = groundWorldTransform as PhysicsTransform
      const resolvedGroundWorldScale = groundWorldScale as PhysicsVector3
      groundAirWallPositionHelper.set(
        resolvedGroundWorldTransform.position[0],
        resolvedGroundWorldTransform.position[1],
        resolvedGroundWorldTransform.position[2],
      )
      groundAirWallQuaternionHelper.set(
        resolvedGroundWorldTransform.rotation[0],
        resolvedGroundWorldTransform.rotation[1],
        resolvedGroundWorldTransform.rotation[2],
        resolvedGroundWorldTransform.rotation[3],
      )
      groundAirWallScaleHelper.set(
        resolvedGroundWorldScale[0],
        resolvedGroundWorldScale[1],
        resolvedGroundWorldScale[2],
      )
      const groundObject = new THREE.Object3D()
      groundObject.position.copy(groundAirWallPositionHelper)
      groundObject.quaternion.copy(groundAirWallQuaternionHelper)
      groundObject.scale.copy(groundAirWallScaleHelper)
      groundObject.updateMatrixWorld(true)
      const airWallDefinitions = buildGroundAirWallDefinitions({
        groundNode,
        groundObject,
      })
      airWallDefinitions.forEach((definition) => {
        const [hx, hy, hz] = definition.halfExtents
        if (![hx, hy, hz].every((value) => Number.isFinite(value) && value > 0)) {
          return
        }
        const shapeId = pushShapeDescriptor(asset.shapes, {
          id: nextShapeId(),
          kind: 'box',
          halfExtents: [hx, hy, hz],
        })
        asset.bodies.push({
          id: nextBodyId++,
          type: 'static',
          mass: 0,
          materialId: staticMaterialId,
          shapeId,
          transform: {
            position: [
              definition.bodyPosition[0],
              definition.bodyPosition[1],
              definition.bodyPosition[2],
            ],
            rotation: [
              definition.bodyQuaternion.x,
              definition.bodyQuaternion.y,
              definition.bodyQuaternion.z,
              definition.bodyQuaternion.w,
            ],
          },
          userDataKey: null,
        })
      })
    }
  }

  reportPhysicsSceneAssetProgress(options, {
    phase: 'finalizing',
    loaded: totalNodes,
    total: Math.max(totalNodes, 1),
    label: '物理场景构建完成',
    detail: `已处理 ${processedNodes}/${Math.max(totalNodes, 1)} 个节点`,
  })

  return asset
}
