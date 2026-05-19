import * as THREE from 'three'
import type { PlaySoundBehaviorParams } from './index'
import { WATER_SURFACE_MESH_USERDATA_KEY } from './waterSurfaceMesh'

const SOUND_SOURCE_FLATNESS_THRESHOLD = 0.35

const sourceBox = new THREE.Box3()
const sourceSize = new THREE.Vector3()
const sourceCenter = new THREE.Vector3()

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function normalizeDistanceRange(startMeters: number, endMeters: number): { start: number; end: number } {
  const start = Math.max(0, startMeters || 0)
  const end = Math.max(start, endMeters || start)
  return { start, end }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasPlaneSourceHint(object: THREE.Object3D): boolean {
  let hinted = false
  object.traverse((child) => {
    if (hinted) {
      return
    }
    const userData = isPlainObject(child.userData) ? child.userData : null
    if (!userData) {
      return
    }
    if (userData.dynamicMeshType === 'Floor' || userData.dynamicMeshType === 'Region' || userData.dynamicMeshType === 'WaterSurface') {
      hinted = true
      return
    }
    if (userData.landformSurface === true) {
      hinted = true
      return
    }
    if (userData[WATER_SURFACE_MESH_USERDATA_KEY] != null) {
      hinted = true
    }
  })
  return hinted
}

function projectPointToFlatBoundingBox(
  box: THREE.Box3,
  listenerPosition: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  const point = target.copy(listenerPosition)
  point.x = clamp(point.x, box.min.x, box.max.x)
  point.y = clamp(point.y, box.min.y, box.max.y)
  point.z = clamp(point.z, box.min.z, box.max.z)

  const center = box.getCenter(sourceCenter)
  const size = box.getSize(sourceSize)
  const extents = [size.x, size.y, size.z]
  const smallestAxisIndex = extents.indexOf(Math.min(...extents))
  if (smallestAxisIndex === 0) {
    point.x = center.x
  } else if (smallestAxisIndex === 1) {
    point.y = center.y
  } else {
    point.z = center.z
  }
  return point
}

export function resolvePlaySoundSourcePoint(
  object: THREE.Object3D | null | undefined,
  listenerPosition: THREE.Vector3 | null | undefined,
  target: THREE.Vector3,
): THREE.Vector3 | null {
  if (!object || !listenerPosition) {
    return null
  }

  object.updateMatrixWorld(true)
  sourceBox.setFromObject(object)
  if (!Number.isFinite(sourceBox.min.x) || !Number.isFinite(sourceBox.max.x)) {
    object.getWorldPosition(target)
    return target
  }

  const size = sourceBox.getSize(sourceSize)
  const largestExtent = Math.max(size.x, size.y, size.z)
  const smallestExtent = Math.min(size.x, size.y, size.z)
  const shouldProjectToPlane = hasPlaneSourceHint(object) || (largestExtent > 0 && smallestExtent <= largestExtent * SOUND_SOURCE_FLATNESS_THRESHOLD)

  if (!shouldProjectToPlane) {
    object.getWorldPosition(target)
    return target
  }

  return projectPointToFlatBoundingBox(sourceBox, listenerPosition, target)
}

export function computePlaySoundDistanceGain(
  params: Pick<
    PlaySoundBehaviorParams,
    | 'spatial'
    | 'refDistanceMeters'
    | 'maxDistanceMeters'
    | 'rolloffFactor'
    | 'distanceResponseMode'
    | 'distanceResponseStartMeters'
    | 'distanceResponseEndMeters'
    | 'distanceResponseSuppressedGain'
    | 'distanceResponseCurvePower'
  >,
  distanceMeters: number | null | undefined,
): number {
  if (!params.spatial) {
    return 1
  }
  if (!Number.isFinite(distanceMeters)) {
    return 0
  }
  const distance = Math.max(0, distanceMeters ?? 0)
  const refDistance = Math.max(0.001, params.refDistanceMeters || 1)
  const maxDistance = Math.max(refDistance, params.maxDistanceMeters || refDistance)
  if (distance >= maxDistance) {
    return 0
  }
  const normalizedBase = Math.max(
    0,
    1 - Math.max(0, distance - refDistance) / Math.max(0.001, maxDistance - refDistance),
  )
  const baseGain = Math.pow(normalizedBase, Math.max(0.01, params.rolloffFactor || 1))
  if (params.distanceResponseMode === 'off') {
    return clamp01(baseGain)
  }

  const { start, end } = normalizeDistanceRange(
    params.distanceResponseStartMeters,
    params.distanceResponseEndMeters,
  )
  const range = Math.max(0.001, end - start)
  const alpha = clamp01((distance - start) / range)
  const curveAlpha = Math.pow(alpha, Math.max(0.01, params.distanceResponseCurvePower || 1))
  const suppressedGain = clamp01(params.distanceResponseSuppressedGain)

  const responseGain = params.distanceResponseMode === 'near-quiet'
    ? suppressedGain + (1 - suppressedGain) * curveAlpha
    : 1 - (1 - suppressedGain) * curveAlpha

  return clamp01(baseGain * responseGain)
}