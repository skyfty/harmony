import * as THREE from 'three'
import type { SceneNode } from '@schema/core'
import {
  DEFAULT_RIGIDBODY_COLLIDER_TYPE,
  type RigidbodyComponentMetadata,
  type RigidbodyConvexSimplifyConfig,
  type RigidbodyPhysicsShape,
} from '@schema/components'
import { getCachedModelObject } from '@schema/modelObjectCache'
import { getRuntimeObject } from '@/stores/sceneStore'
import {
  DEFAULT_CONVEX_SIMPLIFY_CONFIG,
  buildConservativeConvexGeometryFromObject,
  geometryStats,
  type ConvexSimplifyPass,
} from '@/utils/convexSimplify'
import { resolveNodeScaleFactors, type ColliderScaleFactors } from '@/utils/rigidbodyCollider'
import { computeOrientedBoxFromObject } from './orientedBox'

export type ColliderShapeKind = 'box' | 'sphere' | 'capsule' | 'convex'

export type EditableColliderShape = {
  kind: ColliderShapeKind
  dimensions: THREE.Vector3
  offset: THREE.Vector3
  rotation: THREE.Euler
}

export type ConvertedEditableColliderShape = EditableColliderShape & {
  geometry?: THREE.BufferGeometry
}

export const COLLIDER_SHAPE_OPTIONS: Array<{ label: string; value: ColliderShapeKind }> = [
  { label: 'Convex (Mesh)', value: 'convex' },
  { label: 'Box', value: 'box' },
  { label: 'Sphere', value: 'sphere' },
  { label: 'Capsule', value: 'capsule' },
]

const COLLIDER_MIN_SIZE = 0.05
const COLLIDER_DEFAULT_MIN_SIZE = 0.25

export function normalizeColliderKind(type: string | null | undefined): ColliderShapeKind {
  if (type === 'box' || type === 'sphere' || type === 'capsule' || type === 'convex') {
    return type
  }
  return DEFAULT_RIGIDBODY_COLLIDER_TYPE === 'box' ? 'box' : 'convex'
}

export function normalizeDisplayDegrees(radians: number): number {
  const degrees = THREE.MathUtils.radToDeg(radians)
  return ((degrees + 180) % 360 + 360) % 360 - 180
}

export function resolveColliderScaleFactors(node: SceneNode | null | undefined): ColliderScaleFactors {
  return resolveNodeScaleFactors(node)
}

export function applyNodeTransformFromState(
  target: THREE.Object3D,
  node: SceneNode,
  options: { applyPositionRotation?: boolean } = {},
): void {
  const { applyPositionRotation = true } = options
  if (applyPositionRotation) {
    target.position.set(node.position.x, node.position.y, node.position.z)
    target.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  } else {
    target.position.set(0, 0, 0)
    target.rotation.set(0, 0, 0)
  }
  target.scale.set(node.scale.x, node.scale.y, node.scale.z)
}

export function cloneRuntimeObjectForCollider(
  runtimeObject: THREE.Object3D,
  node: SceneNode,
  applyPositionRotation: boolean,
): THREE.Object3D | null {
  const instancedAssetId = runtimeObject.userData?.instancedAssetId as string | undefined
  if (instancedAssetId) {
    const cached = getCachedModelObject(instancedAssetId)
    if (!cached) {
      return null
    }
    const instancedClone = cached.object.clone(true)
    applyNodeTransformFromState(instancedClone, node, { applyPositionRotation })
    return instancedClone
  }
  return runtimeObject.clone(true)
}

export function cloneNodeForColliderPreview(node: SceneNode, isRoot = false): THREE.Object3D | null {
  const runtimeObject = getRuntimeObject(node.id)
  let clone: THREE.Object3D | null = null

  if (runtimeObject) {
    clone = cloneRuntimeObjectForCollider(runtimeObject, node, !isRoot)
  } else if (node.nodeType === 'Group') {
    clone = new THREE.Group()
  }

  if (!clone) {
    return null
  }

  clone.name = node.name ?? clone.name
  clone.userData = {
    ...(clone.userData ?? {}),
    nodeId: node.id,
  }

  applyNodeTransformFromState(clone, node, { applyPositionRotation: !isRoot })

  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => {
      const childClone = cloneNodeForColliderPreview(child, false)
      if (childClone) {
        clone?.add(childClone)
      }
    })
  }

  return clone
}

