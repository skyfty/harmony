import * as THREE from 'three'
import type { RoadDynamicMesh, SceneNode } from '@schema'

export type RoadSnapVertex = { position: THREE.Vector3; nodeId: string; vertexIndex: number }

type RoadSegment = { a: number; b: number }

type SplitPoint = { t: number; point: THREE.Vector2 }

const ROAD_INTERSECTION_EPS = 1e-6
const ROAD_VERTEX_MERGE_EPS2 = 1e-10
const ROAD_CONNECT_LAYER_MAX_DELTA_Y = 0.75

export function sanitizeRoadDefinition(definition: RoadDynamicMesh): {
  vertices: Array<[number, number]>
  segments: RoadSegment[]
} {
  /**
   * 规范化顶点数组：确保每个顶点为 [x, z] 的数值对，非数值项替换为 0
   * 同时去除重复（非常接近）的顶点由后续逻辑处理（此处仅转换和裁剪）
   */
  const vertices = (Array.isArray(definition.vertices) ? definition.vertices : []).map((v) => {
    // 如果元素为数组则取前两个值，否则视为 [0,0]
    const x = Number(Array.isArray(v) ? v[0] : 0)
    const z = Number(Array.isArray(v) ? v[1] : 0)
    // 仅保留有限数值，否则归零
    return [Number.isFinite(x) ? x : 0, Number.isFinite(z) ? z : 0] as [number, number]
  })

  // 规范化线段定义：确保索引为整数、非负且不指向自身，且索引在顶点范围内
  const segmentsRaw = Array.isArray(definition.segments) ? definition.segments : []
  const segments: RoadSegment[] = []
  for (const s of segmentsRaw as any[]) {
    // 强制转换为整数索引（向零截断）
    const a = Math.trunc(Number((s as any)?.a))
    const b = Math.trunc(Number((s as any)?.b))
    // 校验索引合法性：必须为整数、非负且不能指向同一顶点
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) {
      continue
    }
    // 校验索引范围：必须在顶点数组内
    if (a >= vertices.length || b >= vertices.length) {
      continue
    }
    segments.push({ a, b })
  }

  // 返回已清洗的顶点与线段列表
  return { vertices, segments }
}

export function buildLocalPolyline(runtime: THREE.Object3D, worldPoints: THREE.Vector3[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = []
  for (const p of worldPoints) {
    const local = runtime.worldToLocal(new THREE.Vector3(p.x, 0, p.z))
    const v = new THREE.Vector2(local.x, local.z)
    const prev = out[out.length - 1]
    if (prev && prev.distanceToSquared(v) <= ROAD_VERTEX_MERGE_EPS2) {
      continue
    }
    out.push(v)
  }
  return out
}

export function smoothRoadVerticesAroundIndex(
  vertices: Array<[number, number]>,
  focusIndex: number,
  options: {
    windowSize?: number
    strength?: number
  } = {},
): Array<[number, number]> {
  const count = Array.isArray(vertices) ? vertices.length : 0
  if (count < 3) {
    return (Array.isArray(vertices) ? vertices : []).map(([x, z]) => [Number(x) || 0, Number(z) || 0] as [number, number])
  }

  const safeIndex = Math.max(0, Math.min(count - 1, Math.trunc(Number(focusIndex) || 0)))
  const windowSize = Math.max(3, Math.trunc(Number(options.windowSize) || 5))
  const windowRadius = Math.max(1, Math.floor(windowSize / 2))
  const start = Math.max(0, safeIndex - windowRadius)
  const end = Math.min(count - 1, safeIndex + windowRadius)
  const localCount = end - start + 1
  if (localCount < 3) {
    return vertices.map(([x, z]) => [Number(x) || 0, Number(z) || 0] as [number, number])
  }

  const localPoints = vertices.slice(start, end + 1).map(([x, z]) => new THREE.Vector3(Number(x) || 0, 0, Number(z) || 0))
  const curve = new THREE.CatmullRomCurve3(localPoints, false, 'centripetal', 0.5)
  const sampled = curve.getPoints(localCount - 1)
  const strength = Math.max(0, Math.min(1, Number(options.strength) || 0.7))

  const out = vertices.map(([x, z]) => [Number(x) || 0, Number(z) || 0] as [number, number])
  for (let i = 0; i < localCount; i += 1) {
    const original = localPoints[i]!
    const smooth = sampled[i]!
    const blend = strength >= 1 ? smooth : original.clone().lerp(smooth, strength)
    out[start + i] = [blend.x, blend.z]
  }

  return out
}

function segmentIntersection2D(
  a: THREE.Vector2,
  b: THREE.Vector2,
  c: THREE.Vector2,
  d: THREE.Vector2,
  eps = ROAD_INTERSECTION_EPS,
): { point: THREE.Vector2; t: number; u: number } | null {
  const r = new THREE.Vector2().subVectors(b, a)
  const s = new THREE.Vector2().subVectors(d, c)
  const denom = r.x * s.y - r.y * s.x
  if (Math.abs(denom) <= eps) {
    return null
  }
  const cma = new THREE.Vector2().subVectors(c, a)
  const t = (cma.x * s.y - cma.y * s.x) / denom
  const u = (cma.x * r.y - cma.y * r.x) / denom
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) {
    return null
  }
  const tt = Math.max(0, Math.min(1, t))
  const point = new THREE.Vector2(a.x + r.x * tt, a.y + r.y * tt)
  return { point, t: tt, u: Math.max(0, Math.min(1, u)) }
}

