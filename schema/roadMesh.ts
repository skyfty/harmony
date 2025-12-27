import * as THREE from 'three'
import type { GroundDynamicMesh, RoadDynamicMesh, SceneNode } from '@harmony/schema'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MATERIAL_CONFIG_ID_KEY } from './material'
import { sampleGroundHeight } from './groundMesh'

export function resolveRoadLocalHeightSampler(
  roadNode: SceneNode,
  groundNode: SceneNode | null | undefined,
): ((x: number, z: number) => number) | null {
  const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground'
    ? (groundNode.dynamicMesh as GroundDynamicMesh)
    : null
  if (!groundDefinition) {
    return null
  }

  const roadPosition = (roadNode.position as { x?: unknown; y?: unknown; z?: unknown } | undefined) ?? undefined
  const roadRotation = (roadNode.rotation as { x?: unknown; y?: unknown; z?: unknown } | undefined) ?? undefined

  const roadOriginX = typeof roadPosition?.x === 'number' && Number.isFinite(roadPosition.x) ? roadPosition.x : 0
  const roadOriginY = typeof roadPosition?.y === 'number' && Number.isFinite(roadPosition.y) ? roadPosition.y : 0
  const roadOriginZ = typeof roadPosition?.z === 'number' && Number.isFinite(roadPosition.z) ? roadPosition.z : 0
  const yaw = typeof roadRotation?.y === 'number' && Number.isFinite(roadRotation.y) ? roadRotation.y : 0
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)

  const groundPosition = (groundNode?.position as { x?: unknown; y?: unknown; z?: unknown } | undefined) ?? undefined
  const groundOriginX = typeof groundPosition?.x === 'number' && Number.isFinite(groundPosition.x) ? groundPosition.x : 0
  const groundOriginY = typeof groundPosition?.y === 'number' && Number.isFinite(groundPosition.y) ? groundPosition.y : 0
  const groundOriginZ = typeof groundPosition?.z === 'number' && Number.isFinite(groundPosition.z) ? groundPosition.z : 0

  return (x: number, z: number) => {
    const rotatedX = x * cosYaw - z * sinYaw
    const rotatedZ = x * sinYaw + z * cosYaw

    const worldX = roadOriginX + rotatedX
    const worldZ = roadOriginZ + rotatedZ

    const groundLocalX = worldX - groundOriginX
    const groundLocalZ = worldZ - groundOriginZ
    const groundWorldY = groundOriginY + sampleGroundHeight(groundDefinition, groundLocalX, groundLocalZ)
    return groundWorldY - roadOriginY
  }
}

export type RoadRenderAssetObjects = {
  bodyObject?: THREE.Object3D | null
}

export type RoadJunctionSmoothingOptions = {
  junctionSmoothing?: number
  laneLines?: boolean
  shoulders?: boolean
  /** Optional node material selector id (editor-defined). */
  materialConfigId?: string | null
  /** Optional height sampler (world/local XZ -> height Y). When omitted, roads are built flat at y=0. */
  heightSampler?: ((x: number, z: number) => number) | null
  /** Sampling density factor (higher = more divisions). Default 1.0 */
  samplingDensityFactor?: number
  /** Smoothing strength factor (higher = more smoothing passes). Default 1.0 */
  smoothingStrengthFactor?: number
  /** Minimum clearance above terrain (added to yOffset). Default 0 */
  minClearance?: number
  /** Override lane line width (meters). If undefined, uses default calculation */
  laneLineWidth?: number
  /** Override shoulder width (meters). If undefined, uses ROAD_SHOULDER_WIDTH constant */
  shoulderWidth?: number
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
const ROAD_LANE_LINE_DASH_LENGTH = 2.0
const ROAD_LANE_LINE_GAP_LENGTH = 2.0
const ROAD_SHOULDER_WIDTH = 0.35
const ROAD_SHOULDER_GAP = 0.02
const ROAD_LANE_LINE_OFFSET_Y = 0.002
const ROAD_SHOULDER_OFFSET_Y = 0.001
const ROAD_OVERLAY_MIN_WIDTH = 0.01
const ROAD_LANE_LINE_COLOR = 0x27ffff

const ROAD_HEIGHT_SMOOTHING_MIN_PASSES = 3
const ROAD_HEIGHT_SMOOTHING_MAX_PASSES = 12

const ROAD_HEIGHT_SLOPE_MAX_GRADE = 0.8
const ROAD_HEIGHT_SLOPE_MIN_DELTA_Y = 0.03

function computeHeightSmoothingPasses(divisions: number, strengthFactor = 1.0): number {
  if (!Number.isFinite(divisions) || divisions <= 0) {
    return ROAD_HEIGHT_SMOOTHING_MIN_PASSES
  }
  const factor = Math.max(0.1, Math.min(5, Number.isFinite(strengthFactor) ? strengthFactor : 1.0))
  // More divisions means higher-frequency terrain sampling; increase smoothing to keep the road profile smooth.
  const suggested = Math.round((divisions / 12) * factor)
  return Math.max(ROAD_HEIGHT_SMOOTHING_MIN_PASSES, Math.min(ROAD_HEIGHT_SMOOTHING_MAX_PASSES, suggested))
}

function computeRoadDivisions(length: number, samplingDensityFactor = 1.0): number {
  if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
    return ROAD_MIN_DIVISIONS
  }
  const densityFactor = Math.max(0.1, Math.min(5, Number.isFinite(samplingDensityFactor) ? samplingDensityFactor : 1.0))
  return Math.max(
    ROAD_MIN_DIVISIONS,
    Math.min(ROAD_MAX_DIVISIONS, Math.ceil(length * ROAD_DIVISION_DENSITY * densityFactor)),
  )
}

