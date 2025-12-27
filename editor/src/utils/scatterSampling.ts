import { sampleUniformPointInPolygon } from '@/utils/polygonSampling'

export type Point2 = { x: number; y: number }

export function hashSeedFromString(value: string): number {
  // FNV-1a 32bit
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function buildRandom(seed: number) {
  // LCG
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export function getPointsBounds(points: Point2[]) {
  if (!Array.isArray(points) || points.length === 0) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (!p) continue
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function polygonCentroid(points: Point2[]): Point2 | null {
  if (!Array.isArray(points) || points.length === 0) return null
  if (points.length < 3) {
    const bounds = getPointsBounds(points)
    if (!bounds) return null
    return { x: bounds.minX + bounds.width * 0.5, y: bounds.minY + bounds.height * 0.5 }
  }

  // Area-weighted centroid (shoelace)
  let areaTimes2 = 0
  let cxTimes6 = 0
  let cyTimes6 = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const cross = a.x * b.y - b.x * a.y
    areaTimes2 += cross
    cxTimes6 += (a.x + b.x) * cross
    cyTimes6 += (a.y + b.y) * cross
  }
  if (Math.abs(areaTimes2) < 1e-9) {
    const bounds = getPointsBounds(points)
    if (!bounds) return null
    return { x: bounds.minX + bounds.width * 0.5, y: bounds.minY + bounds.height * 0.5 }
  }
  const factor = 1 / (3 * areaTimes2)
  return { x: cxTimes6 * factor, y: cyTimes6 * factor }
}

export function isPointInPolygonWinding(point: Point2, polygonPoints: Point2[]): boolean {
  // Non-zero winding rule, matching SVG default fill behavior.
  let windingNumber = 0
  for (let i = 0; i < polygonPoints.length; i += 1) {
    const a = polygonPoints[i]!
    const b = polygonPoints[(i + 1) % polygonPoints.length]!

    if (a.y <= point.y) {
      if (b.y > point.y) {
        const isLeft = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
        if (isLeft > 0) windingNumber += 1
      }
    } else {
      if (b.y <= point.y) {
        const isLeft = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
        if (isLeft < 0) windingNumber -= 1
      }
    }
  }
  return windingNumber !== 0
}

function samplePointInPolygon(polygon: Point2[], random: () => number): Point2 | null {
  const uniform = sampleUniformPointInPolygon(polygon, random)
  if (uniform) return uniform

  const bounds = getPointsBounds(polygon)
  if (!bounds) return null
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const p: Point2 = { x: bounds.minX + bounds.width * random(), y: bounds.minY + bounds.height * random() }
    if (isPointInPolygonWinding(p, polygon)) {
      return p
    }
  }
  return null
}

export function generateUniformCandidatesInPolygon(
  polygon: Point2[],
  random: () => number,
  maxCandidates: number,
  options?: { maxAttemptsMultiplier?: number },
): Point2[] {
  if (!Array.isArray(polygon) || polygon.length < 3) return []
  if (!Number.isFinite(maxCandidates) || maxCandidates <= 0) return []

  const candidates: Point2[] = []
  const maxAttemptsMultiplier = options?.maxAttemptsMultiplier ?? 4
  const maxAttempts = Math.max(1, Math.ceil(maxCandidates * maxAttemptsMultiplier))

  for (let attempt = 0; attempt < maxAttempts && candidates.length < maxCandidates; attempt += 1) {
    const p = samplePointInPolygon(polygon, random)
    if (p) {
      candidates.push(p)
    }
  }

  return candidates
}

export function selectFarthestPointsFromCandidates(
  candidates: Point2[],
  targetCount: number,
  minDistance: number,
  centroid: Point2,
): Point2[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return []
  if (!Number.isFinite(targetCount) || targetCount <= 0) return []
  if (!Number.isFinite(minDistance) || minDistance <= 0) return []

  const k = Math.min(targetCount, candidates.length)
  const minDistanceSq = minDistance * minDistance

  // Seed: candidate closest to centroid (deterministic; ties -> lowest index).
  let seedIndex = 0
  let seedDistSq = Number.POSITIVE_INFINITY
  for (let i = 0; i < candidates.length; i += 1) {
    const p = candidates[i]!
    const dx = p.x - centroid.x
    const dy = p.y - centroid.y
    const d2 = dx * dx + dy * dy
    if (d2 < seedDistSq) {
      seedDistSq = d2
      seedIndex = i
    }
  }

  const selected: Point2[] = []
  selected.push(candidates[seedIndex]!)

  // Track each candidate's distance to nearest selected point.
  const minDistSqToSelected = new Float64Array(candidates.length)
  for (let i = 0; i < candidates.length; i += 1) {
    const p = candidates[i]!
    const s = candidates[seedIndex]!
    const dx = p.x - s.x
    const dy = p.y - s.y
    minDistSqToSelected[i] = dx * dx + dy * dy
  }
  minDistSqToSelected[seedIndex] = 0

  for (let iter = 1; iter < k; iter += 1) {
    let bestIndex = -1
    let bestScore = -1

    for (let i = 0; i < candidates.length; i += 1) {
      const score = minDistSqToSelected[i]!
      if (score < minDistanceSq) {
        continue
      }
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    if (bestIndex < 0) {
      break
    }

    const next = candidates[bestIndex]!
    selected.push(next)
    minDistSqToSelected[bestIndex] = 0

    // Update nearest distances.
    for (let i = 0; i < candidates.length; i += 1) {
      const p = candidates[i]!
      const dx = p.x - next.x
      const dy = p.y - next.y
      const d2 = dx * dx + dy * dy
      if (d2 < minDistSqToSelected[i]!) {
        minDistSqToSelected[i] = d2
      }
    }
  }

  return selected
}

export function generateFpsScatterPointsInPolygon(options: {
  polygon: Point2[]
  targetCount: number
  minDistance: number
  random: () => number
  maxCandidates: number
}): Point2[] {
  const polygon = options.polygon
  if (!Array.isArray(polygon) || polygon.length < 3) return []

  const bounds = getPointsBounds(polygon)
  const centroid = polygonCentroid(polygon)
    ?? (bounds ? { x: bounds.minX + bounds.width * 0.5, y: bounds.minY + bounds.height * 0.5 } : null)
  if (!centroid) return []

  const candidates = generateUniformCandidatesInPolygon(polygon, options.random, options.maxCandidates)
  if (!candidates.length) return []

  return selectFarthestPointsFromCandidates(candidates, options.targetCount, options.minDistance, centroid)
}