function pushSplitPoint(map: Map<number, SplitPoint[]>, segmentIndex: number, entry: SplitPoint) {
  const list = map.get(segmentIndex)
  if (list) {
    list.push(entry)
  } else {
    map.set(segmentIndex, [entry])
  }
}

function computeSelfIntersectionSplits(vertices2: THREE.Vector2[], segments: RoadSegment[]): Map<number, SplitPoint[]> {
  const splitMap = new Map<number, SplitPoint[]>()
  for (let i = 0; i < segments.length; i += 1) {
    const si = segments[i]!
    const ai = vertices2[si.a]!
    const bi = vertices2[si.b]!
    for (let j = i + 1; j < segments.length; j += 1) {
      const sj = segments[j]!
      if (si.a === sj.a || si.a === sj.b || si.b === sj.a || si.b === sj.b) {
        continue
      }
      const aj = vertices2[sj.a]!
      const bj = vertices2[sj.b]!
      const hit = segmentIntersection2D(ai, bi, aj, bj)
      if (!hit) {
        continue
      }
      pushSplitPoint(splitMap, i, { t: hit.t, point: hit.point })
      pushSplitPoint(splitMap, j, { t: hit.u, point: hit.point })
    }
  }
  return splitMap
}

function computePolylineRoadIntersectionSplits(
  poly: THREE.Vector2[],
  roadVertices2: THREE.Vector2[],
  roadSegments: RoadSegment[],
): { roadSplits: Map<number, SplitPoint[]>; polySplits: Map<number, SplitPoint[]> } {
  const hits = computePolylineRoadIntersectionHits(poly, roadVertices2, roadSegments)
  const roadSplits = new Map<number, SplitPoint[]>()
  const polySplits = new Map<number, SplitPoint[]>()
  for (const hit of hits) {
    pushSplitPoint(polySplits, hit.polySegmentIndex, { t: hit.t, point: hit.point })
    pushSplitPoint(roadSplits, hit.roadSegmentIndex, { t: hit.u, point: hit.point })
  }
  return { roadSplits, polySplits }
}

function computePolylineRoadIntersectionHits(
  poly: THREE.Vector2[],
  roadVertices2: THREE.Vector2[],
  roadSegments: RoadSegment[],
): Array<{ polySegmentIndex: number; roadSegmentIndex: number; t: number; u: number; point: THREE.Vector2 }> {
  const hits: Array<{ polySegmentIndex: number; roadSegmentIndex: number; t: number; u: number; point: THREE.Vector2 }> = []
  if (poly.length < 2) {
    return hits
  }
  for (let i = 0; i < poly.length - 1; i += 1) {
    const a = poly[i]!
    const b = poly[i + 1]!
    for (let j = 0; j < roadSegments.length; j += 1) {
      const seg = roadSegments[j]!
      const c = roadVertices2[seg.a]!
      const d = roadVertices2[seg.b]!
      const hit = segmentIntersection2D(a, b, c, d)
      if (!hit) {
        continue
      }
      hits.push({
        polySegmentIndex: i,
        roadSegmentIndex: j,
        t: hit.t,
        u: hit.u,
        point: hit.point,
      })
    }
  }
  return hits
}

