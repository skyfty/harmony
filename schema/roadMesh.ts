import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MATERIAL_CONFIG_ID_KEY } from './material'

export type RoadRenderAssetObjects = {
  bodyObject?: THREE.Object3D | null
}

export type RoadJunctionSmoothingOptions = {
  junctionSmoothing?: number
  /** Optional node material selector id (editor-defined). */
  materialConfigId?: string | null
}

const DEFAULT_COLOR = 0x4b4f55
const ROAD_SURFACE_Y_OFFSET = 0.01
const ROAD_EPSILON = 1e-6
const ROAD_MIN_WIDTH = 0.2
const ROAD_DEFAULT_WIDTH = 2
const ROAD_MIN_DIVISIONS = 4
const ROAD_MAX_DIVISIONS = 256
const ROAD_DIVISION_DENSITY = 8

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    if (mesh.geometry) {
      mesh.geometry.dispose()
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose())
    } else if (material) {
      material.dispose()
    }
  })
}

function clearGroupContent(group: THREE.Group) {
  while (group.children.length) {
    const child = group.children.pop()
    if (child) {
      disposeObject3D(child)
    }
  }
}

function createRoadMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR,
    metalness: 0.05,
    roughness: 0.85,
  })
  material.name = 'RoadMaterial'
  material.side = THREE.DoubleSide
  return material
}

function normalizeJunctionSmoothing(value?: number): number {
  const sanitized: number = Number.isFinite(value) ? (value as number) : 0
  return Math.max(0, Math.min(1, sanitized))
}