function smoothHeightSeries(values: number[], passes: number, minimums: number[]): number[] {
  const count = values.length
  if (count <= 2 || minimums.length !== count) {
    return values
  }
  const iterations = Math.max(0, Math.min(12, Math.trunc(passes)))
  if (iterations === 0) {
    return values
  }

  let working = values.slice()
  for (let pass = 0; pass < iterations; pass += 1) {
    const next = working.slice()
    if (count >= 5) {
      // A slightly wider kernel reduces the “stair-step” look when sampling rough terrain.
      // Gaussian-ish weights: [1, 4, 6, 4, 1] / 16
      for (let i = 2; i < count - 2; i += 1) {
        const a = working[i - 2]!
        const b = working[i - 1]!
        const c = working[i]!
        const d = working[i + 1]!
        const e = working[i + 2]!
        next[i] = Math.max(minimums[i]!, (a + b * 4 + c * 6 + d * 4 + e) / 16)
      }
      // Near endpoints, fall back to 3-tap smoothing.
      for (let i = 1; i < Math.min(2, count - 1); i += 1) {
        const prev = working[i - 1]!
        const cur = working[i]!
        const nxt = working[i + 1]!
        next[i] = Math.max(minimums[i]!, prev * 0.25 + cur * 0.5 + nxt * 0.25)
      }
      for (let i = Math.max(count - 2, 1); i < count - 1; i += 1) {
        const prev = working[i - 1]!
        const cur = working[i]!
        const nxt = working[i + 1]!
        next[i] = Math.max(minimums[i]!, prev * 0.25 + cur * 0.5 + nxt * 0.25)
      }
    } else {
      for (let i = 1; i < count - 1; i += 1) {
        const prev = working[i - 1]!
        const cur = working[i]!
        const nxt = working[i + 1]!
        next[i] = Math.max(minimums[i]!, prev * 0.25 + cur * 0.5 + nxt * 0.25)
      }
    }
    // Clamp endpoints as well, in case callers modify them.
    next[0] = Math.max(minimums[0]!, next[0]!)
    next[count - 1] = Math.max(minimums[count - 1]!, next[count - 1]!)
    working = next
  }

  return working
}

