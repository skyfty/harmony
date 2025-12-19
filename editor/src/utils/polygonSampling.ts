import * as THREE from 'three'

export type Point2 = { x: number; y: number }

type Triangulation = {
  vertices: Point2[]
  triangles: [number, number, number][]
  cumulativeAreas: number[]
  totalArea: number
}

function triangleArea2D(a: Point2, b: Point2, c: Point2): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5
}

function normalizePolygon(points: Point2[]): Point2[] {
  if (!Array.isArray(points)) return []
  const filtered = points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  if (filtered.length < 3) return []

  const deduped: Point2[] = []
  for (const p of filtered) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.x === p.x && prev.y === p.y) continue
    deduped.push({ x: p.x, y: p.y })
  }
  if (deduped.length >= 2) {
    const first = deduped[0]!
    const last = deduped[deduped.length - 1]!
    if (first.x === last.x && first.y === last.y) {
      deduped.pop()
    }
  }
  return deduped.length >= 3 ? deduped : []
}

function buildTriangulation(polygon: Point2[]): Triangulation | null {
  const normalized = normalizePolygon(polygon)
  if (normalized.length < 3) return null

  const contour = normalized.map((p) => new THREE.Vector2(p.x, p.y))

  let faces: number[][]
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, [])
  } catch {
    return null
  }

  if (!Array.isArray(faces) || faces.length === 0) return null

  const vertices = normalized
  const triangles: [number, number, number][] = []
  const cumulativeAreas: number[] = []

  let totalArea = 0
  for (const face of faces) {
    if (!Array.isArray(face) || face.length !== 3) continue
    const ia = face[0]!
    const ib = face[1]!
    const ic = face[2]!
    const a = vertices[ia]
    const b = vertices[ib]
    const c = vertices[ic]
    if (!a || !b || !c) continue
    const area = triangleArea2D(a, b, c)
    if (!Number.isFinite(area) || area <= 1e-12) continue

    totalArea += area
    triangles.push([ia, ib, ic])
    cumulativeAreas.push(totalArea)
  }

  if (!Number.isFinite(totalArea) || totalArea <= 1e-12 || triangles.length === 0) return null

  return { vertices, triangles, cumulativeAreas, totalArea }
}

function samplePointInTriangle(a: Point2, b: Point2, c: Point2, random: () => number): Point2 {
  // Uniform barycentric sampling.
  // Ref: Turk (1990) / common method: r1 = sqrt(u), r2 = v.
  const r1 = Math.sqrt(random())
  const r2 = random()
  const u = 1 - r1
  const v = r1 * (1 - r2)
  const w = r1 * r2
  return {
    x: a.x * u + b.x * v + c.x * w,
    y: a.y * u + b.y * v + c.y * w,
  }
}

function pickTriangleIndex(tri: Triangulation, random: () => number): number {
  const r = random() * tri.totalArea
  // Linear scan is OK for typical polygon sizes; keeps code simple.
  for (let i = 0; i < tri.cumulativeAreas.length; i += 1) {
    if (r <= tri.cumulativeAreas[i]!) return i
  }
  return tri.cumulativeAreas.length - 1
}

/**
 * Samples a point uniformly at random inside a simple 2D polygon.
 * - Works for convex/concave polygons (non-self-intersecting recommended).
 * - Returns null if triangulation fails.
 */
export function sampleUniformPointInPolygon(polygon: Point2[], random: () => number): Point2 | null {
  const tri = buildTriangulation(polygon)
  if (!tri) return null

  const index = pickTriangleIndex(tri, random)
  const face = tri.triangles[index]
  if (!face) return null

  const a = tri.vertices[face[0]]
  const b = tri.vertices[face[1]]
  const c = tri.vertices[face[2]]
  if (!a || !b || !c) return null

  return samplePointInTriangle(a, b, c, random)
}