export function buildConvexGeometryFromDefinition(
  definition: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>,
  scale: THREE.Vector3,
): THREE.BufferGeometry | null {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  if (vertices.length < 4) {
    return null
  }
  const positions: number[] = []
  vertices.forEach((tuple) => {
    const vx = Number(tuple?.[0])
    const vy = Number(tuple?.[1])
    const vz = Number(tuple?.[2])
    if ([vx, vy, vz].every((value) => Number.isFinite(value))) {
      positions.push(vx * scale.x, vy * scale.y, vz * scale.z)
    }
  })
  if (positions.length < 12) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const faces = Array.isArray(definition.faces) ? definition.faces : []
  const index: number[] = []
  faces.forEach((face) => {
    if (Array.isArray(face) && face.length >= 3) {
      for (let i = 0; i + 2 < face.length; i += 1) {
        const a = Number(face[0])
        const b = Number(face[i + 1])
        const c = Number(face[i + 2])
        if ([a, b, c].every((value) => Number.isInteger(value) && value >= 0)) {
          index.push(a, b, c)
        }
      }
    }
  })
  if (index.length) {
    geometry.setIndex(index)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function buildConvexGeometryFromSamplingObject(
  samplingObject: THREE.Object3D,
  pass: ConvexSimplifyPass,
): THREE.BufferGeometry | null {
  const built = buildConservativeConvexGeometryFromObject(samplingObject, pass)
  return built?.geometry ?? null
}

export function buildConvexGeometryWithFallback(
  samplingObject: THREE.Object3D,
  config: RigidbodyConvexSimplifyConfig,
): { geometry: THREE.BufferGeometry; usedPass: 'primary' | 'fallback' } | null {
  const primaryGeometry = buildConvexGeometryFromSamplingObject(samplingObject, config.primary)
  if (!primaryGeometry) {
    return null
  }
  const primaryStats = geometryStats(primaryGeometry)
  if (primaryStats.vertices <= config.limits.maxVertices && primaryStats.faces <= config.limits.maxFaces) {
    return { geometry: primaryGeometry, usedPass: 'primary' }
  }
  const fallbackGeometry = buildConvexGeometryFromSamplingObject(samplingObject, config.fallback)
  if (!fallbackGeometry) {
    return { geometry: primaryGeometry, usedPass: 'primary' }
  }
  primaryGeometry.dispose()
  return { geometry: fallbackGeometry, usedPass: 'fallback' }
}

export function resolveConvexSimplifyConfig(
  metadata: RigidbodyComponentMetadata | null | undefined,
): RigidbodyConvexSimplifyConfig {
  const config = metadata?.convexSimplify
  if (config && config.version === 1 && config.primary && config.fallback && config.limits) {
    return config
  }
  return DEFAULT_CONVEX_SIMPLIFY_CONFIG as unknown as RigidbodyConvexSimplifyConfig
}

export function cloneConvexSimplifyConfig(config: RigidbodyConvexSimplifyConfig): RigidbodyConvexSimplifyConfig {
  return {
    version: 1,
    primary: { ...config.primary },
    fallback: { ...config.fallback },
    limits: { ...config.limits },
    usedPass: config.usedPass,
  }
}

export function constrainColliderGroupTransform(
  colliderGroup: THREE.Object3D,
  kind: ColliderShapeKind,
): void {
  if (kind === 'sphere') {
    const average = (colliderGroup.scale.x + colliderGroup.scale.y + colliderGroup.scale.z) / 3
    const safe = Math.max(COLLIDER_MIN_SIZE, average)
    colliderGroup.scale.set(safe, safe, safe)
  } else if (kind === 'capsule') {
    const diameter = Math.max(colliderGroup.scale.x, colliderGroup.scale.z)
    colliderGroup.scale.set(diameter, Math.max(diameter * 0.5, colliderGroup.scale.y), diameter)
  } else {
    colliderGroup.scale.set(
      Math.max(COLLIDER_MIN_SIZE, colliderGroup.scale.x),
      Math.max(COLLIDER_MIN_SIZE, colliderGroup.scale.y),
      Math.max(COLLIDER_MIN_SIZE, colliderGroup.scale.z),
    )
  }
}

export function updateEditableColliderStateFromGroup(params: {
  colliderGroup: THREE.Object3D
  kind: ColliderShapeKind
  dimensions: { x: number; y: number; z: number }
  offset: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  convexGeometry?: THREE.BufferGeometry | null
}): void {
  const { colliderGroup, kind, dimensions, offset, rotation, convexGeometry } = params
  offset.x = colliderGroup.position.x
  offset.y = colliderGroup.position.y
  offset.z = colliderGroup.position.z
  rotation.x = normalizeDisplayDegrees(colliderGroup.rotation.x)
  rotation.y = normalizeDisplayDegrees(colliderGroup.rotation.y)
  rotation.z = normalizeDisplayDegrees(colliderGroup.rotation.z)

  if (kind === 'convex' && convexGeometry?.boundingBox) {
    const size = convexGeometry.boundingBox.getSize(new THREE.Vector3())
    dimensions.x = size.x * colliderGroup.scale.x
    dimensions.y = size.y * colliderGroup.scale.y
    dimensions.z = size.z * colliderGroup.scale.z
  } else {
    dimensions.x = colliderGroup.scale.x
    dimensions.y = colliderGroup.scale.y
    dimensions.z = colliderGroup.scale.z
  }
  if (kind === 'capsule') {
    dimensions.y = colliderGroup.scale.y * 2
  }
}

export function resolveColliderGroupRotationTuple(colliderGroup: THREE.Object3D): [number, number, number] {
  return [colliderGroup.rotation.x, colliderGroup.rotation.y, colliderGroup.rotation.z]
}

export function buildDefaultColliderShape(params: {
  kind: ColliderShapeKind
  samplingObject: THREE.Object3D
  scale: THREE.Vector3
  convexGeometry?: THREE.BufferGeometry | null
  convexSimplifyPass?: ConvexSimplifyPass
}): EditableColliderShape | null {
  const { kind, samplingObject, scale, convexGeometry, convexSimplifyPass } = params
  samplingObject.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(samplingObject)
  if (bounds.isEmpty()) {
    return null
  }

  if (kind === 'convex') {
    let geometry = convexGeometry ?? null
    if (!geometry && convexSimplifyPass) {
      geometry = buildConvexGeometryFromSamplingObject(samplingObject, convexSimplifyPass)
    }
    if (!geometry) {
      return null
    }
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? bounds
    const center = box.getCenter(new THREE.Vector3())
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!positions) {
      return null
    }
    const centered = new Float32Array(positions.array.length)
    for (let index = 0; index < positions.count; index += 1) {
      centered[index * 3] = (positions.getX(index) - center.x)
      centered[index * 3 + 1] = (positions.getY(index) - center.y)
      centered[index * 3 + 2] = (positions.getZ(index) - center.z)
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(centered, 3))
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const size = box.getSize(new THREE.Vector3())
    return {
      kind,
      dimensions: new THREE.Vector3(
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.x || COLLIDER_DEFAULT_MIN_SIZE),
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.y || COLLIDER_DEFAULT_MIN_SIZE),
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.z || COLLIDER_DEFAULT_MIN_SIZE),
      ),
      offset: center.clone(),
      rotation: new THREE.Euler(),
    }
  }

  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())

  if (kind === 'box') {
    const oriented = computeOrientedBoxFromObject(samplingObject)
    if (oriented) {
      return {
        kind,
        dimensions: oriented.dimensions.clone().multiply(scale),
        offset: oriented.center.clone().multiply(scale),
        rotation: oriented.rotation.clone(),
      }
    }
    return {
      kind,
      dimensions: new THREE.Vector3(
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.x || COLLIDER_DEFAULT_MIN_SIZE),
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.y || COLLIDER_DEFAULT_MIN_SIZE),
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.z || COLLIDER_DEFAULT_MIN_SIZE),
      ),
      offset: center,
      rotation: new THREE.Euler(),
    }
  }
  if (kind === 'sphere') {
    const diameter = Math.max(COLLIDER_DEFAULT_MIN_SIZE, Math.max(size.x, size.y, size.z))
    return {
      kind,
      dimensions: new THREE.Vector3(diameter, diameter, diameter),
      offset: center,
      rotation: new THREE.Euler(),
    }
  }
  const diameter = Math.max(COLLIDER_DEFAULT_MIN_SIZE, Math.max(size.x, size.z))
  const height = Math.max(diameter, size.y || diameter)
  return {
    kind: 'capsule',
    dimensions: new THREE.Vector3(diameter, height, diameter),
    offset: center,
    rotation: new THREE.Euler(),
  }
}

