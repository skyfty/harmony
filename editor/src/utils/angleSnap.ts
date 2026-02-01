export interface Point { x: number; y: number }

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}

function length(v: Point) {
  return Math.hypot(v.x, v.y)
}

function normalize(v: Point): Point {
  const l = length(v)
  if (!Number.isFinite(l) || l <= 1e-12) return { x: 0, y: 0 }
  return { x: v.x / l, y: v.y / l }
}

/**
 * Snap a candidate point so the interior (relative) angle between the previous segment
 * and the candidate segment equals one of allowedAnglesDeg when within thresholdDeg.
 * - anchor: the shared vertex (world coords)
 * - candidate: the raw candidate point (world coords)
 * - prevPoint: the point before anchor (world coords). If null, returns candidate unchanged.
 */
export function snapCandidatePointToAnglesRelative(
  anchor: Point,
  candidate: Point,
  prevPoint: Point | null,
  allowedAnglesDeg: number[],
  thresholdDeg = 5,
): Point {
  if (!prevPoint) return candidate

  // Incoming vector pointing to anchor
  const vPrev = { x: anchor.x - prevPoint.x, y: anchor.y - prevPoint.y }
  const vCand = { x: candidate.x - anchor.x, y: candidate.y - anchor.y }
  const lenPrev = length(vPrev)
  const lenCand = length(vCand)
  if (!Number.isFinite(lenPrev) || lenPrev <= 1e-9) return candidate
  if (!Number.isFinite(lenCand) || lenCand <= 1e-9) return candidate

  const uPrev = normalize(vPrev)
  const uCand = normalize(vCand)

  // interior angle between incoming (into anchor) and outgoing (candidate)
  // use -uPrev so both are outgoing directions from anchor
  const ref = { x: -uPrev.x, y: -uPrev.y }
  const dotInterior = clamp(-(uPrev.x * uCand.x + uPrev.y * uCand.y), -1, 1)
  const theta = Math.acos(dotInterior) // 0..PI radians
  const thetaDeg = (theta * 180) / Math.PI

  // find nearest allowed angle (degrees)
  let nearest = allowedAnglesDeg[0] ?? 0
  let bestDiff = Math.abs(thetaDeg - nearest)
  for (let i = 1; i < allowedAnglesDeg.length; i += 1) {
    const a = allowedAnglesDeg[i]!
    const d = Math.abs(thetaDeg - a)
    if (d < bestDiff) {
      bestDiff = d
      nearest = a
    }
  }

  if (bestDiff > thresholdDeg) {
    return candidate
  }

  const nearestRad = (nearest * Math.PI) / 180

  // Determine sign (CW/CCW) using cross product between ref and current candidate
  const cross = ref.x * uCand.y - ref.y * uCand.x
  const signed = cross >= 0 ? nearestRad : -nearestRad

  const referenceAngle = Math.atan2(ref.y, ref.x)
  const targetAngle = referenceAngle + signed

  const newX = anchor.x + Math.cos(targetAngle) * lenCand
  const newY = anchor.y + Math.sin(targetAngle) * lenCand
  return { x: newX, y: newY }
}