function dedupeWorldPolylineXZ(worldPoints: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (const p of worldPoints) {
    const next = new THREE.Vector3(p.x, p.y, p.z)
    const prev = out[out.length - 1]
    if (!prev) {
      out.push(next)
      continue
    }
    const dx = prev.x - next.x
    const dz = prev.z - next.z
    if (dx * dx + dz * dz <= ROAD_VERTEX_MERGE_EPS2) {
      continue
    }
    out.push(next)
  }
  return out
}

function sampleSegmentY(a: THREE.Vector3, b: THREE.Vector3, t: number): number {
  const tt = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  return a.y + (b.y - a.y) * tt
}

function sampleHeightSeries(values: number[] | null | undefined, t: number): number {
  if (!Array.isArray(values) || values.length === 0) {
    return 0
  }
  if (values.length === 1) {
    const single = Number(values[0])
    return Number.isFinite(single) ? single : 0
  }
  const clampedT = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  const scaled = clampedT * (values.length - 1)
  const i0 = Math.floor(scaled)
  const i1 = Math.min(values.length - 1, i0 + 1)
  const frac = scaled - i0
  const h0 = Number(values[i0] ?? 0)
  const h1 = Number(values[i1] ?? h0)
  const safeH0 = Number.isFinite(h0) ? h0 : 0
  const safeH1 = Number.isFinite(h1) ? h1 : safeH0
  return safeH0 + (safeH1 - safeH0) * frac
}

function resampleHeightSeries(
  values: number[] | null | undefined,
  startT: number,
  endT: number,
  sampleCount?: number,
): number[] {
  const count = Math.max(2, Math.trunc(sampleCount ?? (Array.isArray(values) ? values.length : 0)) || 2)
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    const localT = count <= 1 ? 0 : i / (count - 1)
    const t = startT + (endT - startT) * localT
    out.push(sampleHeightSeries(values, t))
  }
  return out
}

function normalizeSegmentHeightList(
  segmentHeights: number[][] | undefined,
  segmentCount: number,
): number[][] {
  const out: number[][] = []
  for (let i = 0; i < segmentCount; i += 1) {
    const raw = Array.isArray(segmentHeights?.[i]) ? segmentHeights![i] : null
    const values = Array.isArray(raw)
      ? raw.map((value) => {
          const numeric = Number(value)
          return Number.isFinite(numeric) ? numeric : 0
        })
      : []
    out.push(values.length >= 2 ? values : [0, 0])
  }
  return out
}

function expandPolylineWithHeights(
  points: THREE.Vector2[],
  splitMap: Map<number, SplitPoint[]>,
  sourceHeights?: number[][],
): { points: THREE.Vector2[]; segmentHeights: number[][] } {
  if (points.length < 2) {
    return { points, segmentHeights: [] }
  }

  const outPoints: THREE.Vector2[] = [points[0]!.clone()]
  const outHeights: number[][] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const splits = (splitMap.get(i) ?? []).slice()
    splits.sort((a, b) => a.t - b.t)
    const segmentHeights = Array.isArray(sourceHeights?.[i]) && sourceHeights![i]!.length >= 2
      ? sourceHeights![i]!
      : [0, 0]
    let previousT = 0

    for (const s of splits) {
      if (s.t <= ROAD_INTERSECTION_EPS || s.t >= 1 - ROAD_INTERSECTION_EPS) {
        continue
      }
      outHeights.push(resampleHeightSeries(segmentHeights, previousT, s.t, segmentHeights.length))
      const prev = outPoints[outPoints.length - 1]
      if (!prev || prev.distanceToSquared(s.point) > ROAD_VERTEX_MERGE_EPS2) {
        outPoints.push(s.point.clone())
      }
      previousT = s.t
    }

    outHeights.push(resampleHeightSeries(segmentHeights, previousT, 1, segmentHeights.length))
    const end = points[i + 1]!
    const prev = outPoints[outPoints.length - 1]
    if (!prev || prev.distanceToSquared(end) > ROAD_VERTEX_MERGE_EPS2) {
      outPoints.push(end.clone())
    }
  }

  return { points: outPoints, segmentHeights: outHeights }
}