export function convertColliderMetadataShape(
  shape: RigidbodyPhysicsShape,
  kind: ColliderShapeKind,
  scale: THREE.Vector3,
): ConvertedEditableColliderShape | null {
  const applyScale = shape.applyScale === true
  const scaleX = applyScale ? scale.x : 1
  const scaleY = applyScale ? scale.y : 1
  const scaleZ = applyScale ? scale.z : 1
  const offsetTuple = shape.offset ?? [0, 0, 0]
  const offset = new THREE.Vector3(
    offsetTuple[0] * scaleX,
    offsetTuple[1] * scaleY,
    offsetTuple[2] * scaleZ,
  )
  const rotationTuple = shape.rotation ?? [0, 0, 0]
  const rotation = new THREE.Euler(rotationTuple[0], rotationTuple[1], rotationTuple[2], 'XYZ')

  if (shape.kind === 'box' && kind === 'box') {
    const [hx, hy, hz] = shape.halfExtents
    return {
      kind: 'box',
      dimensions: new THREE.Vector3(
        Math.max(COLLIDER_MIN_SIZE, hx * 2 * scaleX),
        Math.max(COLLIDER_MIN_SIZE, hy * 2 * scaleY),
        Math.max(COLLIDER_MIN_SIZE, hz * 2 * scaleZ),
      ),
      offset,
      rotation,
    }
  }
  if (shape.kind === 'sphere' && kind === 'sphere') {
    const diameter = Math.max(COLLIDER_MIN_SIZE, shape.radius * 2 * Math.max(scaleX, scaleY, scaleZ))
    return {
      kind: 'sphere',
      dimensions: new THREE.Vector3(diameter, diameter, diameter),
      offset,
      rotation,
    }
  }
  if (shape.kind === 'capsule' && kind === 'capsule') {
    const radius = Math.max(0.025, shape.radius * Math.max(scaleX, scaleZ))
    const height = Math.max(radius * 2, shape.height * scaleY)
    return {
      kind: 'capsule',
      dimensions: new THREE.Vector3(radius * 2, height, radius * 2),
      offset,
      rotation,
    }
  }
  if (shape.kind === 'convex' && kind === 'convex') {
    const geometry = buildConvexGeometryFromDefinition(shape, new THREE.Vector3(scaleX, scaleY, scaleZ))
    if (!geometry) {
      return null
    }
    geometry.computeBoundingBox()
    const size = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3()
    return {
      kind: 'convex',
      dimensions: new THREE.Vector3(
        Math.max(COLLIDER_MIN_SIZE, size.x),
        Math.max(COLLIDER_MIN_SIZE, size.y),
        Math.max(COLLIDER_MIN_SIZE, size.z),
      ),
      offset,
      rotation,
      geometry,
    }
  }
  return null
}

