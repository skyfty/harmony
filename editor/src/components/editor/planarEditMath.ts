import * as THREE from 'three'

export type PlanarPoint = [number, number]

export function sanitizePlanarPoints(points: unknown): PlanarPoint[] {
  if (!Array.isArray(points)) {
    return []
  }

  return points
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null
      }
      const x = Number(entry[0])
      const y = Number(entry[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }
      return [x, y] as PlanarPoint
    })
    .filter((entry): entry is PlanarPoint => Array.isArray(entry))
}

export function computePlanarBounds(points: PlanarPoint[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (!points.length) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null
  }

  return { minX, maxX, minY, maxY }
}

export function buildRectanglePlanarPoints(bounds: { minX: number; maxX: number; minY: number; maxY: number }): PlanarPoint[] {
  return [
    [bounds.minX, bounds.minY],
    [bounds.minX, bounds.maxY],
    [bounds.maxX, bounds.maxY],
    [bounds.maxX, bounds.minY],
  ]
}

export function computePlanarMeanCenter(points: PlanarPoint[]): { x: number; y: number } | null {
  if (!points.length) {
    return null
  }

  let sumX = 0
  let sumY = 0
  let count = 0
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }
    sumX += x
    sumY += y
    count += 1
  }

  if (count <= 0) {
    return null
  }

  return { x: sumX / count, y: sumY / count }
}

export function computeApproxCircleFromPlanarPoints(points: PlanarPoint[]): {
  centerX: number
  centerY: number
  radius: number
  segments: number
} | null {
  if (points.length < 3) {
    return null
  }

  const center = computePlanarMeanCenter(points)
  if (!center) {
    return null
  }

  let meanRadius = 0
  for (const [x, y] of points) {
    meanRadius += Math.hypot(x - center.x, y - center.y)
  }
  meanRadius /= Math.max(1, points.length)

  if (!Number.isFinite(center.x + center.y + meanRadius) || meanRadius <= 1e-4) {
    return null
  }

  return {
    centerX: center.x,
    centerY: center.y,
    radius: meanRadius,
    segments: points.length,
  }
}

export function buildCirclePlanarPoints(options: {
  centerX: number
  centerY: number
  radius: number
  segments: number
  minSegments?: number
  maxSegments?: number
}): PlanarPoint[] {
  const minSegments = Math.max(3, Math.trunc(options.minSegments ?? 8))
  const maxSegments = Math.max(minSegments, Math.trunc(options.maxSegments ?? 256))
  const segments = Math.max(minSegments, Math.min(maxSegments, Math.floor(options.segments)))
  const radius = Math.max(1e-4, Number(options.radius))
  const out: PlanarPoint[] = []
  for (let index = 0; index < segments; index += 1) {
    const t = (index / segments) * Math.PI * 2
    out.push([
      options.centerX + Math.cos(t) * radius,
      options.centerY + Math.sin(t) * radius,
    ])
  }
  return out
}

export type PlanarEdgeHit = {
  edgeIndex: number
  perp: THREE.Vector2
  referencePoint: THREE.Vector2
  initialProjection: number
}

export function pickNearestPlanarEdge(options: {
  pointer: THREE.Vector2
  vertices: Array<{ x: number; y: number }>
  maxDistance: number
}): PlanarEdgeHit | null {
  const { pointer, vertices, maxDistance } = options
  if (vertices.length < 2) {
    return null
  }

  let bestDistanceSq = Infinity
  let bestIndex = -1
  const closestPoint = new THREE.Vector2()

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    const dx = next.x - current.x
    const dy = next.y - current.y
    const segmentLenSq = dx * dx + dy * dy
    if (!(segmentLenSq > 0)) {
      continue
    }

    const t = Math.max(0, Math.min(1, ((pointer.x - current.x) * dx + (pointer.y - current.y) * dy) / segmentLenSq))
    const projection = new THREE.Vector2(current.x + dx * t, current.y + dy * t)
    const distSq = (pointer.x - projection.x) ** 2 + (pointer.y - projection.y) ** 2
    if (distSq < bestDistanceSq) {
      bestDistanceSq = distSq
      bestIndex = index
      closestPoint.copy(projection)
    }
  }

  if (bestIndex < 0 || bestDistanceSq > maxDistance * maxDistance) {
    return null
  }

  const start = vertices[bestIndex]!
  const end = vertices[(bestIndex + 1) % vertices.length]!
  const direction = new THREE.Vector2(end.x - start.x, end.y - start.y)
  if (direction.lengthSq() <= 0) {
    return null
  }

  const normalizedDirection = direction.normalize()
  const perp = new THREE.Vector2(-normalizedDirection.y, normalizedDirection.x)
  const projection = perp.dot(pointer.clone().sub(closestPoint))

  return {
    edgeIndex: bestIndex,
    perp,
    referencePoint: closestPoint.clone(),
    initialProjection: projection,
  }
}
