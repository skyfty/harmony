import * as THREE from 'three'
import type { SceneNode } from '@schema/core'
import {
  DEFAULT_RIGIDBODY_COLLIDER_TYPE,
  type RigidbodyPhysicsShape,
  type RigidbodyVector3Tuple,
} from '@schema/components'
import { getCachedModelObject } from '@schema/modelObjectCache'
import {
  computeColliderLocalBoundingBox,
  resolveNodeScaleFactors,
  type ColliderScaleFactors,
} from '@/utils/rigidbodyCollider'
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

/**
 * Converts a persisted/generated convex collision shape into a viewport overlay geometry.
 * Vertices, part offsets and the shape offset follow the runtime `applyScale` semantics so
 * the overlay matches the physics collider exactly.
 */
export function buildConvexShapeOverlay(params: {
  shape: RigidbodyPhysicsShape
  scale: THREE.Vector3
}): { geometry: THREE.BufferGeometry; offset: THREE.Vector3 } | null {
  const { shape, scale } = params
  const applyScale = shape.applyScale === true
  const scaleX = applyScale ? scale.x : 1
  const scaleY = applyScale ? scale.y : 1
  const scaleZ = applyScale ? scale.z : 1
  const shapeOffsetTuple = shape.offset ?? [0, 0, 0]
  const offset = new THREE.Vector3(
    (shapeOffsetTuple[0] ?? 0) * scaleX,
    (shapeOffsetTuple[1] ?? 0) * scaleY,
    (shapeOffsetTuple[2] ?? 0) * scaleZ,
  )
  const shapeRotationTuple = shape.rotation ?? [0, 0, 0]
  const shapeQuaternion = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(shapeRotationTuple[0] ?? 0, shapeRotationTuple[1] ?? 0, shapeRotationTuple[2] ?? 0, 'XYZ'))
    .normalize()

  const positions: number[] = []
  const indices: number[] = []
  const pointHelper = new THREE.Vector3()
  const partOffsetHelper = new THREE.Vector3()
  const partQuaternionHelper = new THREE.Quaternion()

  const appendPart = (
    vertices: RigidbodyVector3Tuple[],
    faces: number[][],
    partOffset: RigidbodyVector3Tuple | undefined,
    partRotation: RigidbodyVector3Tuple | undefined,
  ): boolean => {
    const sourceVertices = Array.isArray(vertices) ? vertices : []
    if (sourceVertices.length < 4) {
      return false
    }
    const validVertices: RigidbodyVector3Tuple[] = []
    for (const vertex of sourceVertices) {
      if (!Array.isArray(vertex) || vertex.length < 3) {
        return false
      }
      const x = Number(vertex[0])
      const y = Number(vertex[1])
      const z = Number(vertex[2])
      if (![x, y, z].every((value) => Number.isFinite(value))) {
        return false
      }
      validVertices.push([x, y, z])
    }
    const baseIndex = positions.length / 3
    const partOffsetTuple = partOffset ?? [0, 0, 0]
    partOffsetHelper.set(
      (partOffsetTuple[0] ?? 0) * scaleX,
      (partOffsetTuple[1] ?? 0) * scaleY,
      (partOffsetTuple[2] ?? 0) * scaleZ,
    ).applyQuaternion(shapeQuaternion)
    const partRotationTuple = partRotation ?? [0, 0, 0]
    partQuaternionHelper
      .setFromEuler(new THREE.Euler(partRotationTuple[0] ?? 0, partRotationTuple[1] ?? 0, partRotationTuple[2] ?? 0, 'XYZ'))
      .normalize()
    validVertices.forEach((vertex) => {
      pointHelper
        .set(vertex[0] * scaleX, vertex[1] * scaleY, vertex[2] * scaleZ)
        .applyQuaternion(partQuaternionHelper)
        .applyQuaternion(shapeQuaternion)
        .add(partOffsetHelper)
      positions.push(pointHelper.x, pointHelper.y, pointHelper.z)
    })
    if (!Array.isArray(faces)) {
      return true
    }
    faces.forEach((face) => {
      if (!Array.isArray(face) || face.length < 3) {
        return
      }
      const first = Math.trunc(Number(face[0]))
      if (!Number.isInteger(first) || first < 0 || first >= validVertices.length) {
        return
      }
      for (let index = 1; index + 1 < face.length; index += 1) {
        const b = Math.trunc(Number(face[index]))
        const c = Math.trunc(Number(face[index + 1]))
        if (!Number.isInteger(b) || !Number.isInteger(c)) {
          continue
        }
        if (b < 0 || c < 0 || b >= validVertices.length || c >= validVertices.length) {
          continue
        }
        indices.push(baseIndex + first, baseIndex + b, baseIndex + c)
      }
    })
    return true
  }

  if (shape.kind === 'convex') {
    appendPart(shape.vertices, shape.faces, undefined, undefined)
  } else if (shape.kind === 'convex-mesh') {
    const parts = Array.isArray(shape.parts) ? shape.parts : []
    parts.forEach((part) => {
      appendPart(part.vertices, part.faces, part.offset, part.rotation)
    })
  } else {
    return null
  }

  if (positions.length < 12 || indices.length < 3) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, offset }
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
}): EditableColliderShape | null {
  const { kind, samplingObject, scale } = params
  if (kind === 'convex') {
    return null
  }
  samplingObject.updateMatrixWorld(true)
  // The sampling object carries the node world transform on its root, mirroring the
  // export pipeline. Shape data lives in the host-local (pre-scale) frame, so measure
  // bounds in that frame and map them into the collider overlay's world-scaled space.
  const localBounds = computeColliderLocalBoundingBox(samplingObject)
  if (!localBounds || localBounds.isEmpty()) {
    return null
  }
  const size = localBounds.getSize(new THREE.Vector3())
  const center = localBounds.getCenter(new THREE.Vector3()).multiply(scale)

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
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.x * scale.x || COLLIDER_DEFAULT_MIN_SIZE),
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.y * scale.y || COLLIDER_DEFAULT_MIN_SIZE),
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.z * scale.z || COLLIDER_DEFAULT_MIN_SIZE),
      ),
      offset: center,
      rotation: new THREE.Euler(),
    }
  }
  if (kind === 'sphere') {
    const dominant = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) || 1
    const diameter = Math.max(COLLIDER_DEFAULT_MIN_SIZE, Math.max(size.x, size.y, size.z) * dominant)
    return {
      kind,
      dimensions: new THREE.Vector3(diameter, diameter, diameter),
      offset: center,
      rotation: new THREE.Euler(),
    }
  }
  const lateral = Math.max(Math.abs(scale.x), Math.abs(scale.z)) || 1
  const diameter = Math.max(COLLIDER_DEFAULT_MIN_SIZE, Math.max(size.x, size.z) * lateral)
  const height = Math.max(diameter, (size.y || diameter) * Math.abs(scale.y || 1))
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
  return null
}

export function buildColliderMetadataPayload(params: {
  kind: ColliderShapeKind
  colliderGroup: THREE.Object3D
  scale: THREE.Vector3
}): { shape: RigidbodyPhysicsShape } | null {
  const { kind, colliderGroup, scale } = params

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

  return null
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