function clampHeightSeriesSlope(values: number[], minimums: number[], maxDeltaY: number): number[] {
  const count = values.length
  if (count <= 2 || minimums.length !== count) {
    return values
  }
  const delta = Number.isFinite(maxDeltaY) ? Math.max(0, maxDeltaY) : 0
  if (delta <= 0) {
    return values
  }

  const working = values.slice()

  for (let i = 1; i < count; i += 1) {
    const prev = working[i - 1]!
    const cur = working[i]!
    const clamped = Math.min(prev + delta, Math.max(prev - delta, cur))
    working[i] = Math.max(minimums[i]!, clamped)
  }

  for (let i = count - 2; i >= 0; i -= 1) {
    const next = working[i + 1]!
    const cur = working[i]!
    const clamped = Math.min(next + delta, Math.max(next - delta, cur))
    working[i] = Math.max(minimums[i]!, clamped)
  }

  return working
}

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
  heightSampler?: ((x: number, z: number) => number) | null,
  yOffset = 0,
  options: { samplingDensityFactor?: number; smoothingStrengthFactor?: number; minClearance?: number } = {},
  sharedHeightSeries?: number[] | null,
  dashPattern?: { dashLength: number; gapLength: number } | null,
): THREE.BufferGeometry | null {
  const length = curve.getLength()
  if (length <= ROAD_EPSILON) {
    return null
  }

  const useSharedHeightSeries = Array.isArray(sharedHeightSeries) && sharedHeightSeries.length >= 2
  const divisions = useSharedHeightSeries
    ? sharedHeightSeries.length - 1
    : computeRoadDivisions(length, options.samplingDensityFactor)

  const halfWidth = Math.max(ROAD_OVERLAY_MIN_WIDTH * 0.5, width * 0.5)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const center = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const lateral = new THREE.Vector3()
  const offsetCenter = new THREE.Vector3()
  const left = new THREE.Vector3()
  const right = new THREE.Vector3()

  const sampler = typeof heightSampler === 'function' ? heightSampler : null
  const heights: number[] | null = useSharedHeightSeries ? (sharedHeightSeries as number[]) : (sampler ? [] : null)
  const minHeights: number[] | null = useSharedHeightSeries ? null : (sampler ? [] : null)
  const extraClearance = Number.isFinite(options.minClearance) ? Math.max(0, options.minClearance!) : 0

  const dash = dashPattern
    && Number.isFinite(dashPattern.dashLength)
    && Number.isFinite(dashPattern.gapLength)
    && dashPattern.dashLength > ROAD_EPSILON
    && dashPattern.gapLength >= 0
    ? { dashLength: dashPattern.dashLength, gapLength: dashPattern.gapLength }
    : null
  const dashPeriod = dash ? dash.dashLength + dash.gapLength : 0

  if (!useSharedHeightSeries && heights && minHeights) {
    for (let i = 0; i <= divisions; i += 1) {
      const t = i / divisions
      center.copy(curve.getPointAt(t))

      tangent.copy(curve.getTangentAt(t))
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

      const sampledCenter = sampler!(offsetCenter.x, offsetCenter.z)
      const sampledLeft = sampler!(left.x, left.z)
      const sampledRight = sampler!(right.x, right.z)
      const centerY = Number.isFinite(sampledCenter) ? sampledCenter : 0
      const leftY = Number.isFinite(sampledLeft) ? sampledLeft : 0
      const rightY = Number.isFinite(sampledRight) ? sampledRight : 0
      const envelope = Math.max(centerY, leftY, rightY) + yOffset + extraClearance
      heights.push(envelope)
      minHeights.push(envelope)
    }

    const smoothed = smoothHeightSeries(heights, computeHeightSmoothingPasses(divisions, options.smoothingStrengthFactor), minHeights)
    heights.length = 0
    heights.push(...smoothed)
  }

  for (let i = 0; i <= divisions; i += 1) {
    const t = i / divisions
    center.copy(curve.getPointAt(t))
    tangent.copy(curve.getTangentAt(t))
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

    // Terrain conformance uses a smoothed height sampled along the curve centerline.
    // This keeps the road surface smooth and avoids jagged edges from per-vertex sampling.
    const y = heights
      ? (useSharedHeightSeries ? heights[i]! + yOffset : heights[i]!)
      : yOffset
    left.y = y
    right.y = y

    positions.push(left.x, left.y, left.z, right.x, right.y, right.z)
    uvs.push(t, 0, t, 1)

    if (i < divisions) {
      const base = i * 2
      if (!dash || dashPeriod <= ROAD_EPSILON) {
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
      } else {
        const startDistance = (i / divisions) * length
        const endDistance = ((i + 1) / divisions) * length
        const midDistance = (startDistance + endDistance) * 0.5
        const phase = ((midDistance % dashPeriod) + dashPeriod) % dashPeriod
        if (phase < dash.dashLength) {
          indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildRoadStripGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  width: number,
  heightSampler?: ((x: number, z: number) => number) | null,
  yOffset = 0,
  options: { samplingDensityFactor?: number; smoothingStrengthFactor?: number; minClearance?: number } = {},
  sharedHeightSeries?: number[] | null,
): THREE.BufferGeometry | null {
  return buildOffsetStripGeometry(curve, width, 0, heightSampler, yOffset, options, sharedHeightSeries)
}

function buildMultiCurveGeometry(
  curves: RoadCurveDescriptor[],
  builder: (curve: THREE.Curve<THREE.Vector3>, options?: any) => THREE.BufferGeometry | null,
  options?: any,
): THREE.BufferGeometry | null {
  const geometries: THREE.BufferGeometry[] = []
  for (const descriptor of curves) {
    const geometry = builder(descriptor.curve, options)
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
  heightSampler?: ((x: number, z: number) => number) | null,
  yOffset = 0,
  options: { samplingDensityFactor?: number; smoothingStrengthFactor?: number; minClearance?: number } = {},
  sharedHeightSeriesList?: Array<number[] | null>,
): THREE.BufferGeometry | null {
  let curveIndex = 0
  return buildMultiCurveGeometry(
    curves,
    (curve) => {
      const shared = Array.isArray(sharedHeightSeriesList) ? (sharedHeightSeriesList[curveIndex] ?? null) : null
      curveIndex += 1
      return buildOffsetStripGeometry(curve, width, offset, heightSampler, yOffset, options, shared)
    },
    options,
  )
}

function buildLaneLineGeometry(
  curves: RoadCurveDescriptor[],
  width: number,
  heightSampler?: ((x: number, z: number) => number) | null,
  yOffset = 0,
  options: { samplingDensityFactor?: number; smoothingStrengthFactor?: number; minClearance?: number } = {},
  sharedHeightSeriesList?: Array<number[] | null>,
): THREE.BufferGeometry | null {
  // Center lane line should follow the road surface profile exactly (like shoulders), but be dashed.
  let curveIndex = 0
  return buildMultiCurveGeometry(
    curves,
    (curve) => {
      const shared = Array.isArray(sharedHeightSeriesList) ? (sharedHeightSeriesList[curveIndex] ?? null) : null
      curveIndex += 1
      return buildOffsetStripGeometry(
        curve,
        width,
        0,
        heightSampler,
        yOffset,
        options,
        shared,
        { dashLength: ROAD_LANE_LINE_DASH_LENGTH, gapLength: ROAD_LANE_LINE_GAP_LENGTH },
      )
    },
    options,
  )
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

  const heightSampler = typeof options.heightSampler === 'function' ? options.heightSampler : null

  const samplingDensityFactor = options.samplingDensityFactor ?? 1.0
  const smoothingStrengthFactor = options.smoothingStrengthFactor ?? 1.0
  const minClearance = options.minClearance ?? 0
  const meshOptions = { samplingDensityFactor, smoothingStrengthFactor, minClearance }

  const sharedHeightSeriesList: Array<number[] | null> | null = heightSampler
    ? (() => {
        const extraClearance = Number.isFinite(minClearance) ? Math.max(0, minClearance) : 0

        const shoulderWidth = Number.isFinite(options.shoulderWidth) && options.shoulderWidth! > 0.01
          ? options.shoulderWidth!
          : ROAD_SHOULDER_WIDTH
        const shoulderOffset = width * 0.5 + ROAD_SHOULDER_GAP + shoulderWidth * 0.5

        const envelopeHalfWidth = options.shoulders
          ? Math.max(Math.max(ROAD_OVERLAY_MIN_WIDTH * 0.5, width * 0.5), shoulderOffset + shoulderWidth * 0.5)
          : Math.max(ROAD_OVERLAY_MIN_WIDTH * 0.5, width * 0.5)

        const point = new THREE.Vector3()
        const tangent = new THREE.Vector3()
        const lateral = new THREE.Vector3()
        const left = new THREE.Vector3()
        const right = new THREE.Vector3()

        return curves.map((descriptor) => {
          const curve = descriptor.curve
          const length = curve.getLength()
          if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
            return null
          }
          const divisions = computeRoadDivisions(length, samplingDensityFactor)

          const maxDeltaY = Math.max(
            ROAD_HEIGHT_SLOPE_MIN_DELTA_Y,
            (length / Math.max(1, divisions)) * ROAD_HEIGHT_SLOPE_MAX_GRADE,
          )

          const values: number[] = []
          const minimums: number[] = []
          for (let i = 0; i <= divisions; i += 1) {
            const t = i / divisions
            point.copy(curve.getPointAt(t))

            tangent.copy(curve.getTangentAt(t))
            tangent.y = 0
            if (tangent.lengthSq() <= ROAD_EPSILON) {
              tangent.set(0, 0, 1)
            } else {
              tangent.normalize()
            }
            lateral.set(-tangent.z, 0, tangent.x)

            left.copy(point).addScaledVector(lateral, envelopeHalfWidth)
            right.copy(point).addScaledVector(lateral, -envelopeHalfWidth)

            const sampledCenter = heightSampler(point.x, point.z)
            const sampledLeft = heightSampler(left.x, left.z)
            const sampledRight = heightSampler(right.x, right.z)
            const centerY = Number.isFinite(sampledCenter) ? sampledCenter : 0
            const leftY = Number.isFinite(sampledLeft) ? sampledLeft : 0
            const rightY = Number.isFinite(sampledRight) ? sampledRight : 0

            const envelope = Math.max(centerY, leftY, rightY) + ROAD_SURFACE_Y_OFFSET + extraClearance
            values.push(envelope)
            minimums.push(envelope)
          }

          const smoothed = smoothHeightSeries(
            values,
            computeHeightSmoothingPasses(divisions, smoothingStrengthFactor),
            minimums,
          )
          // Limit extreme per-segment slopes after smoothing to reduce visible kinks.
          return clampHeightSeriesSlope(smoothed, minimums, maxDeltaY)
        })
      })()
    : null

  const roadGeometry = buildMultiCurveGeometry(
    curves,
    (() => {
      let curveIndex = 0
      return (curve: THREE.Curve<THREE.Vector3>) => {
        const shared = sharedHeightSeriesList ? (sharedHeightSeriesList[curveIndex] ?? null) : null
        curveIndex += 1
        const yOffset = shared ? 0 : ROAD_SURFACE_Y_OFFSET
        return buildRoadStripGeometry(curve, width, heightSampler, yOffset, meshOptions, shared)
      }
    })(),
    meshOptions,
  )
  if (!roadGeometry) {
    return
  }

  const roadMesh = new THREE.Mesh(roadGeometry, createRoadMaterial())
  roadMesh.name = 'RoadMesh'
  roadMesh.castShadow = false
  roadMesh.receiveShadow = true
  group.add(roadMesh)

  if (options.shoulders) {
    const shoulderWidth = Number.isFinite(options.shoulderWidth) && options.shoulderWidth! > 0.01
      ? options.shoulderWidth!
      : ROAD_SHOULDER_WIDTH
    const shoulderOffset = width * 0.5 + ROAD_SHOULDER_GAP + shoulderWidth * 0.5
    const shoulderGeometries: THREE.BufferGeometry[] = []
    const shoulderYOffset = sharedHeightSeriesList
      ? ROAD_SHOULDER_OFFSET_Y
      : ROAD_SURFACE_Y_OFFSET + ROAD_SHOULDER_OFFSET_Y
    const leftShoulder = buildOverlayGeometry(
      curves,
      shoulderWidth,
      shoulderOffset,
      heightSampler,
      shoulderYOffset,
      meshOptions,
      sharedHeightSeriesList ?? undefined,
    )
    if (leftShoulder) {
      shoulderGeometries.push(leftShoulder)
    }
    const rightShoulder = buildOverlayGeometry(
      curves,
      shoulderWidth,
      -shoulderOffset,
      heightSampler,
      shoulderYOffset,
      meshOptions,
      sharedHeightSeriesList ?? undefined,
    )
    if (rightShoulder) {
      shoulderGeometries.push(rightShoulder)
    }
    if (shoulderGeometries.length) {
      const mergedShoulder = mergeGeometries(shoulderGeometries, false)
      shoulderGeometries.forEach((geometry) => geometry.dispose())
      if (mergedShoulder) {
        const shoulderMesh = new THREE.Mesh(mergedShoulder, createShoulderMaterial())
        shoulderMesh.name = 'RoadShoulders'
        shoulderMesh.userData.overrideMaterial = true
        group.add(shoulderMesh)
      }
    }
  }

  if (options.laneLines) {
    const laneLineWidth = Number.isFinite(options.laneLineWidth) && options.laneLineWidth! > 0.01
      ? options.laneLineWidth!
      : Math.max(
          ROAD_OVERLAY_MIN_WIDTH * 3,
          Math.min(ROAD_LANE_LINE_WIDTH, width * 0.12 + ROAD_OVERLAY_MIN_WIDTH),
        )
    const laneGeometry = buildLaneLineGeometry(
      curves,
      laneLineWidth,
      heightSampler,
      sharedHeightSeriesList ? ROAD_LANE_LINE_OFFSET_Y : ROAD_SURFACE_Y_OFFSET + ROAD_LANE_LINE_OFFSET_Y,
      meshOptions,
      sharedHeightSeriesList ?? undefined,
    )
    if (laneGeometry) {
      const laneMesh = new THREE.Mesh(laneGeometry, createLaneLineMaterial())
      laneMesh.name = 'RoadLaneLines'
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
