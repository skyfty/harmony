import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'

const EPSILON = 1e-6

export type RoadGraphEdge = {
  indices: number[]
  closed: boolean
  startVertex: number
  endVertex: number
}

export type RoadGraph = {
  vertices: Array<THREE.Vector3 | null>
  degrees: number[]
  adjacency: Map<number, number[]> // vertex -> sorted neighbor vertices
  edges: RoadGraphEdge[]
  junctionVertices: number[]
}

function sanitizeVertices(vertices: unknown): Array<THREE.Vector3 | null> {
  if (!Array.isArray(vertices)) {
    return []
  }
  return vertices.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      return null
    }
    const x = Number(entry[0])
    const z = Number(entry[1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return null
    }
    return new THREE.Vector3(x, 0, z)
  })
}

function buildAdjacency(def: RoadDynamicMesh, vertices: Array<THREE.Vector3 | null>): Map<number, number[]> {
  const adjacency = new Map<number, Set<number>>()
  const segments = Array.isArray(def.segments) ? def.segments : []

  for (const segment of segments) {
    const a = Number((segment as any)?.a)
    const b = Number((segment as any)?.b)
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      continue
    }
    if (a < 0 || b < 0 || a >= vertices.length || b >= vertices.length) {
      continue
    }
    if (!vertices[a] || !vertices[b] || a === b) {
      continue
    }

    const setA = adjacency.get(a) ?? new Set<number>()
    setA.add(b)
    adjacency.set(a, setA)

    const setB = adjacency.get(b) ?? new Set<number>()
    setB.add(a)
    adjacency.set(b, setB)
  }

  const normalized = new Map<number, number[]>()
  adjacency.forEach((neighbors, vertex) => {
    const list = Array.from(neighbors)
    list.sort((x, y) => x - y)
    normalized.set(vertex, list)
  })
  return normalized
}

function keyEdge(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function buildRoadGraph(definition: RoadDynamicMesh): RoadGraph | null {
  const vertices = sanitizeVertices((definition as any).vertices)
  if (!vertices.length) {
    return null
  }

  const adjacency = buildAdjacency(definition, vertices)
  if (!adjacency.size) {
    return null
  }

  const degrees: number[] = new Array(vertices.length).fill(0)
  adjacency.forEach((neighbors, vertex) => {
    degrees[vertex] = neighbors.length
  })

  const junctionVertices: number[] = []
  for (let i = 0; i < degrees.length; i += 1) {
    if ((degrees[i] ?? 0) >= 3) {
      junctionVertices.push(i)
    }
  }

  const visitedUndirected = new Set<string>()
  const edges: RoadGraphEdge[] = []

  const walkEdge = (start: number, next: number): RoadGraphEdge | null => {
    const indices: number[] = [start]
    let prev = start
    let cur = next

    visitedUndirected.add(keyEdge(start, next))

    while (true) {
      indices.push(cur)

      const deg = degrees[cur] ?? 0
      const neighbors = adjacency.get(cur) ?? []

      // Stop at junctions/endpoints (degree != 2), unless we are closing a loop.
      if (deg !== 2) {
        return {
          indices,
          closed: false,
          startVertex: indices[0]!,
          endVertex: indices[indices.length - 1]!,
        }
      }

      // Degree==2: continue to the neighbor that isn't prev.
      if (neighbors.length !== 2) {
        return {
          indices,
          closed: false,
          startVertex: indices[0]!,
          endVertex: indices[indices.length - 1]!,
        }
      }

      const n0 = neighbors[0]!
      const n1 = neighbors[1]!
      const nxt = n0 === prev ? n1 : n0

      // Loop closure.
      if (nxt === indices[0]) {
        indices.push(nxt)
        visitedUndirected.add(keyEdge(cur, nxt))
        return {
          indices: indices.slice(0, indices.length - 1), // do not repeat first vertex
          closed: true,
          startVertex: indices[0]!,
          endVertex: indices[0]!,
        }
      }

      const eKey = keyEdge(cur, nxt)
      if (visitedUndirected.has(eKey)) {
        return {
          indices,
          closed: false,
          startVertex: indices[0]!,
          endVertex: indices[indices.length - 1]!,
        }
      }

      visitedUndirected.add(eKey)
      prev = cur
      cur = nxt
    }
  }

  // Start walks from every junction/endpoint.
  adjacency.forEach((neighbors, v) => {
    const deg = degrees[v] ?? 0
    if (deg === 0) {
      return
    }
    if (deg === 2) {
      return
    }
    for (const n of neighbors) {
      const eKey = keyEdge(v, n)
      if (visitedUndirected.has(eKey)) {
        continue
      }
      const edge = walkEdge(v, n)
      if (edge && edge.indices.length >= 2) {
        edges.push(edge)
      }
    }
  })

  // Remaining cycles (all degree==2).
  adjacency.forEach((neighbors, v) => {
    if ((degrees[v] ?? 0) !== 2) {
      return
    }
    for (const n of neighbors) {
      const eKey = keyEdge(v, n)
      if (visitedUndirected.has(eKey)) {
        continue
      }
      const edge = walkEdge(v, n)
      if (edge && edge.indices.length >= 3) {
        edges.push(edge)
      }
    }
  })

  if (!edges.length) {
    return null
  }

  return { vertices, degrees, adjacency, edges, junctionVertices }
}

export function getJunctionIncidentDirectionsXZ(graph: RoadGraph, junctionVertex: number): THREE.Vector3[] {
  const center = graph.vertices[junctionVertex]
  if (!center) {
    return []
  }
  const neighbors = graph.adjacency.get(junctionVertex) ?? []
  const dirs: THREE.Vector3[] = []
  for (const n of neighbors) {
    const p = graph.vertices[n]
    if (!p) {
      continue
    }
    const d = new THREE.Vector3().subVectors(p, center)
    d.y = 0
    if (d.lengthSq() <= EPSILON * EPSILON) {
      continue
    }
    d.normalize()
    dirs.push(d)
  }
  return dirs
}
