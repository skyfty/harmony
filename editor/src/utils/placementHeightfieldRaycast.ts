import * as THREE from 'three'

export type PlacementHeightfieldBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  cellSize: number
}

type HeightfieldSampler = (worldX: number, worldZ: number) => number | null

function intersectRayWithBounds(
  ray: THREE.Ray,
  bounds: PlacementHeightfieldBounds,
): { min: number; max: number } | null {
  const epsilon = 1e-8
  let tMin = 0
  let tMax = Number.POSITIVE_INFINITY

  const updateSlab = (origin: number, direction: number, min: number, max: number): boolean => {
    if (Math.abs(direction) < epsilon) {
      return origin >= min && origin <= max
    }
    const inverse = 1 / direction
    let first = (min - origin) * inverse
    let second = (max - origin) * inverse
    if (first > second) {
      const swap = first
      first = second
      second = swap
    }
    tMin = Math.max(tMin, first)
    tMax = Math.min(tMax, second)
    return tMax >= tMin
  }

  if (
    !updateSlab(ray.origin.x, ray.direction.x, bounds.minX, bounds.maxX)
    || !updateSlab(ray.origin.y, ray.direction.y, bounds.minY, bounds.maxY)
    || !updateSlab(ray.origin.z, ray.direction.z, bounds.minZ, bounds.maxZ)
  ) {
    return null
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax < 0) {
    return null
  }
  return { min: Math.max(0, tMin), max: tMax }
}

/**
 * Finds the first ray/heightfield crossing inside a world-space AABB.
 *
 * The coarse march uses the runtime cell size, then a short bisection keeps the
 * returned point accurate enough for asset placement without touching mesh data.
 */
export function intersectRayWithPlacementHeightfield(
  ray: THREE.Ray,
  bounds: PlacementHeightfieldBounds,
  sampleHeight: HeightfieldSampler,
  maxSteps = 4096,
): THREE.Vector3 | null {
  const interval = intersectRayWithBounds(ray, bounds)
  if (!interval) {
    return null
  }

  const cellSize = Number.isFinite(bounds.cellSize) && bounds.cellSize > 0
    ? bounds.cellSize
    : 1
  const step = Math.max(0.25, cellSize * 0.5)
  const heightAt = (t: number): number | null => {
    const x = ray.origin.x + ray.direction.x * t
    const z = ray.origin.z + ray.direction.z * t
    const y = ray.origin.y + ray.direction.y * t
    const height = sampleHeight(x, z)
    return Number.isFinite(height) ? y - (height as number) : null
  }

  let previousT = interval.min
  let previousDelta = heightAt(previousT)
  if (previousDelta == null) {
    return null
  }
  if (previousDelta <= 0) {
    const point = ray.at(previousT, new THREE.Vector3())
    const height = sampleHeight(point.x, point.z)
    return Number.isFinite(height)
      ? new THREE.Vector3(point.x, height as number, point.z)
      : null
  }

  for (let index = 0; index < maxSteps && previousT <= interval.max; index += 1) {
    const nextT = Math.min(interval.max, previousT + step)
    const nextDelta = heightAt(nextT)
    if (nextDelta == null) {
      return null
    }
    if (nextDelta <= 0) {
      let low = previousT
      let high = nextT
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const middle = (low + high) * 0.5
        const middleDelta = heightAt(middle)
        if (middleDelta == null) {
          break
        }
        if (middleDelta > 0) {
          low = middle
        } else {
          high = middle
        }
      }
      const point = ray.at(high, new THREE.Vector3())
      const height = sampleHeight(point.x, point.z)
      return Number.isFinite(height)
        ? new THREE.Vector3(point.x, height as number, point.z)
        : null
    }
    previousT = nextT
    previousDelta = nextDelta
    if (previousT >= interval.max) {
      break
    }
  }

  return null
}