export function buildColliderMetadataPayload(params: {
  kind: ColliderShapeKind
  colliderGroup: THREE.Object3D
  scale: THREE.Vector3
  convexGeometry?: THREE.BufferGeometry | null
  convexSimplifyConfig?: RigidbodyConvexSimplifyConfig
  convexSimplifyPasses?: {
    primary: ConvexSimplifyPass
    fallback: ConvexSimplifyPass
    limits: RigidbodyConvexSimplifyConfig['limits']
  }
  convexUsedPass?: 'primary' | 'fallback'
  buildConvexGeometry?: (pass: ConvexSimplifyPass) => THREE.BufferGeometry | null
}): { shape: RigidbodyPhysicsShape; convexSimplify?: RigidbodyConvexSimplifyConfig } | null {
  const {
    kind,
    colliderGroup,
    scale,
    convexSimplifyConfig,
    convexSimplifyPasses,
    convexUsedPass,
    buildConvexGeometry,
  } = params

  if (kind === 'box') {
    return {
      shape: {
        kind: 'box',
        halfExtents: [
          Math.max(1e-4, (colliderGroup.scale.x * 0.5) / scale.x),
          Math.max(1e-4, (colliderGroup.scale.y * 0.5) / scale.y),
          Math.max(1e-4, (colliderGroup.scale.z * 0.5) / scale.z),
        ],
        offset: [
          colliderGroup.position.x / scale.x,
          colliderGroup.position.y / scale.y,
          colliderGroup.position.z / scale.z,
        ],
        rotation: resolveColliderGroupRotationTuple(colliderGroup),
        applyScale: true,
      },
    }
  }

  if (kind === 'sphere') {
    const radius = colliderGroup.scale.x * 0.5
    const dominant = Math.max(scale.x, scale.y, scale.z)
    return {
      shape: {
        kind: 'sphere',
        radius: Math.max(1e-4, radius / dominant),
        offset: [
          colliderGroup.position.x / scale.x,
          colliderGroup.position.y / scale.y,
          colliderGroup.position.z / scale.z,
        ],
        rotation: resolveColliderGroupRotationTuple(colliderGroup),
        applyScale: true,
      },
    }
  }

  if (kind === 'capsule') {
    const radius = Math.max(colliderGroup.scale.x, colliderGroup.scale.z) * 0.5
    const dominant = Math.max(scale.x, scale.z)
    return {
      shape: {
        kind: 'capsule',
        radius: Math.max(1e-4, radius / dominant),
        height: Math.max(2 * radius / scale.y, (colliderGroup.scale.y * 2) / scale.y),
        offset: [
          colliderGroup.position.x / scale.x,
          colliderGroup.position.y / scale.y,
          colliderGroup.position.z / scale.z,
        ],
        rotation: resolveColliderGroupRotationTuple(colliderGroup),
        applyScale: true,
      },
    }
  }

  let chosenGeometry = params.convexGeometry ?? null
  let config = convexSimplifyConfig ? cloneConvexSimplifyConfig(convexSimplifyConfig) : null

  if (!chosenGeometry && buildConvexGeometry && convexSimplifyPasses && config) {
    const primaryBuilt = buildConvexGeometry(convexSimplifyPasses.primary)
    if (!primaryBuilt) {
      return null
    }
    chosenGeometry = primaryBuilt
    const primaryStats = geometryStats(primaryBuilt)
    if (primaryStats.vertices > convexSimplifyPasses.limits.maxVertices || primaryStats.faces > convexSimplifyPasses.limits.maxFaces) {
      const fallbackBuilt = buildConvexGeometry(convexSimplifyPasses.fallback)
      if (fallbackBuilt) {
        chosenGeometry = fallbackBuilt
        config.usedPass = 'fallback'
      } else {
        config.usedPass = 'primary'
      }
    } else {
      config.usedPass = 'primary'
    }
  }

  if (!chosenGeometry) {
    return null
  }
  if (config && convexUsedPass) {
    config.usedPass = convexUsedPass
  }

  const positions = chosenGeometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!positions) {
    return null
  }

  const vertices: [number, number, number][] = []
  const scratch = new THREE.Vector3()
  for (let index = 0; index < positions.count; index += 1) {
    scratch.fromBufferAttribute(positions, index)
    scratch.multiply(colliderGroup.scale)
    vertices.push([
      scratch.x / scale.x,
      scratch.y / scale.y,
      scratch.z / scale.z,
    ])
  }

  const faces: number[][] = []
  const index = chosenGeometry.getIndex()
  if (index && index.count >= 3) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      faces.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)])
    }
  } else {
    for (let i = 0; i + 2 < positions.count; i += 3) {
      faces.push([i, i + 1, i + 2])
    }
  }

  if (!vertices.length || !faces.length) {
    return null
  }

  return {
    shape: {
      kind: 'convex',
      vertices,
      faces,
      offset: [
        colliderGroup.position.x / scale.x,
        colliderGroup.position.y / scale.y,
        colliderGroup.position.z / scale.z,
      ],
      rotation: resolveColliderGroupRotationTuple(colliderGroup),
      applyScale: true,
    },
    convexSimplify: config ?? undefined,
  }
}

