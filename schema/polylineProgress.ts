import * as THREE from 'three'

export type PolylineMetricMode = '3d' | 'xz'

export type PolylineMetricData = {
  segmentLengths: number[]
  segmentStarts: number[]
  totalLength: number
  closed: boolean
  mode: PolylineMetricMode
}

export type PolylineProjectionResult = {
  segmentIndex: number
  t: number
  /** Arc-length along the polyline in meters (in the chosen mode). */
  s: number
  distanceSq: number
  /** Closest point on the polyline (in world space). */
  closestPoint: THREE.Vector3
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

export function buildPolylineMetricData(
  points: readonly THREE.Vector3[],
  options: { closed: boolean; mode?: PolylineMetricMode },
): PolylineMetricData | null {
  const closed = Boolean(options?.closed)
  const mode: PolylineMetricMode = options?.mode ?? '3d'

  if (!points || points.length < 2) {
    return null
  }
  const segmentCount = closed ? points.length : points.length - 1
  if (segmentCount <= 0) {
    return null
  }

  const segmentLengths = new Array<number>(segmentCount)
  const segmentStarts = new Array<number>(segmentCount)
  let totalLength = 0

  for (let i = 0; i < segmentCount; i += 1) {
    segmentStarts[i] = totalLength
    const a = points[i]!
    const b = points[(i + 1) % points.length]!

    let len = 0
    if (mode === 'xz') {
      const dx = b.x - a.x
      const dz = b.z - a.z
      len = Math.sqrt(dx * dx + dz * dz)
    } else {
      len = a.distanceTo(b)
    }

    const safeLen = Number.isFinite(len) ? Math.max(0, len) : 0
    segmentLengths[i] = safeLen
    totalLength += safeLen
  }

  return { segmentLengths, segmentStarts, totalLength, closed, mode }
}

export function buildPolylineVertexArcLengths(points: readonly THREE.Vector3[], data: PolylineMetricData): number[] {
  const n = points.length
  const result = new Array<number>(n)
  if (n <= 0) {
    return result
  }

  result[0] = 0
  // For open polylines, vertex i is the start of segment i (except the last vertex which is totalLength).
  // For closed polylines, every vertex i is the start of segment i.
  for (let i = 1; i < n; i += 1) {
    if (!data.closed && i === n - 1) {
      result[i] = data.totalLength
    } else {
      const segIndex = Math.min(i, data.segmentStarts.length - 1)
      result[i] = data.segmentStarts[segIndex] ?? 0
    }
  }

  return result
}

export function projectPointToPolyline(
  points: readonly THREE.Vector3[],
  data: PolylineMetricData,
  position: THREE.Vector3,
  outClosest?: THREE.Vector3,
): PolylineProjectionResult {
  const px = position.x
  const py = position.y
  const pz = position.z

  let bestSegmentIndex = 0
  let bestT = 0
  let bestDistanceSq = Number.POSITIVE_INFINITY
  let bestS = 0

  const segmentCount = data.segmentLengths.length
  for (let i = 0; i < segmentCount; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!

    let t = 0
    let cx = a.x
    let cy = a.y
    let cz = a.z

    if (data.mode === 'xz') {
      const abx = b.x - a.x
      const abz = b.z - a.z
      const apx = px - a.x
      const apz = pz - a.z
      const denom = abx * abx + abz * abz
      const tRaw = denom > 1e-12 ? (apx * abx + apz * abz) / denom : 0
      t = clamp01(tRaw)
      cx = a.x + abx * t
      cz = a.z + abz * t
      cy = a.y + (b.y - a.y) * t
      const dx = px - cx
      const dz = pz - cz
      const dSq = dx * dx + dz * dz
      if (dSq < bestDistanceSq) {
        bestDistanceSq = dSq
        bestSegmentIndex = i
        bestT = t
        bestS = (data.segmentStarts[i] ?? 0) + (data.segmentLengths[i] ?? 0) * t
      }
    } else {
      const abx = b.x - a.x
      const aby = b.y - a.y
      const abz = b.z - a.z
      const apx = px - a.x
      const apy = py - a.y
      const apz = pz - a.z
      const denom = abx * abx + aby * aby + abz * abz
      const tRaw = denom > 1e-12 ? (apx * abx + apy * aby + apz * abz) / denom : 0
      t = clamp01(tRaw)
      cx = a.x + abx * t
      cy = a.y + aby * t
      cz = a.z + abz * t
      const dx = px - cx
      const dy = py - cy
      const dz = pz - cz
      const dSq = dx * dx + dy * dy + dz * dz
      if (dSq < bestDistanceSq) {
        bestDistanceSq = dSq
        bestSegmentIndex = i
        bestT = t
        bestS = (data.segmentStarts[i] ?? 0) + (data.segmentLengths[i] ?? 0) * t
      }
    }
  }

  const closestPoint = outClosest ?? new THREE.Vector3()
  const a = points[bestSegmentIndex]!
  const b = points[(bestSegmentIndex + 1) % points.length]!
  if (data.mode === 'xz') {
    closestPoint.set(
      a.x + (b.x - a.x) * bestT,
      a.y + (b.y - a.y) * bestT,
      a.z + (b.z - a.z) * bestT,
    )
  } else {
    closestPoint.set(
      a.x + (b.x - a.x) * bestT,
      a.y + (b.y - a.y) * bestT,
      a.z + (b.z - a.z) * bestT,
    )
  }

  return {
    segmentIndex: bestSegmentIndex,
    t: bestT,
    s: bestS,
    distanceSq: bestDistanceSq,
    closestPoint,
  }
}

export function samplePolylineAtS(
  points: readonly THREE.Vector3[],
  data: PolylineMetricData,
  s: number,
  out: THREE.Vector3,
): void {
  if (!Number.isFinite(s)) {
    s = 0
  }

  const total = data.totalLength
  if (total <= 1e-8) {
    const first = points[0]!
    out.copy(first)
    return
  }

  let normalizedS = s
  if (data.closed) {
    normalizedS = ((normalizedS % total) + total) % total
  } else {
    normalizedS = Math.max(0, Math.min(total, normalizedS))
  }

  let segIndex = 0
  for (let i = 0; i < data.segmentStarts.length; i += 1) {
    const start = data.segmentStarts[i]!
    const end = start + data.segmentLengths[i]!
    if (normalizedS <= end || i === data.segmentStarts.length - 1) {
      segIndex = i
      break
    }
  }

  const segStart = data.segmentStarts[segIndex]!
  const segLen = Math.max(1e-8, data.segmentLengths[segIndex]!)
  const t = clamp01((normalizedS - segStart) / segLen)

  const a = points[segIndex]!
  const b = points[(segIndex + 1) % points.length]!
  out.set(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  )
}
