import * as THREE from 'three'

export type Vec3 = { x: number; y: number; z: number }
export type OffsetPolylineOptions = {
  closed?: boolean
}

const CLOSED_EPS = 1e-4

function isDuplicatedClosingPoint(points: Vec3[]): boolean {
  if (points.length < 2) {
    return false
  }
  const first = new THREE.Vector3(points[0]!.x, points[0]!.y, points[0]!.z)
  const last = new THREE.Vector3(points[points.length - 1]!.x, points[points.length - 1]!.y, points[points.length - 1]!.z)
  return first.distanceTo(last) <= CLOSED_EPS
}

function computeSignedAreaXZ(points: Vec3[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current.x * next.z - next.x * current.z
  }
  return area * 0.5
}

function normalizeClosedMarginWinding(points: Vec3[]): { points: Vec3[]; reversed: boolean } {
  if (points.length < 3) {
    return { points, reversed: false }
  }
  const area = computeSignedAreaXZ(points)
  if (Number.isFinite(area) && area > 0) {
    return { points: [...points].reverse(), reversed: true }
  }
  return { points, reversed: false }
}

/**
 * Offset a polyline by a horizontal (perpendicular) and vertical (along-tangent) margin.
 * horiz: lateral margin in meters. For closed contours, positive expands outward and negative insets.
 * vert: longitudinal margin in meters (positive forward along tangent)
 */
export function offsetPolyline(points: Vec3[], horiz: number, vert: number, options?: OffsetPolylineOptions): Vec3[] {
  // Edge-based offset: shift each segment, then intersect adjacent offset lines
  const out: Vec3[] = []
  if (!points || points.length === 0) return out
  const inferredClosed = isDuplicatedClosingPoint(points)
  const closed = options?.closed ?? inferredClosed
  const basePoints = inferredClosed ? points.slice(0, -1) : points
  const normalizedClosed = closed ? normalizeClosedMarginWinding(basePoints) : { points: basePoints, reversed: false }
  const workingPoints = normalizedClosed.points
  const n = workingPoints.length
  if (n === 1) {
    // Single point: shift by perp of X axis
    const p = workingPoints[0]!
    return [{ x: p.x - horiz, y: p.y, z: p.z }]
  }
  const isClosed = closed && n >= 3

  type Line2D = { p: THREE.Vector2; d: THREE.Vector2; end: THREE.Vector2 }
  const segLines: Line2D[] = []
  // build offset lines for each segment
  const segCount = isClosed ? n : n - 1
  for (let i = 0; i < segCount; i++) {
    const a = new THREE.Vector3(workingPoints[i]!.x, workingPoints[i]!.y, workingPoints[i]!.z)
    const b = new THREE.Vector3(workingPoints[(i + 1) % n]!.x, workingPoints[(i + 1) % n]!.y, workingPoints[(i + 1) % n]!.z)
    const dir3 = new THREE.Vector3().subVectors(b, a)
    dir3.y = 0
    if (dir3.lengthSq() < 1e-8) {
      dir3.set(1, 0, 0)
    }
    dir3.normalize()
    const perp3 = new THREE.Vector3(-dir3.z, 0, dir3.x)
    perp3.normalize()
    const aShift = new THREE.Vector3().copy(a).addScaledVector(perp3, horiz).addScaledVector(dir3, vert)
    const bShift = new THREE.Vector3().copy(b).addScaledVector(perp3, horiz).addScaledVector(dir3, vert)
    const p2 = new THREE.Vector2(aShift.x, aShift.z)
    const end2 = new THREE.Vector2(bShift.x, bShift.z)
    const d2 = new THREE.Vector2().subVectors(end2, p2)
    if (d2.lengthSq() < 1e-8) {
      d2.set(1, 0)
    }
    segLines.push({ p: p2, d: d2.normalize(), end: end2 })
  }

  function intersectLines(l1: Line2D, l2: Line2D): THREE.Vector2 | null {
    // solve l1.p + t*l1.d = l2.p + s*l2.d
    const a = l1.d.x
    const b = -l2.d.x
    const c = l1.d.y
    const d = -l2.d.y
    const e = l2.p.x - l1.p.x
    const f = l2.p.y - l1.p.y
    const det = a * d - b * c
    if (Math.abs(det) < 1e-8) {
      // parallel lines
      return null
    }
    const t = (e * d - b * f) / det
    const ip = new THREE.Vector2(l1.p.x + t * l1.d.x, l1.p.y + t * l1.d.y)
    return ip
  }

  if (isClosed) {
    // 闭合多边形：每个顶点都取相邻两条偏移线的交点
    for (let i = 0; i < n; i++) {
      const l1 = segLines[(i - 1 + n) % n]!
      const l2 = segLines[i]!
      const ip = intersectLines(l1, l2)
      if (ip) {
        out.push({ x: ip.x, y: workingPoints[i]!.y, z: ip.y })
      } else {
        // fallback: 取当前点的偏移
        const a = new THREE.Vector3(workingPoints[i]!.x, workingPoints[i]!.y, workingPoints[i]!.z)
        const dir3 = new THREE.Vector3().subVectors(
          new THREE.Vector3(workingPoints[(i + 1) % n]!.x, workingPoints[(i + 1) % n]!.y, workingPoints[(i + 1) % n]!.z),
          a
        )
        dir3.y = 0
        dir3.normalize()
        const perp3 = new THREE.Vector3(-dir3.z, 0, dir3.x)
        perp3.normalize()
        const fallback = new THREE.Vector3().copy(a).addScaledVector(perp3, horiz).addScaledVector(dir3, vert)
        out.push({ x: fallback.x, y: a.y, z: fallback.z })
      }
    }
    // 闭合：首尾不重复
    return normalizedClosed.reversed ? out.reverse() : out
  } else {
    // 开放链：首点、尾点直接用偏移，中间点用交点
    const firstLine = segLines[0]!
    out.push({ x: firstLine.p.x, y: workingPoints[0]!.y, z: firstLine.p.y })
    for (let i = 1; i < n - 1; i++) {
      const l1 = segLines[i - 1]!
      const l2 = segLines[i]!
      const ip = intersectLines(l1, l2)
      if (ip) {
        out.push({ x: ip.x, y: workingPoints[i]!.y, z: ip.y })
      } else {
        // fallback: 取当前点的偏移
        const a = new THREE.Vector3(workingPoints[i]!.x, workingPoints[i]!.y, workingPoints[i]!.z)
        const prevDir = new THREE.Vector3().subVectors(a, new THREE.Vector3(workingPoints[i - 1]!.x, workingPoints[i - 1]!.y, workingPoints[i - 1]!.z))
        prevDir.y = 0
        prevDir.normalize()
        const perp = new THREE.Vector3(-prevDir.z, 0, prevDir.x)
        const fallback = new THREE.Vector3().copy(a).addScaledVector(perp, horiz).addScaledVector(prevDir, vert)
        out.push({ x: fallback.x, y: a.y, z: fallback.z })
      }
    }
    const lastLine = segLines[segLines.length - 1]!
    out.push({ x: lastLine.end.x, y: workingPoints[n - 1]!.y, z: lastLine.end.y })
    return out
  }
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
