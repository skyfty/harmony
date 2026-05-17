import * as THREE from 'three'
import type {
  PhysicsBodyDesc,
  PhysicsBodyType,
  PhysicsCompoundChildDesc,
  PhysicsMaterialDesc,
  PhysicsSceneAsset,
  PhysicsTransform,
} from '@harmony/physics-core'
import {
  ROAD_COLLISION_COMPILED_MANIFEST_VERSION,
  ROAD_COLLISION_COMPILED_PACKAGE_VERSION,
  buildRoadCollisionCompiledManifestPath,
  buildRoadCollisionCompiledPackagePath,
  attachRoadCollisionCompiledPackagesToDocument,
  serializeRoadCollisionCompiledManifest,
  serializeRoadCollisionCompiledPackage,
  type RoadCollisionCompiledManifest,
  type RoadCollisionCompiledPackage,
  type RoadCollisionCompiledRoadEntry,
  type SceneJsonExportDocument,
  type SceneNode,
  type SceneNodeComponentState,
  type RigidbodyPhysicsShape,
  type RigidbodyComponentProps,
} from '@schema'
import {
  ROAD_COMPONENT_TYPE,
  clampRoadProps,
  type RoadComponentProps,
  RIGIDBODY_COMPONENT_TYPE,
  clampRigidbodyComponentProps,
  clampBoundaryWallComponentProps,
  type BoundaryWallComponentProps,
} from '@schema/components'
import { buildBoundaryWallSegments } from '@schema/boundaryWall'
import { collectRoadCollisionDescriptors, isRoadDynamicMesh } from '@schema/roadCollision'

type CompiledRoadCollisionExportResult = {
  manifest: RoadCollisionCompiledManifest
  manifestPath: string
  packagesByNodeId: Record<string, RoadCollisionCompiledPackage>
  files: Record<string, Uint8Array>
}

const identityPhysicsRotation: PhysicsTransform['rotation'] = [0, 0, 0, 1]
const nodeLocalMatrixHelper = new THREE.Matrix4()
const worldPositionHelper = new THREE.Vector3()
const worldQuaternionHelper = new THREE.Quaternion()
const worldScaleHelper = new THREE.Vector3()
const nodePositionHelper = new THREE.Vector3()
const nodeQuaternionHelper = new THREE.Quaternion()
const nodeEulerHelper = new THREE.Euler()
const nodeScaleHelper = new THREE.Vector3()
const descriptorEulerHelper = new THREE.Euler()
const descriptorQuaternionHelper = new THREE.Quaternion()

function toPhysicsVector3(vector: { x: number; y: number; z: number } | null | undefined, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!vector) {
    return [...fallback] as [number, number, number]
  }
  return [
    Number.isFinite(vector.x) ? vector.x : (fallback[0] ?? 0),
    Number.isFinite(vector.y) ? vector.y : (fallback[1] ?? 0),
    Number.isFinite(vector.z) ? vector.z : (fallback[2] ?? 0),
  ]
}

function getPositiveScale(node: SceneNode): THREE.Vector3 {
  const scale = node.scale && typeof node.scale === 'object'
    ? toPhysicsVector3(node.scale as { x: number; y: number; z: number }, [1, 1, 1])
    : ([1, 1, 1] as [number, number, number])
  return new THREE.Vector3(
    Math.max(1e-4, Math.abs(scale[0])),
    Math.max(1e-4, Math.abs(scale[1])),
    Math.max(1e-4, Math.abs(scale[2])),
  )
}

function getNodeLocalMatrix(node: SceneNode): THREE.Matrix4 {
  const position = toPhysicsVector3(node.position as { x: number; y: number; z: number } | null | undefined)
  const rotation = toPhysicsVector3(node.rotation as { x: number; y: number; z: number } | null | undefined)
  nodePositionHelper.set(position[0], position[1], position[2])
  nodeEulerHelper.set(rotation[0], rotation[1], rotation[2], 'XYZ')
  nodeQuaternionHelper.setFromEuler(nodeEulerHelper).normalize()
  nodeScaleHelper.copy(getPositiveScale(node))
  return nodeLocalMatrixHelper.compose(nodePositionHelper, nodeQuaternionHelper, nodeScaleHelper).clone()
}

function isIdentityTransform(transform: PhysicsTransform): boolean {
  return transform.position.every((value) => Math.abs(value) <= 1e-8)
    && Math.abs(transform.rotation[0]) <= 1e-8
    && Math.abs(transform.rotation[1]) <= 1e-8
    && Math.abs(transform.rotation[2]) <= 1e-8
    && Math.abs(transform.rotation[3] - 1) <= 1e-8
}