function addPolylineSegmentsToRoadWithHeights(
  current: { vertices: Array<[number, number]>; segments: RoadSegment[]; segmentHeights: number[][] },
  polyPoints: THREE.Vector2[],
  polyHeights: number[][],
): { vertices: Array<[number, number]>; segments: RoadSegment[]; segmentHeights: number[][] } {
  const vertices: Array<[number, number]> = current.vertices.map(([x, z]) => [x, z])
  const segments: RoadSegment[] = current.segments.map((s) => ({ a: s.a, b: s.b }))
  const segmentHeights: number[][] = current.segmentHeights.map((entry) => entry.map((value) => Number(value)))

  const segmentKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)
  const existing = new Set<string>()
  for (const s of segments) {
    existing.add(segmentKey(s.a, s.b))
  }

  const findOrAddVertex = (p: THREE.Vector2): number => {
    for (let i = 0; i < vertices.length; i += 1) {
      const v = vertices[i]!
      const dx = v[0] - p.x
      const dz = v[1] - p.y
      if (dx * dx + dz * dz <= ROAD_VERTEX_MERGE_EPS2) {
        return i
      }
    }
    const idx = vertices.length
    vertices.push([p.x, p.y])
    return idx
  }

  if (polyPoints.length < 2) {
    return { vertices, segments, segmentHeights }
  }

  let prevIndex = findOrAddVertex(polyPoints[0]!)
  for (let i = 1; i < polyPoints.length; i += 1) {
    const idx = findOrAddVertex(polyPoints[i]!)
    if (idx !== prevIndex) {
      const key = segmentKey(prevIndex, idx)
      if (!existing.has(key)) {
        segments.push({ a: prevIndex, b: idx })
        segmentHeights.push(
          Array.isArray(polyHeights[i - 1]) && polyHeights[i - 1]!.length >= 2
            ? polyHeights[i - 1]!.map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0))
            : [0, 0],
        )
        existing.add(key)
      }
      prevIndex = idx
    }
  }

  return { vertices, segments, segmentHeights }
}

export function splitRoadSelfIntersectionsMesh(mesh: RoadDynamicMesh, defaultWidth: number): RoadDynamicMesh | null {
  if (mesh.type !== 'Road') {
    return null
  }
  const { vertices, segments } = sanitizeRoadDefinition(mesh)
  if (vertices.length < 2 || segments.length < 2) {
    return null
  }
  const vertices2 = vertices.map(([x, z]) => new THREE.Vector2(x, z))
  const splits = computeSelfIntersectionSplits(vertices2, segments)
  if (!splits.size) {
    return null
  }
  const rebuilt = applySegmentSplitsWithHeights(
    vertices,
    segments,
    normalizeSegmentHeightList(mesh.segmentHeights, segments.length),
    splits,
  )
  return {
    type: 'Road',
    width: Number.isFinite(mesh.width) ? Math.max(0.2, mesh.width) : defaultWidth,
    vertices: rebuilt.vertices,
    segments: rebuilt.segments,
    segmentHeights: rebuilt.segmentHeights,
  }
}

