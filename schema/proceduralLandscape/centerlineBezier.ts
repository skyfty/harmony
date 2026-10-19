export type PlanarPathPoint = {
  x: number
  z: number
}

export interface BezierCenterlineOptions {
  radius: number
  sampleSpacing: number
  controlSpacing?: number
  closed?: boolean
  smoothingIterations?: number
  /** Points that must remain on the spline, typically mandatory waypoints. */
  anchorIndices?: readonly number[]
}

function distance(a: PlanarPathPoint, b: PlanarPathPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

function lerpPoint(a: PlanarPathPoint, b: PlanarPathPoint, t: number): PlanarPathPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

function curvatureRadius(
  a: PlanarPathPoint,
  b: PlanarPathPoint,
  c: PlanarPathPoint,
): number {
  const ab = distance(a, b)
  const bc = distance(b, c)
  const ca = distance(c, a)
  if (ab <= 1e-6 || bc <= 1e-6 || ca <= 1e-6) {
    return Number.POSITIVE_INFINITY
  }
  const twiceArea = Math.abs(
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x),
  )
  return twiceArea <= 1e-9
    ? Number.POSITIVE_INFINITY
    : (ab * bc * ca) / (2 * twiceArea)
}

export function minBezierCenterlineRadius(points: ReadonlyArray<PlanarPathPoint>): number {
  let minimum = Number.POSITIVE_INFINITY
  for (let index = 1; index < points.length - 1; index += 1) {
    minimum = Math.min(
      minimum,
      curvatureRadius(points[index - 1]!, points[index]!, points[index + 1]!),
    )
  }
  return minimum
}

function relaxCurvature(
  source: ReadonlyArray<PlanarPathPoint>,
  radius: number,
  closed: boolean,
  iterations: number,
  anchorIndices: ReadonlySet<number>,
): PlanarPathPoint[] {
  if (source.length < 3) {
    return source.map((point) => ({ ...point }))
  }
  let current = source.map((point) => ({ ...point }))
  const pointCount = current.length
  const limit = closed ? pointCount : pointCount - 2
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let changed = false
    for (let index = 0; index < limit; index += 1) {
      const currentIndex = closed ? index : index + 1
      if (anchorIndices.has(currentIndex)) {
        continue
      }
      const previous = current[(currentIndex - 1 + pointCount) % pointCount]!
      const point = current[currentIndex]!
      const next = current[(currentIndex + 1) % pointCount]!
      if (curvatureRadius(previous, point, next) >= radius) {
        continue
      }
      current[currentIndex] = lerpPoint(
        point,
        {
          x: (previous.x + next.x) * 0.5,
          z: (previous.z + next.z) * 0.5,
        },
        0.36,
      )
      changed = true
    }
    if (!changed) {
      break
    }
  }
  return current
}

function selectControlPoints(
  points: ReadonlyArray<PlanarPathPoint>,
  spacing: number,
  closed: boolean,
  anchorIndices: ReadonlySet<number>,
): PlanarPathPoint[] {
  if (points.length <= 2) {
    return points.map((point) => ({ ...point }))
  }
  const controlSpacing = Math.max(8, spacing)
  const controls: PlanarPathPoint[] = [{ ...points[0]! }]
  let accumulated = 0
  for (let index = 1; index < points.length; index += 1) {
    const segment = distance(points[index - 1]!, points[index]!)
    accumulated += segment
    const isLast = index === points.length - 1
    const isAnchor = anchorIndices.has(index)
    if (!isLast && !isAnchor && accumulated < controlSpacing) {
      continue
    }
    const point = points[index]!
    if (distance(controls[controls.length - 1]!, point) > 2) {
      controls.push({ ...point })
    }
    accumulated = 0
  }
  if (!closed) {
    const end = points[points.length - 1]!
    if (distance(controls[controls.length - 1]!, end) > 1e-4) {
      controls.push({ ...end })
    }
  }
  return controls
}

