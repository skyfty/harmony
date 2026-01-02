export interface PolylinePoint {
  id?: string
  x: number
  y: number
}

export interface PolylineShape {
  id: string
  name?: string
  layerId: string
  points: PolylinePoint[]
  [key: string]: unknown
}

export type NormalizeEpsWorld = {
  endpoints: number
  intersection: number
  shortSegment: number
}

export type NormalizeLayerPolylinesOptions = {
  layerId: string
  layerName?: string
  polylines: PolylineShape[]
  eps: NormalizeEpsWorld
  /** Generates new vertex ids when needed (e.g. intersections). */
  createVertexId: () => string
  /** Quantize coordinates (e.g. centimeters: n => Number(n.toFixed(2))). */
  quantize: (n: number) => number
}

export type NormalizeLayerPolylinesResult = {
  nextPolylines: PolylineShape[]
  /** Maps original line ids in the layer to merged component line id. */
  lineIdMap: Record<string, string>
  changed: boolean
}

type Vertex = { id: string; x: number; y: number; point: PolylinePoint }

type Segment = {
  key: string
  lineId: string
  a: Vertex
  b: Vertex
}

type Edge = { aId: string; bId: string; sourceLineId: string }

function distSq(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function fnv1a32(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function toHex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0')
}

function segmentIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { x: number; y: number; t: number; u: number } | null {
  // Solve A + t(B-A) = C + u(D-C)
  const rX = bx - ax
  const rY = by - ay
  const sX = dx - cx
  const sY = dy - cy
  const denom = rX * sY - rY * sX
  if (Math.abs(denom) < 1e-12) {
    // Parallel or collinear - overlap handling is intentionally not supported.
    return null
  }

  const cax = cx - ax
  const cay = cy - ay
  const t = (cax * sY - cay * sX) / denom
  const u = (cax * rY - cay * rX) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return null
  }
  const x = ax + t * rX
  const y = ay + t * rY
  return { x, y, t, u }
}

class SpatialIndex {
  private cellSize: number
  private buckets = new Map<string, string[]>()

  constructor(cellSize: number) {
    this.cellSize = Math.max(1e-9, cellSize)
  }

  private keyFor(x: number, y: number) {
    const cx = Math.floor(x / this.cellSize)
    const cy = Math.floor(y / this.cellSize)
    return `${cx},${cy}`
  }

  add(id: string, x: number, y: number) {
    const key = this.keyFor(x, y)
    const list = this.buckets.get(key)
    if (list) list.push(id)
    else this.buckets.set(key, [id])
  }

  nearby(x: number, y: number): string[] {
    const cx = Math.floor(x / this.cellSize)
    const cy = Math.floor(y / this.cellSize)
    const out: string[] = []
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const key = `${cx + ox},${cy + oy}`
        const list = this.buckets.get(key)
        if (list) out.push(...list)
      }
    }
    return out
  }
}

