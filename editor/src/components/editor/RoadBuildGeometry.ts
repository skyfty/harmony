import * as THREE from 'three'
import type { RoadDynamicMesh, SceneNode } from '@harmony/schema'

export type RoadSnapVertex = { position: THREE.Vector3; nodeId: string; vertexIndex: number }

type RoadSegment = { a: number; b: number }

type SplitPoint = { t: number; point: THREE.Vector2 }

const ROAD_INTERSECTION_EPS = 1e-6
const ROAD_VERTEX_MERGE_EPS2 = 1e-10

export function sanitizeRoadDefinition(definition: RoadDynamicMesh): {
  vertices: Array<[number, number]>
  segments: RoadSegment[]
} {
  const vertices = (Array.isArray(definition.vertices) ? definition.vertices : []).map((v) => {
    const x = Number(Array.isArray(v) ? v[0] : 0)
    const z = Number(Array.isArray(v) ? v[1] : 0)
    return [Number.isFinite(x) ? x : 0, Number.isFinite(z) ? z : 0] as [number, number]
  })

  const segmentsRaw = Array.isArray(definition.segments) ? definition.segments : []
  const segments: RoadSegment[] = []
  for (const s of segmentsRaw as any[]) {
    const a = Math.trunc(Number((s as any)?.a))
    const b = Math.trunc(Number((s as any)?.b))
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) {
      continue
    }
    if (a >= vertices.length || b >= vertices.length) {
      continue
    }
    segments.push({ a, b })
  }

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

function expandPolyline(points: THREE.Vector2[], splitMap: Map<number, SplitPoint[]>): THREE.Vector2[] {
  if (points.length < 2) {
    return points
  }
  const out: THREE.Vector2[] = [points[0]!.clone()]
  for (let i = 0; i < points.length - 1; i += 1) {
    const splits = (splitMap.get(i) ?? []).slice()
    splits.sort((a, b) => a.t - b.t)
    for (const s of splits) {
      if (s.t <= ROAD_INTERSECTION_EPS || s.t >= 1 - ROAD_INTERSECTION_EPS) {
        continue
      }
      const prev = out[out.length - 1]
      if (!prev || prev.distanceToSquared(s.point) > ROAD_VERTEX_MERGE_EPS2) {
        out.push(s.point.clone())
      }
    }
    const end = points[i + 1]!
    const prev = out[out.length - 1]
    if (!prev || prev.distanceToSquared(end) > ROAD_VERTEX_MERGE_EPS2) {
      out.push(end.clone())
    }
  }
  return out
}

function applySegmentSplits(
  baseVertices: Array<[number, number]>,
  baseSegments: RoadSegment[],
  splitMap: Map<number, SplitPoint[]>,
): { vertices: Array<[number, number]>; segments: RoadSegment[] } {
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
  for (let segIndex = 0; segIndex < baseSegments.length; segIndex += 1) {
    const seg = baseSegments[segIndex]!
    const splits = (splitMap.get(segIndex) ?? []).slice()
    if (!splits.length) {
      segments.push({ a: seg.a, b: seg.b })
      continue
    }
    splits.sort((a, b) => a.t - b.t)
    const chain: number[] = [seg.a]
    for (const s of splits) {
      if (s.t <= ROAD_INTERSECTION_EPS || s.t >= 1 - ROAD_INTERSECTION_EPS) {
        continue
      }
      chain.push(findOrAddVertex(s.point))
    }
    chain.push(seg.b)
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = chain[i]!
      const b = chain[i + 1]!
      if (a !== b) {
        segments.push({ a, b })
      }
    }
  }
  return { vertices, segments }
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
  const roadSplits = new Map<number, SplitPoint[]>()
  const polySplits = new Map<number, SplitPoint[]>()
  if (poly.length < 2) {
    return { roadSplits, polySplits }
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
      pushSplitPoint(polySplits, i, { t: hit.t, point: hit.point })
      pushSplitPoint(roadSplits, j, { t: hit.u, point: hit.point })
    }
  }
  return { roadSplits, polySplits }
}

function addPolylineSegmentsToRoad(
  current: { vertices: Array<[number, number]>; segments: RoadSegment[] },
  polyPoints: THREE.Vector2[],
): { vertices: Array<[number, number]>; segments: RoadSegment[] } {
  const vertices: Array<[number, number]> = current.vertices.map(([x, z]) => [x, z])
  const segments: RoadSegment[] = current.segments.map((s) => ({ a: s.a, b: s.b }))

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
    return { vertices, segments }
  }

  let prevIndex = findOrAddVertex(polyPoints[0]!)
  for (let i = 1; i < polyPoints.length; i += 1) {
    const idx = findOrAddVertex(polyPoints[i]!)
    if (idx !== prevIndex) {
      const key = segmentKey(prevIndex, idx)
      if (!existing.has(key)) {
        segments.push({ a: prevIndex, b: idx })
        existing.add(key)
      }
      prevIndex = idx
    }
  }

  return { vertices, segments }
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
  const rebuilt = applySegmentSplits(vertices, segments, splits)
  return {
    type: 'Road',
    width: Number.isFinite(mesh.width) ? Math.max(0.2, mesh.width) : defaultWidth,
    vertices: rebuilt.vertices,
    segments: rebuilt.segments,
  }
}

export function integrateWorldPolylineIntoRoadMesh(options: {
  baseMesh: RoadDynamicMesh
  runtime: THREE.Object3D
  worldPoints: THREE.Vector3[]
  width: number
  defaultWidth: number
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

  const rebuiltBase = mergedRoadSplits.size
    ? applySegmentSplits(baseVertices, baseSegments, mergedRoadSplits)
    : { vertices: baseVertices, segments: baseSegments }

  const mergedPolySplits = new Map<number, SplitPoint[]>()
  mergeMap(mergedPolySplits, polySplits)
  mergeMap(mergedPolySplits, polySelfSplits)
  const expandedPoly = expandPolyline(polyLocal, mergedPolySplits)

  const combined = addPolylineSegmentsToRoad(rebuiltBase, expandedPoly)
  return {
    type: 'Road',
    width: Number.isFinite(options.width) ? Math.max(0.2, options.width) : options.defaultWidth,
    vertices: combined.vertices,
    segments: combined.segments,
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

  const snapVertices = options.collectRoadSnapVertices()
  const firstSnap = options.snapRoadPointToVertices(options.worldPoints[0]!, snapVertices, options.vertexSnapDistance)
  if (firstSnap.nodeId) {
    return firstSnap.nodeId
  }
  const lastSnap = options.snapRoadPointToVertices(
    options.worldPoints[options.worldPoints.length - 1]!,
    snapVertices,
    options.vertexSnapDistance,
  )
  if (lastSnap.nodeId) {
    return lastSnap.nodeId
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
    const polyLocal = buildLocalPolyline(candidate.runtime, options.worldPoints)
    if (polyLocal.length < 2) {
      continue
    }
    const { roadSplits } = computePolylineRoadIntersectionSplits(polyLocal, candidate.vertices, candidate.segments)
    if (roadSplits.size) {
      return candidate.nodeId
    }
  }

  return null
}
