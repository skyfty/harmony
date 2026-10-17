import type { TerrainHeightGrid } from './terrainSampler'
import type { RoadWaypoint } from './roadWaypoints'

export interface EndpointRoadPathOptions {
  maxDeviation: number
  roadHalfWidth: number
  shoulderWidth: number
  maxSlope: number
  seed: number
}

export interface EndpointRoadPathResult {
  guide: RoadWaypoint[]
  /** Largest lateral distance of the selected guide from the straight chord. */
  maxDeviation: number
  warning: string | null
}

const OFFSETS = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1] as const

function cubic(
  t: number,
  p0: RoadWaypoint,
  p1: RoadWaypoint,
  p2: RoadWaypoint,
  p3: RoadWaypoint,
): RoadWaypoint {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  }
}

function sampleCandidate(
  grid: TerrainHeightGrid,
  start: RoadWaypoint,
  end: RoadWaypoint,
  tangentX: number,
  tangentZ: number,
  normalX: number,
  normalZ: number,
  chordLength: number,
  d1: number,
  d2: number,
  sampleStep: number,
  options: EndpointRoadPathOptions,
  allowedDeviation: number,
): { cost: number; guide: RoadWaypoint[]; lateral: number } | null {
  const p1 = {
    x: start.x + tangentX * chordLength / 3 + normalX * d1,
    z: start.z + tangentZ * chordLength / 3 + normalZ * d1,
  }
  const p2 = {
    x: end.x - tangentX * chordLength / 3 + normalX * d2,
    z: end.z - tangentZ * chordLength / 3 + normalZ * d2,
  }
  const count = Math.max(2, Math.ceil(chordLength / sampleStep))
  const samples: Array<RoadWaypoint & { y: number }> = []
  let cost = 0
  let maxLateral = 0
  let previousY: number | null = null
  let previousHeading: number | null = null
  for (let i = 0; i <= count; i += 1) {
    const point = i === 0 ? start : i === count ? end : cubic(i / count, start, p1, p2, end)
    const lateral = (point.x - start.x) * normalX + (point.z - start.z) * normalZ
    if (Math.abs(lateral) > allowedDeviation + 0.5 || !grid.contains(point.x, point.z)) {
      return null
    }
    maxLateral = Math.max(maxLateral, Math.abs(lateral))
    const y = grid.sampleHeight(point.x, point.z)
    if (y == null) {
      return null
    }
    const segment = i === 0 ? 0 : Math.hypot(point.x - samples[i - 1]!.x, point.z - samples[i - 1]!.z)
    if (segment > 1e-4 && previousY != null) {
      const slope = Math.abs(y - previousY) / segment
      if (slope > options.maxSlope * 1.08) {
        return null
      }
      cost += slope * 2.5
    }
    const lateralStep = Math.max(1, options.roadHalfWidth + options.shoulderWidth)
    const leftY = grid.sampleHeight(point.x - normalX * lateralStep, point.z - normalZ * lateralStep)
    const rightY = grid.sampleHeight(point.x + normalX * lateralStep, point.z + normalZ * lateralStep)
    if (leftY != null && rightY != null) {
      cost += Math.abs(leftY - rightY) / Math.max(1, lateralStep * 2) * 1.5
    }
    if (i > 0 && segment > 1e-4) {
      const heading = Math.atan2(point.z - samples[i - 1]!.z, point.x - samples[i - 1]!.x)
      if (previousHeading != null) {
        let delta = heading - previousHeading
        while (delta > Math.PI) delta -= Math.PI * 2
        while (delta < -Math.PI) delta += Math.PI * 2
        cost += Math.abs(delta) * 1.6
      }
      previousHeading = heading
    }
    cost += Math.abs(lateral) / Math.max(1, allowedDeviation) * 0.12
    samples.push({ x: point.x, z: point.z, y })
    previousY = y
  }
  if (!samples.length) {
    return null
  }
  // The road tracer expects a guide every ~16m so its waypoint smoothing does
  // not cut across switchbacks on long routes.
  const guideStep = Math.max(8, Math.min(16, chordLength / 32))
  const guide: RoadWaypoint[] = [{ x: samples[0]!.x, z: samples[0]!.z }]
  let distanceSinceGuide = 0
  for (let i = 1; i < samples.length; i += 1) {
    const from = samples[i - 1]!
    const to = samples[i]!
    const segmentLength = Math.hypot(to.x - from.x, to.z - from.z)
    if (segmentLength < 1e-6) {
      continue
    }
    let consumed = 0
    while (distanceSinceGuide + (segmentLength - consumed) >= guideStep) {
      consumed += guideStep - distanceSinceGuide
      const t = consumed / segmentLength
      guide.push({
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
      })
      distanceSinceGuide = 0
    }
    distanceSinceGuide += segmentLength - consumed
  }
  const last = samples[samples.length - 1]!
  const lastGuide = guide[guide.length - 1]!
  if (Math.hypot(lastGuide.x - last.x, lastGuide.z - last.z) < 1e-6) {
    guide[guide.length - 1] = { x: last.x, z: last.z }
  } else {
    guide.push({ x: last.x, z: last.z })
  }
  return { cost, guide, lateral: maxLateral }
}

/**
 * Find a smooth, bounded route between exactly two user endpoints. The
 * endpoints are hard constraints; intermediate path points are derived from a
 * terrain-aware cubic Bezier search and never written back into component props.
 */
export function planEndpointRoadGuide(
  grid: TerrainHeightGrid,
  start: RoadWaypoint,
  end: RoadWaypoint,
  options: EndpointRoadPathOptions,
): EndpointRoadPathResult {
  const chordX = end.x - start.x
  const chordZ = end.z - start.z
  const chordLength = Math.hypot(chordX, chordZ)
  if (chordLength < 0.5) {
    return { guide: [{ ...start }, { ...end }], maxDeviation: 0, warning: 'endpoint-path-too-short' }
  }
  const tangentX = chordX / chordLength
  const tangentZ = chordZ / chordLength
  const normalX = -tangentZ
  const normalZ = tangentX
  const allowedDeviation = Math.max(1, Math.min(options.maxDeviation, chordLength * 0.3))
  const sampleStep = Math.max(8, Math.min(32, chordLength / 512))
  let best: {
    cost: number
    guide: RoadWaypoint[]
    lateral: number
    d1: number
    d2: number
  } | null = null
  for (const n1 of OFFSETS) {
    for (const n2 of OFFSETS) {
      const d1 = n1 * allowedDeviation
      const d2 = n2 * allowedDeviation
      const result = sampleCandidate(
        grid,
        start,
        end,
        tangentX,
        tangentZ,
        normalX,
        normalZ,
        chordLength,
        d1,
        d2,
        sampleStep,
        options,
        allowedDeviation,
      )
      if (result && (!best || result.cost < best.cost - 1e-6)) {
        best = { ...result, d1, d2 }
      }
    }
  }
  if (!best) {
    return {
      guide: [{ ...start }, { ...end }],
      maxDeviation: 0,
      warning: 'endpoint-path-no-candidate',
    }
  }
  return {
    guide: best.guide,
    maxDeviation: Math.min(allowedDeviation, best.lateral),
    warning: null,
  }
}