export function applyEditableColliderShape(
  colliderGroup: THREE.Object3D,
  shape: EditableColliderShape,
): void {
  colliderGroup.position.copy(shape.offset)
  colliderGroup.rotation.copy(shape.rotation)
  if (shape.kind === 'convex') {
    colliderGroup.scale.set(1, 1, 1)
  } else if (shape.kind === 'capsule') {
    colliderGroup.scale.set(shape.dimensions.x, shape.dimensions.y * 0.5, shape.dimensions.z)
  } else {
    colliderGroup.scale.set(shape.dimensions.x, shape.dimensions.y, shape.dimensions.z)
  }
  constrainColliderGroupTransform(colliderGroup, shape.kind)
}

export function createColliderGeometryForKind(
  kind: ColliderShapeKind,
  convexGeometry?: THREE.BufferGeometry | null,
): THREE.BufferGeometry | null {
  if (kind === 'convex') {
    return convexGeometry ?? null
  }
  if (kind === 'sphere') {
    return new THREE.SphereGeometry(0.5, 36, 24)
  }
  if (kind === 'capsule') {
    return new THREE.CapsuleGeometry(0.5, 1, 16, 32)
  }
  return new THREE.BoxGeometry(1, 1, 1)
}

export function disposeColliderGeometry(
  geometry: THREE.BufferGeometry | null | undefined,
  sharedGeometry?: THREE.BufferGeometry | null,
): void {
  if (!geometry || geometry === sharedGeometry) {
    return
  }
  geometry.dispose()
}