function applySegmentSplitsWithHeights(
  baseVertices: Array<[number, number]>,
  baseSegments: RoadSegment[],
  baseSegmentHeights: number[][],
  splitMap: Map<number, SplitPoint[]>,
): { vertices: Array<[number, number]>; segments: RoadSegment[]; segmentHeights: number[][] } {
  const vertices: Array<[number, number]> = baseVertices.map(([x, z]) => [x, z])

  const findOrAddVertex = (p: THREE.Vector2): number => {
    for (let i = 0; i < vertices.length; i += 1) {
      const v = vertices[i]!
      const dx = v[0] - p.x
      const dz = v[1] - p.y
      if (dx * dx + dz * dz <= ROAD_VERTEX_MERGE_EPS2) {
        return i
      }
    }
    const idx = vertices.length
    vertices.push([p.x, p.y])
    return idx
  }

  const segments: RoadSegment[] = []
  const segmentHeights: number[][] = []
  for (let segIndex = 0; segIndex < baseSegments.length; segIndex += 1) {
    const seg = baseSegments[segIndex]!
    const originalHeights = Array.isArray(baseSegmentHeights[segIndex]) && baseSegmentHeights[segIndex]!.length >= 2
      ? baseSegmentHeights[segIndex]!
      : [0, 0]
    const splits = (splitMap.get(segIndex) ?? []).slice()
    if (!splits.length) {
      segments.push({ a: seg.a, b: seg.b })
      segmentHeights.push(originalHeights.map((value) => Number.isFinite(Number(value)) ? Number(value) : 0))
      continue
    }

    splits.sort((a, b) => a.t - b.t)
    const chain: number[] = [seg.a]
    const chainT: number[] = [0]
    for (const s of splits) {
      if (s.t <= ROAD_INTERSECTION_EPS || s.t >= 1 - ROAD_INTERSECTION_EPS) {
        continue
      }
      chain.push(findOrAddVertex(s.point))
      chainT.push(s.t)
    }
    chain.push(seg.b)
    chainT.push(1)
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = chain[i]!
      const b = chain[i + 1]!
      if (a === b) {
        continue
      }
      segments.push({ a, b })
      const startT = chainT[i]!
      const endT = chainT[i + 1]!
      segmentHeights.push(resampleHeightSeries(originalHeights, startT, endT, originalHeights.length))
    }
  }

  return { vertices, segments, segmentHeights }
}

export function integrateWorldPolylineIntoRoadMesh(options: {
  baseMesh: RoadDynamicMesh
  runtime: THREE.Object3D
  worldPoints: THREE.Vector3[]
  width: number
  defaultWidth: number
  segmentHeights?: number[][]
}): RoadDynamicMesh | null {
  const { baseMesh, runtime, worldPoints } = options
  if (baseMesh.type !== 'Road') {
    return null
  }

  const { vertices: baseVertices, segments: baseSegments } = sanitizeRoadDefinition(baseMesh)
  if (baseVertices.length < 1) {
    return null
  }

  const baseVertices2 = baseVertices.map(([x, z]) => new THREE.Vector2(x, z))
  const polyLocal = buildLocalPolyline(runtime, worldPoints)
  if (polyLocal.length < 2) {
    return null
  }

  const baseSelfSplits = computeSelfIntersectionSplits(baseVertices2, baseSegments)
  const { roadSplits, polySplits } = computePolylineRoadIntersectionSplits(polyLocal, baseVertices2, baseSegments)
  const polySelfSplits = computeSelfIntersectionSplits(
    polyLocal,
    polyLocal.length >= 2 ? polyLocal.slice(0, -1).map((_, i) => ({ a: i, b: i + 1 })) : [],
  )

  const mergedRoadSplits = new Map<number, SplitPoint[]>()
  const mergeMap = (into: Map<number, SplitPoint[]>, from: Map<number, SplitPoint[]>) => {
    for (const [k, list] of from.entries()) {
      for (const entry of list) {
        pushSplitPoint(into, k, entry)
      }
    }
  }
  mergeMap(mergedRoadSplits, baseSelfSplits)
  mergeMap(mergedRoadSplits, roadSplits)

  const baseHeights = normalizeSegmentHeightList(baseMesh.segmentHeights, baseSegments.length)
  const rebuiltBase = mergedRoadSplits.size
    ? applySegmentSplitsWithHeights(baseVertices, baseSegments, baseHeights, mergedRoadSplits)
    : { vertices: baseVertices, segments: baseSegments, segmentHeights: baseHeights }

  const mergedPolySplits = new Map<number, SplitPoint[]>()
  mergeMap(mergedPolySplits, polySplits)
  mergeMap(mergedPolySplits, polySelfSplits)
  const expandedPoly = expandPolylineWithHeights(polyLocal, mergedPolySplits, options.segmentHeights)

  const combined = addPolylineSegmentsToRoadWithHeights(rebuiltBase, expandedPoly.points, expandedPoly.segmentHeights)
  return {
    type: 'Road',
    width: Number.isFinite(options.width) ? Math.max(0.2, options.width) : options.defaultWidth,
    vertices: combined.vertices,
    segments: combined.segments,
    segmentHeights: combined.segmentHeights,
  }
}

