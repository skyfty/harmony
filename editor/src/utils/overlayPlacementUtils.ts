import * as THREE from 'three'

export type Vec3 = { x: number; y: number; z: number }

/**
 * Offset a polyline by a horizontal (perpendicular) and vertical (along-tangent) amount.
 * horiz: lateral offset in meters (positive to the right of tangent)
 * vert: longitudinal offset in meters (positive forward along tangent)
 */
export function offsetPolyline(points: Vec3[], horiz: number, vert: number): Vec3[] {
  const out: Vec3[] = []
  if (!points || points.length === 0) return out
  const n = points.length
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3(points[i]!.x, points[i]!.y, points[i]!.z)
    const prevIdx = i === 0 ? (n > 1 ? 0 : 0) : i - 1
    const nextIdx = i === n - 1 ? (n > 1 ? n - 1 : 0) : i + 1
    const prev = new THREE.Vector3(points[prevIdx]!.x, points[prevIdx]!.y, points[prevIdx]!.z)
    const next = new THREE.Vector3(points[nextIdx]!.x, points[nextIdx]!.y, points[nextIdx]!.z)
    let tangent = new THREE.Vector3().subVectors(next, prev)
    if (tangent.lengthSq() < 1e-8) {
      tangent = new THREE.Vector3().subVectors(next, p)
      if (tangent.lengthSq() < 1e-8) {
        tangent = new THREE.Vector3(1, 0, 0)
      }
    }
    tangent.y = 0
    tangent.normalize()
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x)
    if (perp.lengthSq() < 1e-8) {
      perp.set(1, 0, 0)
    } else {
      perp.normalize()
    }
    const shifted = new THREE.Vector3()
    shifted.copy(p).addScaledVector(perp, horiz).addScaledVector(tangent, vert)
    out.push({ x: shifted.x, y: shifted.y, z: shifted.z })
  }
  return out
}

/**
 * Generate multiple parallel polylines offset laterally so they don't overlap.
 * count: number of parallel lines to create. spacing: center-to-center spacing in meters.
 * Returns array of polylines, each is an array of Vec3 points.
 */
export function generateParallelPolylines(points: Vec3[], count: number, spacing: number, vertOffset = 0): Vec3[][] {
  if (count <= 1) return [offsetPolyline(points, 0, vertOffset)]
  const polylines: Vec3[][] = []
  const half = (count - 1) / 2
  for (let i = 0; i < count; i++) {
    const lateralIndex = i - half
    const lateralOffset = lateralIndex * spacing
    polylines.push(offsetPolyline(points, lateralOffset, vertOffset))
  }
  return polylines
}

export default {
  offsetPolyline,
  generateParallelPolylines,
}