function sanitizeRoadVertices(vertices: unknown): Array<THREE.Vector3 | null> {
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

type SanitizedRoadSegment = {
  a: number
  b: number
  segmentIndex: number
}

type RoadPath = {
  indices: number[]
  closed: boolean
}

function buildAdjacencyMap(
  segments: SanitizedRoadSegment[],
): Map<number, Array<{ neighbor: number; segmentIndex: number }>> {
  const adjacency = new Map<number, Array<{ neighbor: number; segmentIndex: number }>>()
  const addEntry = (vertex: number, neighbor: number, segmentIndex: number) => {
    const entries = adjacency.get(vertex) ?? []
    entries.push({ neighbor, segmentIndex })
    adjacency.set(vertex, entries)
  }

  for (const segment of segments) {
    addEntry(segment.a, segment.b, segment.segmentIndex)
    addEntry(segment.b, segment.a, segment.segmentIndex)
  }

  adjacency.forEach((entries) => entries.sort((a, b) => a.neighbor - b.neighbor))
  return adjacency
}

function collectRoadPaths(
  adjacency: Map<number, Array<{ neighbor: number; segmentIndex: number }>>,
  segments: SanitizedRoadSegment[],
): RoadPath[] {
  const visited = new Set<number>()
  const paths: RoadPath[] = []

  const walk = (start: number, preferred?: number): number[] => {
    const route: number[] = [start]
    let current = start
    let pending = preferred

    while (true) {
      const neighbors = adjacency.get(current)
      if (!neighbors?.length) {
        break
      }
      let nextEntry = undefined
      if (pending !== undefined) {
        nextEntry = neighbors.find((entry) => entry.segmentIndex === pending && !visited.has(entry.segmentIndex))
        pending = undefined
      }
      if (!nextEntry) {
        nextEntry = neighbors.find((entry) => !visited.has(entry.segmentIndex))
      }
      if (!nextEntry) {
        break
      }
      visited.add(nextEntry.segmentIndex)
      current = nextEntry.neighbor
      route.push(current)
    }

    return route
  }

  const hasPending = (vertex: number) => {
    const neighbors = adjacency.get(vertex)
    return Boolean(neighbors?.some((entry) => !visited.has(entry.segmentIndex)))
  }

  const buildPath = (route: number[]): RoadPath | null => {
    if (route.length < 2) {
      return null
    }
    const cleaned = route.slice()
    let closed = false
    if (cleaned.length >= 3 && cleaned[0] === cleaned[cleaned.length - 1]) {
      closed = true
      cleaned.pop()
    }
    if (cleaned.length < 2) {
      return null
    }
    return { indices: cleaned, closed }
  }

  const degrees = new Map<number, number>()
  adjacency.forEach((entries, vertex) => degrees.set(vertex, entries.length))

  const endpoints = Array.from(degrees.entries())
    .filter(([, degree]) => degree === 1)
    .map(([vertex]) => vertex)

  for (const endpoint of endpoints) {
    if (!hasPending(endpoint)) {
      continue
    }
    const path = buildPath(walk(endpoint))
    if (path) {
      paths.push(path)
    }
  }

  for (const segment of segments) {
    if (visited.has(segment.segmentIndex)) {
      continue
    }
    const path = buildPath(walk(segment.a, segment.segmentIndex))
    if (path) {
      paths.push(path)
    }
  }

  return paths
}

function createRoadCurve(points: THREE.Vector3[], closed: boolean, tension: number): THREE.Curve<THREE.Vector3> {
  if (points.length === 2) {
    return new THREE.LineCurve3(points[0], points[1])
  }
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom')
  curve.tension = Math.max(0, Math.min(1, tension))
  return curve
}

function buildRoadStripGeometry(curve: THREE.Curve<THREE.Vector3>, width: number): THREE.BufferGeometry | null {
  const length = curve.getLength()
  if (length <= ROAD_EPSILON) {
    return null
  }

  const divisions = Math.max(
    ROAD_MIN_DIVISIONS,
    Math.min(ROAD_MAX_DIVISIONS, Math.ceil(length * ROAD_DIVISION_DENSITY)),
  )

  const halfWidth = Math.max(ROAD_MIN_WIDTH * 0.5, width * 0.5)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const center = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const lateral = new THREE.Vector3()
  const left = new THREE.Vector3()
  const right = new THREE.Vector3()

  for (let i = 0; i <= divisions; i += 1) {
    const t = i / divisions
    center.copy(curve.getPoint(t))
    tangent.copy(curve.getTangent(t))
    tangent.y = 0
    if (tangent.lengthSq() <= ROAD_EPSILON) {
      tangent.set(0, 0, 1)
    } else {
      tangent.normalize()
    }
    lateral.set(-tangent.z, 0, tangent.x)
    left.copy(center).addScaledVector(lateral, halfWidth)
    right.copy(center).addScaledVector(lateral, -halfWidth)

    positions.push(left.x, left.y, left.z, right.x, right.y, right.z)
    normals.push(0, 1, 0, 0, 1, 0)
    uvs.push(t, 0, t, 1)

    if (i < divisions) {
      const base = i * 2
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildRoadGeometry(definition: RoadDynamicMesh, smoothing: number, width: number): THREE.BufferGeometry | null {
  const vertexVectors = sanitizeRoadVertices(definition.vertices)
  if (!vertexVectors.length) {
    return null
  }

  const rawSegments = Array.isArray(definition.segments) ? definition.segments : []
  const sanitizedSegments: SanitizedRoadSegment[] = []

  rawSegments.forEach((segment, index) => {
    const a = Number(segment.a)
    const b = Number(segment.b)
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      return
    }
    if (a < 0 || b < 0 || a >= vertexVectors.length || b >= vertexVectors.length) {
      return
    }
    if (!vertexVectors[a] || !vertexVectors[b] || a === b) {
      return
    }
    sanitizedSegments.push({ a, b, segmentIndex: index })
  })

  if (!sanitizedSegments.length) {
    return null
  }

  const adjacency = buildAdjacencyMap(sanitizedSegments)
  const paths = collectRoadPaths(adjacency, sanitizedSegments)
  if (!paths.length) {
    return null
  }

  const geometries: THREE.BufferGeometry[] = []
  const tension = Math.max(0, Math.min(1, 1 - smoothing))

  for (const path of paths) {
    const points = path.indices.map((vertexIndex) => vertexVectors[vertexIndex]!)
    if (points.length < 2) {
      continue
    }
    const curve = createRoadCurve(points, path.closed && points.length >= 3, tension)
    const stripGeometry = buildRoadStripGeometry(curve, width)
    if (stripGeometry) {
      geometries.push(stripGeometry)
    }
  }

  if (!geometries.length) {
    return null
  }

  const merged = mergeGeometries(geometries, false)
  geometries.forEach((geometry) => geometry.dispose())
  return merged ?? null
}

function rebuildRoadGroup(group: THREE.Group, definition: RoadDynamicMesh, options: RoadJunctionSmoothingOptions = {}) {
  clearGroupContent(group)

  const smoothing = normalizeJunctionSmoothing(options.junctionSmoothing)
  const width = Math.max(ROAD_MIN_WIDTH, Number.isFinite(definition.width) ? definition.width : ROAD_DEFAULT_WIDTH)
  const geometry = buildRoadGeometry(definition, smoothing, width)
  if (!geometry) {
    return
  }

  const mesh = new THREE.Mesh(geometry, createRoadMaterial())
  mesh.name = 'RoadMesh'
  mesh.castShadow = false
  mesh.receiveShadow = true

  const rawMaterialId = typeof options.materialConfigId === 'string' ? options.materialConfigId.trim() : ''
  mesh.userData[MATERIAL_CONFIG_ID_KEY] = rawMaterialId || null
  group.add(mesh)
}

function ensureRoadContentGroup(root: THREE.Group): THREE.Group {
  const existing = root.getObjectByName('__RoadContent')
  if (existing && (existing as THREE.Group).isGroup) {
    return existing as THREE.Group
  }

  const content = new THREE.Group()
  content.name = '__RoadContent'
  content.position.y = ROAD_SURFACE_Y_OFFSET
  root.add(content)
  return content
}

export function createRoadRenderGroup(
  definition: RoadDynamicMesh,
  assets: RoadRenderAssetObjects = {},
  options: RoadJunctionSmoothingOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'RoadGroup'
  group.userData.dynamicMeshType = 'Road'

  const content = ensureRoadContentGroup(group)

  let hasInstances = false
  if (assets.bodyObject) {
    // Placeholder for future instanced road assets.
  }

  if (!hasInstances) {
    rebuildRoadGroup(content, definition, options)
  }

  return group
}

export function createRoadGroup(definition: RoadDynamicMesh, options: RoadJunctionSmoothingOptions = {}): THREE.Group {
  const group = new THREE.Group()
  group.name = 'RoadGroup'
  group.userData.dynamicMeshType = 'Road'
  const content = ensureRoadContentGroup(group)
  rebuildRoadGroup(content, definition, options)
  return group
}

export function updateRoadGroup(
  object: THREE.Object3D,
  definition: RoadDynamicMesh,
  options: RoadJunctionSmoothingOptions = {},
): boolean {
  const group = object as THREE.Group
  if (!group || !group.isGroup) {
    return false
  }

  const content = ensureRoadContentGroup(group)
  rebuildRoadGroup(content, definition, options)
  return true
}
