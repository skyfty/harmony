import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MATERIAL_CONFIG_ID_KEY } from './material'

export type RoadRenderAssetObjects = {
  bodyObject?: THREE.Object3D | null
}

export type RoadJunctionSmoothingOptions = {
  junctionSmoothing?: number
  laneLines?: boolean
  shoulders?: boolean
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
const ROAD_LANE_LINE_WIDTH = 0.18
const ROAD_SHOULDER_WIDTH = 0.35
const ROAD_SHOULDER_GAP = 0.02
const ROAD_LANE_LINE_OFFSET_Y = 0.002
const ROAD_SHOULDER_OFFSET_Y = 0.001
const ROAD_OVERLAY_MIN_WIDTH = 0.01
const ROAD_LANE_LINE_COLOR = 0x27ffff

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

function createLaneLineMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: ROAD_LANE_LINE_COLOR,
    transparent: true,
    opacity: 0.9,
  })
  material.name = 'RoadLaneLineMaterial'
  material.depthWrite = false
  material.polygonOffset = true
  material.polygonOffsetFactor = -2
  material.polygonOffsetUnits = -2
  material.toneMapped = false
  material.depthTest = false
  return material
}

function createShoulderMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    metalness: 0,
    roughness: 0.9,
    transparent: true,
    opacity: 0.85,
  })
  material.name = 'RoadShoulderMaterial'
  material.side = THREE.DoubleSide
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -1
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

type RoadBuildData = {
  vertexVectors: Array<THREE.Vector3 | null>
  paths: RoadPath[]
}

