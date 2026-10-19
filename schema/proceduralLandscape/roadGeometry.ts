import type { RoadTraceNode } from './roadTrace'

export interface RoadGeometryValidation {
  valid: boolean
  minCenterlineClearance: number
  minTurnRadius: number
  maxHeadingChangeRad: number
}

/**
 * Reject centerlines that fold back onto themselves or turn more tightly than
 * the generated road band can represent. Adjacent samples are ignored because
 * their spacing naturally shrinks on curves.
 */
export function validateRoadCenterlineGeometry(
  nodes: ReadonlyArray<RoadTraceNode>,
  options: {
    clearance: number
    minimumTurnRadius: number
    maximumHeadingChangeRad?: number
    /** Treat the repeated last node as the closure of a ring, not a hairpin. */
    closed?: boolean
  },
): RoadGeometryValidation {
  if (nodes.length < 5) {
    return {
      valid: true,
      minCenterlineClearance: Number.POSITIVE_INFINITY,
      minTurnRadius: Number.POSITIVE_INFINITY,
      maxHeadingChangeRad: 0,
    }
  }
  const closed = options.closed === true
    && nodes.length > 3
    && Math.hypot(
      nodes[0]!.x - nodes[nodes.length - 1]!.x,
      nodes[0]!.z - nodes[nodes.length - 1]!.z,
    ) <= 0.5
  const samples = closed ? nodes.slice(0, -1) : nodes
  const cumulative = new Float64Array(samples.length)
  for (let index = 1; index < samples.length; index += 1) {
    cumulative[index] = cumulative[index - 1]!
      + Math.hypot(
        samples[index]!.x - samples[index - 1]!.x,
        samples[index]!.z - samples[index - 1]!.z,
      )
  }
  const totalLength = cumulative[samples.length - 1]!
    + Math.hypot(
      samples[0]!.x - samples[samples.length - 1]!.x,
      samples[0]!.z - samples[samples.length - 1]!.z,
    )
  const minimumPathSeparation = Math.max(
    options.clearance * 2,
    options.minimumTurnRadius * 2,
  )
  let minCenterlineClearance = Number.POSITIVE_INFINITY
  const bucketSize = Math.max(32, options.clearance * 2)
  const buckets = new Map<string, number[]>()
  for (let index = 0; index < samples.length; index += 1) {
    const node = samples[index]!
    const key = `${Math.floor(node.x / bucketSize)}:${Math.floor(node.z / bucketSize)}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(index)
    } else {
      buckets.set(key, [index])
    }
  }
  for (let index = 0; index < samples.length; index += 1) {
    const first = samples[index]!
    const bucketX = Math.floor(first.x / bucketSize)
    const bucketZ = Math.floor(first.z / bucketSize)
    search: for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = buckets.get(`${bucketX + dx}:${bucketZ + dz}`)
        if (!bucket) {
          continue
        }
        for (const other of bucket) {
          if (other <= index + 3) {
            continue
          }
          const linearSeparation = cumulative[other]! - cumulative[index]!
          const pathSeparation = closed
            ? Math.min(linearSeparation, totalLength - linearSeparation)
            : linearSeparation
          if (pathSeparation < minimumPathSeparation) {
            continue
          }
          const second = samples[other]!
          minCenterlineClearance = Math.min(
            minCenterlineClearance,
            Math.hypot(first.x - second.x, first.z - second.z),
          )
          if (minCenterlineClearance < options.clearance) {
            break search
          }
        }
      }
    }
    if (minCenterlineClearance < options.clearance) {
      break
    }
  }

  let minTurnRadius = Number.POSITIVE_INFINITY
  let maxHeadingChangeRad = 0
  for (let index = 0; index < samples.length; index += 1) {
    if (!closed && (index === 0 || index + 1 >= samples.length)) {
      continue
    }
    const previous = samples[(index - 1 + samples.length) % samples.length]!
    const current = samples[index]!
    const next = samples[(index + 1) % samples.length]!
    const a = Math.hypot(current.x - previous.x, current.z - previous.z)
    const b = Math.hypot(next.x - current.x, next.z - current.z)
    const c = Math.hypot(next.x - previous.x, next.z - previous.z)
    if (a <= 1e-6 || b <= 1e-6 || c <= 1e-6) {
      continue
    }
    const incomingHeading = Math.atan2(
      current.z - previous.z,
      current.x - previous.x,
    )
    const outgoingHeading = Math.atan2(
      next.z - current.z,
      next.x - current.x,
    )
    let headingChange = outgoingHeading - incomingHeading
    while (headingChange > Math.PI) headingChange -= Math.PI * 2
    while (headingChange < -Math.PI) headingChange += Math.PI * 2
    maxHeadingChangeRad = Math.max(maxHeadingChangeRad, Math.abs(headingChange))
    const twiceArea = Math.abs(
      (current.x - previous.x) * (next.z - previous.z)
      - (current.z - previous.z) * (next.x - previous.x),
    )
    if (twiceArea <= 1e-7) {
      continue
    }
    const radius = (a * b * c) / (2 * twiceArea)
    if (radius < minTurnRadius) {
      minTurnRadius = radius
    }
    if (minTurnRadius < options.minimumTurnRadius) {
      break
    }
  }

  return {
    valid: minCenterlineClearance >= options.clearance
      // Piecewise-circumradius measurements carry a few centimetres of
      // discretisation error at 2m spacing; keep the 20m design limit
      // without rejecting a visually identical 19.98m sample.
      && minTurnRadius >= options.minimumTurnRadius - 0.05
      && maxHeadingChangeRad <= (
        options.maximumHeadingChangeRad ?? Math.PI
      ),
    minCenterlineClearance,
    minTurnRadius,
    maxHeadingChangeRad,
  }
}
