import type { Vector3Like, WallDynamicMesh, WallChain, WallOpening } from './index'

const WALL_LAYOUT_EPSILON = 1e-6

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A single straight sub-segment ready for rendering / physics. */
export type WallRenderSegment = {
  start: Vector3Like
  end: Vector3Like
  height: number
  width: number
  thickness: number
  /** Index of the WallChain this segment originates from (populated by compileWallSegmentsFromDefinition). */
  chainIndex?: number
  /** Arc-length of this segment's start within its source WallChain (populated by compileWallSegmentsFromDefinition). */
  chainArcStart?: number
}

type PolylineSeg = {
  start: Vector3Like
  end: Vector3Like
  length: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toValidPoint(value: unknown): Vector3Like | null {
  const p = value as { x?: unknown; y?: unknown; z?: unknown } | null
  if (!p) return null
  const x = Number(p.x)
  const y = Number(p.y)
  const z = Number(p.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return { x, y, z }
}

function distanceXZ(a: Vector3Like, b: Vector3Like): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function buildPolylineSegs(points: Vector3Like[], closed: boolean): PolylineSeg[] {
  const segs: PolylineSeg[] = []
  if (points.length < 2) return segs
  const loopCount = closed ? points.length : points.length - 1
  for (let i = 0; i < loopCount; i += 1) {
    const start = points[i]!
    const end = points[(i + 1) % points.length]!
    const length = distanceXZ(start, end)
    if (!Number.isFinite(length) || length <= WALL_LAYOUT_EPSILON) continue
    segs.push({ start, end, length })
  }
  return segs
}

function mergeOpeningIntervals(
  openings: Array<{ start: number; end: number }>,
  totalLen: number,
): Array<{ start: number; end: number }> {
  const norm = openings
    .map((e) => ({
      start: Math.max(0, Math.min(totalLen, Number(e.start))),
      end: Math.max(0, Math.min(totalLen, Number(e.end))),
    }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end - e.start > WALL_LAYOUT_EPSILON)
    .sort((a, b) => a.start - b.start)
  if (!norm.length) return []
  const merged: Array<{ start: number; end: number }> = []
  let cur = { ...norm[0]! }
  for (let i = 1; i < norm.length; i += 1) {
    const nx = norm[i]!
    if (nx.start <= cur.end + WALL_LAYOUT_EPSILON) {
      cur.end = Math.max(cur.end, nx.end)
    } else {
      merged.push(cur)
      cur = { ...nx }
    }
  }
  merged.push(cur)
  return merged
}

function subtractOpeningIntervals(
  totalLen: number,
  openings: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  if (totalLen <= WALL_LAYOUT_EPSILON) return []
  if (!openings.length) return [{ start: 0, end: totalLen }]
  const result: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const o of openings) {
    if (o.start > cursor + WALL_LAYOUT_EPSILON) result.push({ start: cursor, end: o.start })
    cursor = Math.max(cursor, o.end)
  }
  if (cursor < totalLen - WALL_LAYOUT_EPSILON) result.push({ start: cursor, end: totalLen })
  return result
}

function extractIntervalSegs(
  polySegs: PolylineSeg[],
  arcStart: number,
  arcEnd: number,
  dims: { height: number; width: number; thickness: number },
): WallRenderSegment[] {
  const result: WallRenderSegment[] = []
  let cursor = 0
  for (const ps of polySegs) {
    const segEnd = cursor + ps.length
    const clipStart = Math.max(arcStart, cursor)
    const clipEnd = Math.min(arcEnd, segEnd)
    if (clipEnd - clipStart < WALL_LAYOUT_EPSILON) {
      cursor = segEnd
      continue
    }
    const tS = ps.length <= WALL_LAYOUT_EPSILON ? 0 : (clipStart - cursor) / ps.length
    const tE = ps.length <= WALL_LAYOUT_EPSILON ? 1 : (clipEnd - cursor) / ps.length
    const lerp = (t: number): Vector3Like => ({
      x: ps.start.x + (ps.end.x - ps.start.x) * t,
      y: ps.start.y + (ps.end.y - ps.start.y) * t,
      z: ps.start.z + (ps.end.z - ps.start.z) * t,
    })
    const start = lerp(tS)
    const end = lerp(tE)
    if (distanceXZ(start, end) > WALL_LAYOUT_EPSILON) result.push({ start, end, ...dims })
    cursor = segEnd
  }
  return result
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Resolve the shared wall dimensions, with safe fallbacks. */
export function resolveWallDimensionsFromDefinition(definition: WallDynamicMesh): {
  height: number
  width: number
  thickness: number
} {
  const d = (definition as any).dimensions as { height?: unknown; width?: unknown; thickness?: unknown } | undefined
  if (d) {
    const h = Number(d.height)
    const w = Number(d.width)
    const t = Number(d.thickness)
    if (Number.isFinite(h) && Number.isFinite(w) && Number.isFinite(t)) {
      return { height: Math.max(0.001, h), width: Math.max(0.001, w), thickness: Math.max(0.001, t) }
    }
  }
  return { height: 3, width: 0.2, thickness: 0.2 }
}

/** Compute the total XZ arc length of a chain. */
export function computeChainArcLength(chain: WallChain): number {
  const pts = Array.isArray(chain?.points) ? chain.points : []
  if (pts.length < 2) return 0
  return buildPolylineSegs(pts, Boolean(chain.closed)).reduce((s, seg) => s + seg.length, 0)
}

/**
 * Compile a wall definition into a flat list of straight render segments.
 * Segments from different filled intervals are separated by a gap between their endpoints,
 * allowing callers to reassemble chains by checking endpoint continuity.
 */
export function compileWallSegmentsFromDefinition(definition: WallDynamicMesh): WallRenderSegment[] {
  const chains = Array.isArray(definition.chains) ? definition.chains : []
  if (!chains.length) return []
  const dims = resolveWallDimensionsFromDefinition(definition)
  const allOpenings = Array.isArray(definition.openings) ? definition.openings : []
  const result: WallRenderSegment[] = []

  for (let ci = 0; ci < chains.length; ci += 1) {
    const chain = chains[ci]!
    const pts = Array.isArray(chain.points)
      ? chain.points.map((p) => toValidPoint(p)).filter((p): p is Vector3Like => !!p)
      : []
    const polySegs = buildPolylineSegs(pts, Boolean(chain.closed))
    if (!polySegs.length) continue
    const totalLen = polySegs.reduce((s, seg) => s + seg.length, 0)
    const rawOpenings = allOpenings
      .filter((o) => Number(o?.chainIndex) === ci)
      .map((o) => ({ start: Number(o.start), end: Number(o.end) }))
    const merged = mergeOpeningIntervals(rawOpenings, totalLen)
    const visRanges = subtractOpeningIntervals(totalLen, merged)
    for (const range of visRanges) {
      const rangeSegs = extractIntervalSegs(polySegs, range.start, range.end, dims)
      let arcCursor = range.start
      for (const seg of rangeSegs) {
        const dx = seg.end.x - seg.start.x
        const dz = seg.end.z - seg.start.z
        const len = Math.sqrt(dx * dx + dz * dz)
        result.push({ ...seg, chainIndex: ci, chainArcStart: arcCursor })
        arcCursor += len
      }
    }
  }
  return result
}

/** Merge overlapping openings for a single chain, returning sorted non-overlapping list. */
export function mergeAndClampOpenings(
  openings: WallOpening[],
  chainIndex: number,
  chainTotalLength: number,
): WallOpening[] {
  const filtered = openings
    .filter((o) => Number(o?.chainIndex) === chainIndex)
    .map((o) => ({ chainIndex, start: Number(o.start), end: Number(o.end) }))
    .filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end) && o.end - o.start > WALL_LAYOUT_EPSILON)
  const merged = mergeOpeningIntervals(filtered, chainTotalLength)
  return merged.map((e) => ({ chainIndex, start: e.start, end: e.end }))
}

/** Add a new opening to the definition's openings, merging any overlaps. */
export function addWallOpeningToDefinition(definition: WallDynamicMesh, newOpening: WallOpening): WallOpening[] {
  const chains = Array.isArray(definition.chains) ? definition.chains : []
  const existing = Array.isArray(definition.openings) ? definition.openings : []
  const ci = Number(newOpening.chainIndex)
  if (!Number.isFinite(ci) || ci < 0 || ci >= chains.length) return existing.slice()
  const chain = chains[ci]!
  const totalLen = computeChainArcLength(chain)
  const combined = [...existing.filter((o) => Number(o.chainIndex) === ci), newOpening]
  const merged = mergeAndClampOpenings(combined, ci, totalLen)
  return [...existing.filter((o) => Number(o.chainIndex) !== ci), ...merged]
}

/** Remove an opening by its index in the definition's openings array. */
export function removeWallOpeningFromDefinition(definition: WallDynamicMesh, openingIndex: number): WallOpening[] {
  const existing = Array.isArray(definition.openings) ? definition.openings : []
  return existing.filter((_, idx) => idx !== openingIndex)
}