function sampleCubicBezier(
  start: PlanarPathPoint,
  controlA: PlanarPathPoint,
  controlB: PlanarPathPoint,
  end: PlanarPathPoint,
  spacing: number,
): PlanarPathPoint[] {
  const approximateLength = distance(start, controlA)
    + distance(controlA, controlB)
    + distance(controlB, end)
  const count = Math.max(2, Math.ceil(approximateLength / Math.max(0.5, spacing)))
  const points: PlanarPathPoint[] = []
  for (let step = 0; step <= count; step += 1) {
    const t = step / count
    const oneMinusT = 1 - t
    const b0 = oneMinusT ** 3
    const b1 = 3 * oneMinusT * oneMinusT * t
    const b2 = 3 * oneMinusT * t * t
    const b3 = t ** 3
    points.push({
      x: b0 * start.x + b1 * controlA.x + b2 * controlB.x + b3 * end.x,
      z: b0 * start.z + b1 * controlA.z + b2 * controlB.z + b3 * end.z,
    })
  }
  return points
}

/**
 * Curvature-limited Catmull-Rom spline represented as cubic Bezier segments.
 * The first pass relaxes only corners tighter than the requested radius; the
 * second resamples the relaxed polyline into well-spaced controls so A* grid
 * stair-steps are not reproduced by the spline.
 */
export function smoothPlanarCenterline(
  points: ReadonlyArray<PlanarPathPoint>,
  options: BezierCenterlineOptions,
): PlanarPathPoint[] {
  if (points.length < 3) {
    return points.map((point) => ({ ...point }))
  }
  const closed = options.closed === true
    && distance(points[0]!, points[points.length - 1]!) <= 0.5
  const source = closed && points.length > 1
    ? points.slice(0, -1)
    : points.map((point) => ({ ...point }))
  const radius = Math.max(1, options.radius)
  const anchorIndices = new Set(options.anchorIndices ?? [])
  const relaxed = relaxCurvature(
    source,
    radius,
    closed,
    Math.max(1, options.smoothingIterations ?? 24),
    anchorIndices,
  )
  const controls = selectControlPoints(
    relaxed,
    options.controlSpacing ?? radius * 0.7,
    closed,
    anchorIndices,
  )
  if (controls.length < 2) {
    return points.map((point) => ({ ...point }))
  }
  const output: PlanarPathPoint[] = []
  const segmentCount = closed ? controls.length : controls.length - 1
  for (let index = 0; index < segmentCount; index += 1) {
    const p0 = controls[closed
      ? (index - 1 + controls.length) % controls.length
      : Math.max(0, index - 1)]!
    const p1 = controls[index]!
    const p2 = controls[(index + 1) % controls.length]!
    const p3 = controls[closed
      ? (index + 2) % controls.length
      : Math.min(controls.length - 1, index + 2)]!
    const segmentLength = distance(p1, p2)
    if (segmentLength <= 1e-6) {
      continue
    }
    const maxHandle = segmentLength * 0.42
    const handleA = {
      x: (p2.x - p0.x) / 6,
      z: (p2.z - p0.z) / 6,
    }
    const handleB = {
      x: (p3.x - p1.x) / 6,
      z: (p3.z - p1.z) / 6,
    }
    const handleALength = Math.hypot(handleA.x, handleA.z)
    const handleBLength = Math.hypot(handleB.x, handleB.z)
    const scaleA = handleALength > maxHandle ? maxHandle / handleALength : 1
    const scaleB = handleBLength > maxHandle ? maxHandle / handleBLength : 1
    const sampled = sampleCubicBezier(
      p1,
      {
        x: p1.x + handleA.x * scaleA,
        z: p1.z + handleA.z * scaleA,
      },
      {
        x: p2.x - handleB.x * scaleB,
        z: p2.z - handleB.z * scaleB,
      },
      p2,
      options.sampleSpacing,
    )
    for (let sample = index === 0 ? 0 : 1; sample < sampled.length; sample += 1) {
      if (closed && index === segmentCount - 1 && sample === sampled.length - 1) {
        continue
      }
      output.push(sampled[sample]!)
    }
  }
  output[0] = { ...source[0]! }
  if (closed) {
    output.push({ ...source[0]! })
  } else {
    output[output.length - 1] = { ...source[source.length - 1]! }
  }
  return output
}