function normalizeRigidbodyComponent(
  node: SceneNode,
): SceneNodeComponentState<RigidbodyComponentProps> | null {
  const existing = node.components?.[RIGIDBODY_COMPONENT_TYPE] as SceneNodeComponentState<RigidbodyComponentProps> | undefined
  if (existing && existing.enabled !== false) {
    return existing
  }
  if (!isRoadDynamicMesh(node.dynamicMesh)) {
    return null
  }
  return {
    id: `__roadCollisionCompiledRigidbody:${node.id}`,
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: true,
    props: clampRigidbodyComponentProps({
      bodyType: 'STATIC',
      targetNodeId: node.id,
    }),
  }
}

function buildShapeInstanceFromRigidbodyShape(
  shape: RigidbodyPhysicsShape,
  worldScale: THREE.Vector3,
  nextShapeId: () => number,
  shapes: any[],
): Array<{ shapeId: number; transform: PhysicsTransform }> {
  const scale = shape.applyScale === true
    ? [worldScale.x, worldScale.y, worldScale.z] as [number, number, number]
    : [1, 1, 1] as [number, number, number]
  const offset = shape.offset ?? [0, 0, 0]
  const scaledOffset: PhysicsTransform['position'] = [
    (offset[0] ?? 0) * worldScale.x,
    (offset[1] ?? 0) * worldScale.y,
    (offset[2] ?? 0) * worldScale.z,
  ]

  if (shape.kind === 'box') {
    const shapeId = nextShapeId()
    shapes.push({
      id: shapeId,
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
    const shapeId = nextShapeId()
    shapes.push({
      id: shapeId,
      kind: 'sphere',
      radius: shape.radius * Math.max(scale[0], scale[1], scale[2]),
    })
    return [{ shapeId, transform: { position: scaledOffset, rotation: identityPhysicsRotation } }]
  }

  if (shape.kind === 'cylinder') {
    const shapeId = nextShapeId()
    const radiusScale = Math.max(scale[0], scale[2])
    shapes.push({
      id: shapeId,
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
    const shapeId = nextShapeId()
    shapes.push({
      id: shapeId,
      kind: 'convex-hull',
      vertices: Array.from(vertices),
      faces: Array.isArray(shape.faces)
        ? shape.faces.map((face) => face.map((index) => Math.trunc(index)))
        : undefined,
    })
    return [{ shapeId, transform: { position: scaledOffset, rotation: identityPhysicsRotation } }]
  }

  if (shape.kind === 'heightfield') {
    const rows = shape.matrix[0]?.length ?? 0
    const columns = shape.matrix.length
    const values = new Float32Array(rows * columns)
    let offsetIndex = 0
    let minHeight = Number.POSITIVE_INFINITY
    let maxHeight = Number.NEGATIVE_INFINITY
    for (let column = 0; column < columns; column += 1) {
      const columnValues = shape.matrix[column] ?? []
      for (let row = 0; row < rows; row += 1) {
        const value = (columnValues[row] ?? 0) * scale[1]
        values[offsetIndex] = value
        offsetIndex += 1
        minHeight = Math.min(minHeight, value)
        maxHeight = Math.max(maxHeight, value)
      }
    }
    const shapeId = nextShapeId()
    shapes.push({
      id: shapeId,
      kind: 'heightfield',
      rows,
      columns,
      elementSize: shape.elementSize * Math.max(scale[0], scale[2]),
      heights: Array.from(values),
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
    const shapeId = nextShapeId()
    shapes.push({
      id: shapeId,
      kind: 'static-mesh',
      vertices: Array.from(vertices),
      indices: Array.from(indices),
    })
    return [{ shapeId, transform: { position: scaledOffset, rotation: identityPhysicsRotation } }]
  }

  return []
}

function pushShapeDescriptor(shapes: any[], shape: any): number {
  shapes.push(shape)
  return shape.id
}

function buildRoadCompiledAssetFromSnapshot(
  roadNode: SceneNode,
  rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>,
  snapshot: NonNullable<ReturnType<typeof collectRoadCollisionDescriptors>>,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
  worldScale: THREE.Vector3,
): PhysicsSceneAsset {
  const asset: any = {
    format: 'harmony-physics',
    materials: [],
    shapes: [],
    bodies: [],
    vehicles: [],
  }

  const material = {
    id: 1,
    friction: rigidbodyComponent.props.friction,
    restitution: rigidbodyComponent.props.restitution,
  } satisfies PhysicsMaterialDesc
  asset.materials.push(material)

  const nextShapeId = (() => {
    let current = 1
    return () => {
      const id = current
      current += 1
      return id
    }
  })()

  const shapeInstances = snapshot.descriptors.flatMap((descriptor) => {
    const built = buildShapeInstanceFromRigidbodyShape(descriptor.shapeDefinition, worldScale, nextShapeId, asset.shapes)
    if (!built.length) {
      return []
    }
    return built.map((entry) => {
      descriptorEulerHelper.set(descriptor.pitch, descriptor.yaw, 0, 'YXZ')
      descriptorQuaternionHelper.setFromEuler(descriptorEulerHelper)
      const descriptorTransform: PhysicsTransform = {
        position: [
          descriptor.position[0],
          descriptor.position[1],
          descriptor.position[2],
        ],
        rotation: [
          descriptorQuaternionHelper.x,
          descriptorQuaternionHelper.y,
          descriptorQuaternionHelper.z,
          descriptorQuaternionHelper.w,
        ],
      }
      return {
        ...entry,
        transform: descriptorTransform,
      }
    })
  })

  if (snapshot.boundaryWallEnabled && snapshot.boundaryWallProps) {
    const boundaryWallSegments = buildBoundaryWallSegments({
      node: roadNode,
      object: null,
      props: clampBoundaryWallComponentProps(snapshot.boundaryWallProps as BoundaryWallComponentProps),
    })
    boundaryWallSegments.forEach((segment) => {
      const [hx, hy, hz] = segment.halfExtents
      if (![hx, hy, hz].every((value) => Number.isFinite(value) && value > 0)) {
        return
      }
      const shapeId = nextShapeId()
      asset.shapes.push({
        id: shapeId,
        kind: 'box',
        halfExtents: [hx, hy, hz],
      })
      shapeInstances.push({
        shapeId,
        transform: {
          position: [segment.offset[0], segment.offset[1], segment.offset[2]],
          rotation: [segment.orientation[0], segment.orientation[1], segment.orientation[2], segment.orientation[3]],
        },
      })
    })
  }

  if (!shapeInstances.length) {
    return asset
  }

  let shapeId = shapeInstances[0]!.shapeId
  if (
    shapeInstances.length > 1
    || !isIdentityTransform(shapeInstances[0]!.transform)
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

  const body: PhysicsBodyDesc = {
    id: 1,
    type: (rigidbodyComponent.props.bodyType === 'KINEMATIC' ? 'kinematic' : rigidbodyComponent.props.bodyType === 'DYNAMIC' ? 'dynamic' : 'static') as PhysicsBodyType,
    mass: rigidbodyComponent.props.bodyType === 'DYNAMIC' ? Math.max(0, rigidbodyComponent.props.mass) : 0,
    materialId: material.id,
    shapeId,
    transform: {
      position: [worldPosition.x, worldPosition.y, worldPosition.z],
      rotation: [worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w],
    },
    linearDamping: rigidbodyComponent.props.linearDamping,
    angularDamping: rigidbodyComponent.props.angularDamping,
    userDataKey: roadNode.id,
  }
  asset.bodies.push(body)
  return asset
}

function buildRoadCollisionCompiledPackageForNode(
  node: SceneNode,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
  worldScale: THREE.Vector3,
): RoadCollisionCompiledPackage | null {
  if (!isRoadDynamicMesh(node.dynamicMesh)) {
    return null
  }
  const roadState = node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined
  const roadProps = clampRoadProps(roadState?.props as Partial<RoadComponentProps> | null | undefined)
  if (roadProps.enableVehicleCollision === false) {
    return null
  }
  const rigidbodyComponent = normalizeRigidbodyComponent(node)
  if (!rigidbodyComponent || rigidbodyComponent.props.bodyType !== 'STATIC') {
    return null
  }

  const snapshot = collectRoadCollisionDescriptors({
    roadNode: node,
    rigidbodyComponent,
  })
  if (!snapshot) {
    return null
  }

  const asset = buildRoadCompiledAssetFromSnapshot(node, rigidbodyComponent, snapshot, worldPosition, worldQuaternion, worldScale)
  return {
    version: ROAD_COLLISION_COMPILED_PACKAGE_VERSION,
    sceneId: '',
    roadNodeId: node.id,
    signature: [
      node.id,
      snapshot.layoutHash.toString(16),
      Math.round(snapshot.roadWidth * 1000),
      Math.round(snapshot.collisionWidth * 1000),
      Math.round(snapshot.samplingDensityFactor * 1000),
      Math.round(snapshot.collisionSubdivisionFactor * 1000),
      Math.round(snapshot.smoothingStrengthFactor * 1000),
      Math.round(snapshot.minClearance * 1000),
      Math.round(snapshot.junctionSmoothing * 1000),
      Math.round(snapshot.desiredTileLength * 1000),
      Math.round(snapshot.elementSize * 1000),
      snapshot.boundaryWallEnabled ? 1 : 0,
      snapshot.boundaryWallProps ? Math.round(snapshot.boundaryWallProps.height * 1000) : 0,
      snapshot.boundaryWallProps ? Math.round(snapshot.boundaryWallProps.thickness * 1000) : 0,
      snapshot.boundaryWallProps ? Math.round(snapshot.boundaryWallProps.offset * 1000) : 0,
    ].join('|'),
    asset: asset as PhysicsSceneAsset,
  }
}

function visitRoadNodes(
  node: SceneNode,
  parentWorldMatrix: THREE.Matrix4 | null,
  packagesByNodeId: Record<string, RoadCollisionCompiledPackage>,
): void {
  const localMatrix = getNodeLocalMatrix(node)
  const worldMatrix = parentWorldMatrix
    ? parentWorldMatrix.clone().multiply(localMatrix)
    : localMatrix
  worldMatrix.decompose(worldPositionHelper, worldQuaternionHelper, worldScaleHelper)
  const pkg = buildRoadCollisionCompiledPackageForNode(node, worldPositionHelper, worldQuaternionHelper, worldScaleHelper)
  if (pkg) {
    packagesByNodeId[node.id] = {
      ...pkg,
      sceneId: '',
    }
  }
  const children = Array.isArray(node.children) ? node.children : []
  children.forEach((child) => visitRoadNodes(child, worldMatrix, packagesByNodeId))
}

export function buildRoadCollisionCompiledExport(document: SceneJsonExportDocument): CompiledRoadCollisionExportResult {
  const normalizedSceneId = typeof document.id === 'string' ? document.id.trim() : ''
  const manifestPath = buildRoadCollisionCompiledManifestPath(normalizedSceneId)
  const packagesByNodeId: Record<string, RoadCollisionCompiledPackage> = {}

  if (!Array.isArray(document.nodes) || !normalizedSceneId) {
    return {
      manifest: {
        version: ROAD_COLLISION_COMPILED_MANIFEST_VERSION,
        sceneId: normalizedSceneId || 'unknown',
        revision: 0,
        roads: [],
      },
      manifestPath,
      packagesByNodeId,
      files: {
        [manifestPath]: serializeRoadCollisionCompiledManifest({
          version: ROAD_COLLISION_COMPILED_MANIFEST_VERSION,
          sceneId: normalizedSceneId || 'unknown',
          revision: 0,
          roads: [],
        }),
      },
    }
  }

  document.nodes.forEach((node) => visitRoadNodes(node, null, packagesByNodeId))

  const roads: RoadCollisionCompiledRoadEntry[] = Object.values(packagesByNodeId).map((pkg) => {
    return {
      nodeId: pkg.roadNodeId,
      path: buildRoadCollisionCompiledPackagePath(normalizedSceneId, pkg.roadNodeId),
      signature: pkg.signature,
      bodyCount: Array.isArray(pkg.asset.bodies) ? pkg.asset.bodies.length : 0,
      shapeCount: Array.isArray(pkg.asset.shapes) ? pkg.asset.shapes.length : 0,
    }
  })

  roads.sort((a, b) => a.nodeId.localeCompare(b.nodeId))

  const manifest: RoadCollisionCompiledManifest = {
    version: ROAD_COLLISION_COMPILED_MANIFEST_VERSION,
    sceneId: normalizedSceneId,
    revision: Math.max(0, Math.trunc(new Date(document.updatedAt).getTime()) || Date.now()),
    roads,
  }

  const files: Record<string, Uint8Array> = {
    [manifestPath]: serializeRoadCollisionCompiledManifest(manifest),
  }
  Object.values(packagesByNodeId).forEach((pkg) => {
    const path = buildRoadCollisionCompiledPackagePath(normalizedSceneId, pkg.roadNodeId)
    files[path] = serializeRoadCollisionCompiledPackage({
      ...pkg,
      sceneId: normalizedSceneId,
    })
  })

  return {
    manifest,
    manifestPath,
    packagesByNodeId: Object.fromEntries(
      Object.values(packagesByNodeId).map((pkg) => [pkg.roadNodeId, {
        ...pkg,
        sceneId: normalizedSceneId,
      }] as const),
    ),
    files,
  }
}

export function attachRoadCollisionCompiledExportToDocument(
  document: SceneJsonExportDocument,
): RoadCollisionCompiledPackage[] {
  const exportResult = buildRoadCollisionCompiledExport(document)
  attachRoadCollisionCompiledPackagesToDocument(document, exportResult.packagesByNodeId)
  return Object.values(exportResult.packagesByNodeId)
}
