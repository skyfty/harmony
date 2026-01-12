import * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import type { RigidbodyPhysicsShape } from '@schema/components'

export type ColliderScaleFactors = { x: number; y: number; z: number }

const COLLIDER_SCALE_EPSILON = 1e-4
export const DEFAULT_COLLIDER_SCALE: ColliderScaleFactors = { x: 1, y: 1, z: 1 }

const colliderBoxMatrixHelper = new THREE.Matrix4()
const colliderBoxInverseHelper = new THREE.Matrix4()
const colliderBoxScratch = new THREE.Box3()
const colliderBoxSizeHelper = new THREE.Vector3()
const colliderBoxCenterHelper = new THREE.Vector3()

export function normalizeColliderScale(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 1
  const abs = Math.abs(numeric)
  return abs > COLLIDER_SCALE_EPSILON ? abs : 1
}

export function resolveNodeScaleFactors(node: SceneNode | null | undefined): ColliderScaleFactors {
  return {
    x: normalizeColliderScale(node?.scale?.x),
    y: normalizeColliderScale(node?.scale?.y),
    z: normalizeColliderScale(node?.scale?.z),
  }
}

export function computeColliderLocalBoundingBox(object: THREE.Object3D): THREE.Box3 | null {
  object.updateWorldMatrix(true, true)
  const result = new THREE.Box3()
  colliderBoxInverseHelper.copy(object.matrixWorld).invert()
  let hasBox = false
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (!geometry || typeof geometry.computeBoundingBox !== 'function') {
      return
    }
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }
    if (!geometry.boundingBox) {
      return
    }
    colliderBoxScratch.copy(geometry.boundingBox)
    colliderBoxMatrixHelper.copy(child.matrixWorld).premultiply(colliderBoxInverseHelper)
    colliderBoxScratch.applyMatrix4(colliderBoxMatrixHelper)
    if (!hasBox) {
      result.copy(colliderBoxScratch)
      hasBox = true
    } else {
      result.union(colliderBoxScratch)
    }
  })
  return hasBox ? result : null
}

export function buildBoxShapeFromObject(
  object: THREE.Object3D,
  scaleFactors: ColliderScaleFactors = DEFAULT_COLLIDER_SCALE,
): RigidbodyPhysicsShape | null {
  const box = computeColliderLocalBoundingBox(object)
  if (!box) {
    return null
  }
  const size = box.getSize(colliderBoxSizeHelper)
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
    return null
  }
  const halfExtents: [number, number, number] = [
    Math.max(1e-4, (size.x * 0.5) / scaleFactors.x),
    Math.max(1e-4, (size.y * 0.5) / scaleFactors.y),
    Math.max(1e-4, (size.z * 0.5) / scaleFactors.z),
  ]
  const center = box.getCenter(colliderBoxCenterHelper)
  const offset: [number, number, number] = [
    center.x / scaleFactors.x,
    center.y / scaleFactors.y,
    center.z / scaleFactors.z,
  ]
  return {
    kind: 'box',
    halfExtents,
    offset,
    applyScale: true,
  }
}

export function buildSphereShapeFromObject(
  object: THREE.Object3D,
  scaleFactors: ColliderScaleFactors = DEFAULT_COLLIDER_SCALE,
): RigidbodyPhysicsShape | null {
  const box = computeColliderLocalBoundingBox(object)
  if (!box) {
    return null
  }
  const size = box.getSize(colliderBoxSizeHelper)
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
    return null
  }
  const dominantScale = Math.max(scaleFactors.x, scaleFactors.y, scaleFactors.z)
  const rawRadius = Math.max(size.x, size.y, size.z) * 0.5
  const normalizedRadius = Math.max(1e-4, rawRadius / dominantScale)
  const center = box.getCenter(colliderBoxCenterHelper)
  return {
    kind: 'sphere',
    radius: normalizedRadius,
    offset: [
      center.x / scaleFactors.x,
      center.y / scaleFactors.y,
      center.z / scaleFactors.z,
    ],
    applyScale: true,
  }
}

export function buildCylinderShapeFromObject(
  object: THREE.Object3D,
  scaleFactors: ColliderScaleFactors = DEFAULT_COLLIDER_SCALE,
): RigidbodyPhysicsShape | null {
  const box = computeColliderLocalBoundingBox(object)
  if (!box) {
    return null
  }
  const size = box.getSize(colliderBoxSizeHelper)
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
    return null
  }
  const radius = Math.max(size.x, size.z) * 0.5
  const dominantHorizontalScale = Math.max(scaleFactors.x, scaleFactors.z)
  const normalizedRadius = Math.max(1e-4, radius / dominantHorizontalScale)
  const normalizedHeight = Math.max(1e-4, size.y / scaleFactors.y)
  const center = box.getCenter(colliderBoxCenterHelper)
  return {
    kind: 'cylinder',
    radiusTop: normalizedRadius,
    radiusBottom: normalizedRadius,
    height: normalizedHeight,
    segments: 16,
    offset: [
      center.x / scaleFactors.x,
      center.y / scaleFactors.y,
      center.z / scaleFactors.z,
    ],
    applyScale: true,
  }
}