export function normalizeLayerPolylines(options: NormalizeLayerPolylinesOptions): NormalizeLayerPolylinesResult {
  const { layerId, layerName, polylines, eps, createVertexId, quantize } = options

  const layerLines = polylines.filter((l) => l.layerId === layerId)
  const otherLines = polylines.filter((l) => l.layerId !== layerId)

  const ensurePointId = (p: PolylinePoint) => {
    if (!p.id) p.id = createVertexId()
    return p.id
  }

  const verticesById = new Map<string, Vertex>()
  const vertexIndex = new SpatialIndex(Math.max(eps.endpoints, eps.intersection, 1e-6))

  const registerVertexFromPoint = (p: PolylinePoint): Vertex => {
    const id = ensurePointId(p)
    p.x = quantize(p.x)
    p.y = quantize(p.y)
    const existing = verticesById.get(id)
    if (existing) {
      // Keep coordinates in sync.
      existing.x = p.x
      existing.y = p.y
      existing.point.x = p.x
      existing.point.y = p.y
      return existing
    }
    const v: Vertex = { id, x: p.x, y: p.y, point: p }
    verticesById.set(id, v)
    vertexIndex.add(id, v.x, v.y)
    return v
  }

  // Register all existing vertices.
  layerLines.forEach((line) => {
    line.points.forEach((p) => registerVertexFromPoint(p))
  })

  const findNearbyVertex = (x: number, y: number, radius: number): Vertex | null => {
    const rSq = radius * radius
    const candidates = vertexIndex.nearby(x, y)
    let best: Vertex | null = null
    let bestDist = Infinity
    for (const id of candidates) {
      const v = verticesById.get(id)
      if (!v) continue
      const d = distSq(x, y, v.x, v.y)
      if (d <= rSq && d < bestDist) {
        best = v
        bestDist = d
      }
    }
    return best
  }

  const getOrCreateVertexNear = (xRaw: number, yRaw: number, radius: number): Vertex => {
    const x = quantize(xRaw)
    const y = quantize(yRaw)
    const nearby = findNearbyVertex(x, y, radius)
    if (nearby) return nearby

    const p: PolylinePoint = { id: createVertexId(), x, y }
    return registerVertexFromPoint(p)
  }

  // Weld endpoints (re-point endpoint references to a canonical vertex object).
  const epsEndpoints = Math.max(1e-9, eps.endpoints)
  layerLines.forEach((line) => {
    if (line.points.length < 1) return
    const endpointIndices = [0, line.points.length - 1]
    for (const idx of endpointIndices) {
      const p = line.points[idx]
      if (!p) continue
      const id = ensurePointId(p)
      const v = verticesById.get(id) ?? registerVertexFromPoint(p)
      const near = findNearbyVertex(v.x, v.y, epsEndpoints)
      const canonical = near ?? v
      // Re-point to canonical shared point.
      line.points[idx] = canonical.point
    }
  })

  // Build segments.
  const segments: Segment[] = []
  for (const line of layerLines) {
    if (line.points.length < 2) continue
    for (let i = 0; i < line.points.length - 1; i += 1) {
      const pa = line.points[i]
      const pb = line.points[i + 1]
      if (!pa || !pb) continue
      const a = registerVertexFromPoint(pa)
      const b = registerVertexFromPoint(pb)
      if (a.id === b.id) continue
      segments.push({ key: `${line.id}:${i}`, lineId: line.id, a, b })
    }
  }

  // Compute intersections; store split points per segment.
  const splitBySegmentKey = new Map<string, Array<{ t: number; vertex: Vertex }>>()
  const epsIntersection = Math.max(1e-9, eps.intersection)
  const epsIntersectionSq = epsIntersection * epsIntersection

  const addSplit = (segmentKey: string, t: number, vertex: Vertex) => {
    if (t <= 0 || t >= 1) return
    const list = splitBySegmentKey.get(segmentKey)
    if (list) list.push({ t, vertex })
    else splitBySegmentKey.set(segmentKey, [{ t, vertex }])
  }

  for (let i = 0; i < segments.length; i += 1) {
    const s1 = segments[i]
    if (!s1) continue
    for (let j = i + 1; j < segments.length; j += 1) {
      const s2 = segments[j]
      if (!s2) continue

      // Skip adjacent segments in same source polyline to avoid trivial shared-vertex "intersections".
      if (s1.lineId === s2.lineId) {
        const idx1 = Number(s1.key.split(':')[1])
        const idx2 = Number(s2.key.split(':')[1])
        if (Number.isFinite(idx1) && Number.isFinite(idx2) && Math.abs(idx1 - idx2) <= 1) {
          continue
        }
      }

      // Skip if they share an endpoint id.
      const shareEndpoint =
        s1.a.id === s2.a.id || s1.a.id === s2.b.id || s1.b.id === s2.a.id || s1.b.id === s2.b.id
      if (shareEndpoint) continue

      const hit = segmentIntersection(s1.a.x, s1.a.y, s1.b.x, s1.b.y, s2.a.x, s2.a.y, s2.b.x, s2.b.y)
      if (!hit) continue

      // If the intersection is near an existing endpoint, treat it as endpoint weld (no new vertex).
      const nearEnd1 =
        distSq(hit.x, hit.y, s1.a.x, s1.a.y) <= epsIntersectionSq
        || distSq(hit.x, hit.y, s1.b.x, s1.b.y) <= epsIntersectionSq
      const nearEnd2 =
        distSq(hit.x, hit.y, s2.a.x, s2.a.y) <= epsIntersectionSq
        || distSq(hit.x, hit.y, s2.b.x, s2.b.y) <= epsIntersectionSq

      if (nearEnd1 || nearEnd2) {
        continue
      }

      const v = getOrCreateVertexNear(hit.x, hit.y, epsIntersection)
      addSplit(s1.key, hit.t, v)
      addSplit(s2.key, hit.u, v)
    }
  }

  // Create graph edges from split segments.
  const epsShort = Math.max(1e-9, eps.shortSegment)
  const edges: Edge[] = []

  for (const s of segments) {
    const splits = splitBySegmentKey.get(s.key) ?? []

    // Deduplicate splits by vertex id; sort by t.
    const byId = new Map<string, { t: number; vertex: Vertex }>()
    for (const sp of splits) {
      const existing = byId.get(sp.vertex.id)
      if (!existing || sp.t < existing.t) byId.set(sp.vertex.id, sp)
    }
    const sorted = Array.from(byId.values()).sort((a, b) => a.t - b.t)

    const chain: Vertex[] = [s.a, ...sorted.map((sp) => sp.vertex), s.b]
    for (let k = 0; k < chain.length - 1; k += 1) {
      const v1 = chain[k]
      const v2 = chain[k + 1]
      if (!v1 || !v2) continue
      if (v1.id === v2.id) continue
      const lenSq = distSq(v1.x, v1.y, v2.x, v2.y)
      if (lenSq < epsShort * epsShort) {
        continue
      }
      edges.push({ aId: v1.id, bId: v2.id, sourceLineId: s.lineId })
    }
  }

  // No edges means nothing to normalize.
  if (!edges.length) {
    const unchanged = layerLines.length === 0
    return {
      nextPolylines: [...otherLines, ...layerLines],
      lineIdMap: {},
      changed: !unchanged,
    }
  }

  // Build adjacency.
  const adjacency = new Map<string, number[]>()
  edges.forEach((e, idx) => {
    if (!adjacency.has(e.aId)) adjacency.set(e.aId, [])
    if (!adjacency.has(e.bId)) adjacency.set(e.bId, [])
    adjacency.get(e.aId)!.push(idx)
    adjacency.get(e.bId)!.push(idx)
  })

  const visitedVertex = new Set<string>()
  const components: Array<{ vertexIds: string[]; edgeIndices: number[]; sourceLineIds: Set<string> }> = []

  for (const vid of adjacency.keys()) {
    if (visitedVertex.has(vid)) continue
    const queue = [vid]
    visitedVertex.add(vid)
    const compVerts: string[] = []
    const compEdges = new Set<number>()
    const sourceLineIds = new Set<string>()

    while (queue.length) {
      const v = queue.pop()!
      compVerts.push(v)
      const inc = adjacency.get(v) ?? []
      for (const ei of inc) {
        compEdges.add(ei)
        const edge = edges[ei]
        if (edge) sourceLineIds.add(edge.sourceLineId)
        const other = edge?.aId === v ? edge.bId : edge?.bId === v ? edge.aId : null
        if (other && !visitedVertex.has(other)) {
          visitedVertex.add(other)
          queue.push(other)
        }
      }
    }

    components.push({ vertexIds: compVerts, edgeIndices: Array.from(compEdges), sourceLineIds })
  }

  const lineIdMap: Record<string, string> = {}

  const buildWalk = (start: string, edgeSet: Set<number>): string[] => {
    const visitedEdge = new Set<number>()
    const stack: string[] = [start]
    const out: string[] = [start]

    while (stack.length) {
      const v = stack[stack.length - 1]!
      const inc = adjacency.get(v) ?? []
      const nextEdgeIndex = inc.find((ei) => edgeSet.has(ei) && !visitedEdge.has(ei))
      if (nextEdgeIndex == null) {
        stack.pop()
        if (stack.length) {
          out.push(stack[stack.length - 1]!)
        }
        continue
      }
      visitedEdge.add(nextEdgeIndex)
      const edge = edges[nextEdgeIndex]!
      const u = edge.aId === v ? edge.bId : edge.aId
      stack.push(u)
      out.push(u)
    }

    return out
  }

  const nextLayerLines: PolylineShape[] = []

  components.forEach((comp, idx) => {
    const edgeSet = new Set(comp.edgeIndices)

    // Prefer odd-degree start to reduce backtracking; otherwise pick any.
    let start = comp.vertexIds[0]!
    for (const v of comp.vertexIds) {
      const deg = (adjacency.get(v) ?? []).filter((ei) => edgeSet.has(ei)).length
      if (deg % 2 === 1) {
        start = v
        break
      }
    }

    const walkVertexIds = buildWalk(start, edgeSet)
    const points: PolylinePoint[] = []
    for (const vid of walkVertexIds) {
      const vertex = verticesById.get(vid)
      if (!vertex) continue
      points.push(vertex.point)
    }

    // De-dupe consecutive identical points.
    const compact: PolylinePoint[] = []
    for (const p of points) {
      const last = compact.length ? compact[compact.length - 1] : null
      if (last && last.id && p.id && last.id === p.id) continue
      if (last && last.x === p.x && last.y === p.y) continue
      compact.push(p)
    }

    const sourceIds = Array.from(comp.sourceLineIds).sort()
    const hashKey = `${layerId}|${sourceIds.join(',')}`
    const mergedId = `merged-${layerId}-${toHex8(fnv1a32(hashKey))}`

    for (const sourceId of comp.sourceLineIds) {
      lineIdMap[sourceId] = mergedId
    }

    nextLayerLines.push({
      id: mergedId,
      name: `${layerName ?? 'Layer'} Network ${idx + 1}`,
      layerId,
      points: compact,
    })
  })

  const nextPolylines: PolylineShape[] = [...otherLines, ...nextLayerLines]

  const changed =
    nextLayerLines.length !== layerLines.length
    || nextLayerLines.some((nl) => {
      const old = layerLines.find((ol) => ol.id === nl.id)
      return !old || old.points.length !== nl.points.length
    })

  return { nextPolylines, lineIdMap, changed }
}