export function findConnectableRoadNodeId(options: {
  worldPoints: THREE.Vector3[]
  nodes: SceneNode[]
  getRuntimeObject: (nodeId: string) => THREE.Object3D | null
  collectRoadSnapVertices: () => RoadSnapVertex[]
  snapRoadPointToVertices: (
    point: THREE.Vector3,
    vertices: RoadSnapVertex[],
    vertexSnapDistance: number,
  ) => { position: THREE.Vector3; nodeId: string | null; vertexIndex: number | null }
  vertexSnapDistance: number
}): string | null {
  if (options.worldPoints.length < 2) {
    return null
  }

  const worldPolyline = dedupeWorldPolylineXZ(options.worldPoints)
  if (worldPolyline.length < 2) {
    return null
  }

  const snapVertices = options.collectRoadSnapVertices()
  const firstSnap = options.snapRoadPointToVertices(worldPolyline[0]!, snapVertices, options.vertexSnapDistance)
  if (firstSnap.nodeId) {
    return firstSnap.nodeId
  }
  const lastSnap = options.snapRoadPointToVertices(
    worldPolyline[worldPolyline.length - 1]!,
    snapVertices,
    options.vertexSnapDistance,
  )
  if (lastSnap.nodeId) {
    return lastSnap.nodeId
  }

  const roadVertexYByNode = new Map<string, Map<number, number>>()
  for (const snap of snapVertices) {
    if (!Number.isFinite(snap.position.y)) {
      continue
    }
    let perNode = roadVertexYByNode.get(snap.nodeId)
    if (!perNode) {
      perNode = new Map<number, number>()
      roadVertexYByNode.set(snap.nodeId, perNode)
    }
    perNode.set(snap.vertexIndex, snap.position.y)
  }

  const candidates: Array<{ nodeId: string; runtime: THREE.Object3D; vertices: THREE.Vector2[]; segments: RoadSegment[] }> = []
  const visit = (nodes: SceneNode[]) => {
    for (const node of nodes) {
      if (node.dynamicMesh?.type === 'Road') {
        const runtime = options.getRuntimeObject(node.id)
        if (runtime) {
          const sanitized = sanitizeRoadDefinition(node.dynamicMesh as RoadDynamicMesh)
          const vertices2 = sanitized.vertices.map(([x, z]) => new THREE.Vector2(x, z))
          candidates.push({ nodeId: node.id, runtime, vertices: vertices2, segments: sanitized.segments })
        }
      }
      if (node.children?.length) {
        visit(node.children)
      }
    }
  }
  visit(options.nodes)

  for (const candidate of candidates) {
    const polyLocal = buildLocalPolyline(candidate.runtime, worldPolyline)
    if (polyLocal.length < 2) {
      continue
    }
    const hits = computePolylineRoadIntersectionHits(polyLocal, candidate.vertices, candidate.segments)
    const candidateVertexY = roadVertexYByNode.get(candidate.nodeId)
    if (!candidateVertexY) {
      continue
    }

    let hasSameLayerIntersection = false
    for (const hit of hits) {
      const polyA = worldPolyline[hit.polySegmentIndex]
      const polyB = worldPolyline[hit.polySegmentIndex + 1]
      const roadSegment = candidate.segments[hit.roadSegmentIndex]
      if (!polyA || !polyB || !roadSegment) {
        continue
      }
      const roadYA = candidateVertexY.get(roadSegment.a)
      const roadYB = candidateVertexY.get(roadSegment.b)
      if (!Number.isFinite(roadYA) || !Number.isFinite(roadYB)) {
        continue
      }

      const polyY = sampleSegmentY(polyA, polyB, hit.t)
      const roadY = (roadYA as number) + ((roadYB as number) - (roadYA as number)) * hit.u
      if (Math.abs(polyY - roadY) <= ROAD_CONNECT_LAYER_MAX_DELTA_Y) {
        hasSameLayerIntersection = true
        break
      }
    }

    if (hasSameLayerIntersection) {
      return candidate.nodeId
    }
  }

  return null
}