type RoadCurveDescriptor = {
  curve: THREE.Curve<THREE.Vector3>
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

function collectRoadBuildData(definition: RoadDynamicMesh): RoadBuildData | null {
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

  return { vertexVectors, paths }
}

function createRoadCurve(points: THREE.Vector3[], closed: boolean, tension: number): THREE.Curve<THREE.Vector3> {
  if (points.length === 2) {
    return new THREE.LineCurve3(points[0], points[1])
  }
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom')
  curve.tension = Math.max(0, Math.min(1, tension))
  return curve
}

function buildRoadCurves(smoothing: number, buildData: RoadBuildData): RoadCurveDescriptor[] {
  const tension = Math.max(0, Math.min(1, 1 - smoothing))
  const curves: RoadCurveDescriptor[] = []
  for (const path of buildData.paths) {
    const points = path.indices
      .map((vertexIndex) => buildData.vertexVectors[vertexIndex])
      .filter((point): point is THREE.Vector3 => Boolean(point))
    if (points.length < 2) {
      continue
    }
    const curve = createRoadCurve(points, path.closed && points.length >= 3, tension)
    curves.push({ curve })
  }
  return curves
}

function buildOffsetStripGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  width: number,
  offset: number,
): THREE.BufferGeometry | null {
  const length = curve.getLength()
  if (length <= ROAD_EPSILON) {
    return null
  }

  const divisions = Math.max(
    ROAD_MIN_DIVISIONS,
    Math.min(ROAD_MAX_DIVISIONS, Math.ceil(length * ROAD_DIVISION_DENSITY)),
  )

  const halfWidth = Math.max(ROAD_OVERLAY_MIN_WIDTH * 0.5, width * 0.5)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const center = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const lateral = new THREE.Vector3()
  const offsetCenter = new THREE.Vector3()
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
    offsetCenter.copy(center).addScaledVector(lateral, offset)
    left.copy(offsetCenter).addScaledVector(lateral, halfWidth)
    right.copy(offsetCenter).addScaledVector(lateral, -halfWidth)

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

function buildRoadStripGeometry(curve: THREE.Curve<THREE.Vector3>, width: number): THREE.BufferGeometry | null {
  return buildOffsetStripGeometry(curve, width, 0)
}

function buildMultiCurveGeometry(
  curves: RoadCurveDescriptor[],
  builder: (curve: THREE.Curve<THREE.Vector3>) => THREE.BufferGeometry | null,
): THREE.BufferGeometry | null {
  const geometries: THREE.BufferGeometry[] = []
  for (const descriptor of curves) {
    const geometry = builder(descriptor.curve)
    if (geometry) {
      geometries.push(geometry)
    }
  }
  if (!geometries.length) {
    return null
  }
  const merged = mergeGeometries(geometries, false)
  geometries.forEach((geometry) => geometry.dispose())
  return merged ?? null
}

function buildOverlayGeometry(
  curves: RoadCurveDescriptor[],
  width: number,
  offset: number,
): THREE.BufferGeometry | null {
  return buildMultiCurveGeometry(curves, (curve) => buildOffsetStripGeometry(curve, width, offset))
}

function rebuildRoadGroup(group: THREE.Group, definition: RoadDynamicMesh, options: RoadJunctionSmoothingOptions = {}) {
  clearGroupContent(group)

  const smoothing = normalizeJunctionSmoothing(options.junctionSmoothing)
  const width = Math.max(ROAD_MIN_WIDTH, Number.isFinite(definition.width) ? definition.width : ROAD_DEFAULT_WIDTH)
  const buildData = collectRoadBuildData(definition)
  if (!buildData) {
    return
  }

  const curves = buildRoadCurves(smoothing, buildData)
  if (!curves.length) {
    return
  }

  const roadGeometry = buildMultiCurveGeometry(curves, (curve) => buildRoadStripGeometry(curve, width))
  if (!roadGeometry) {
    return
  }

  const roadMesh = new THREE.Mesh(roadGeometry, createRoadMaterial())
  roadMesh.name = 'RoadMesh'
  roadMesh.castShadow = false
  roadMesh.receiveShadow = true
  group.add(roadMesh)

  if (options.shoulders) {
    const shoulderOffset = width * 0.5 + ROAD_SHOULDER_GAP + ROAD_SHOULDER_WIDTH * 0.5
    const shoulderGeometries: THREE.BufferGeometry[] = []
    const leftShoulder = buildOverlayGeometry(curves, ROAD_SHOULDER_WIDTH, shoulderOffset)
    if (leftShoulder) {
      shoulderGeometries.push(leftShoulder)
    }
    const rightShoulder = buildOverlayGeometry(curves, ROAD_SHOULDER_WIDTH, -shoulderOffset)
    if (rightShoulder) {
      shoulderGeometries.push(rightShoulder)
    }
    if (shoulderGeometries.length) {
      const mergedShoulder = mergeGeometries(shoulderGeometries, false)
      shoulderGeometries.forEach((geometry) => geometry.dispose())
      if (mergedShoulder) {
        const shoulderMesh = new THREE.Mesh(mergedShoulder, createShoulderMaterial())
        shoulderMesh.name = 'RoadShoulders'
        shoulderMesh.position.y = ROAD_SHOULDER_OFFSET_Y
        shoulderMesh.userData.overrideMaterial = true
        group.add(shoulderMesh)
      }
    }
  }

  if (options.laneLines) {
    const laneLineWidth = Math.max(
      ROAD_OVERLAY_MIN_WIDTH * 3,
      Math.min(ROAD_LANE_LINE_WIDTH, width * 0.12 + ROAD_OVERLAY_MIN_WIDTH),
    )
    const laneGeometry = buildOverlayGeometry(curves, laneLineWidth, 0)
    if (laneGeometry) {
      const laneMesh = new THREE.Mesh(laneGeometry, createLaneLineMaterial())
      laneMesh.name = 'RoadLaneLines'
      laneMesh.position.y = ROAD_LANE_LINE_OFFSET_Y
      laneMesh.renderOrder = 1000
      laneMesh.userData.overrideMaterial = true
      group.add(laneMesh)
    }
  }

  const rawMaterialId = typeof options.materialConfigId === 'string' ? options.materialConfigId.trim() : ''
  roadMesh.userData[MATERIAL_CONFIG_ID_KEY] = rawMaterialId || null
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
