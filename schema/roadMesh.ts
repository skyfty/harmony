import * as THREE from 'three'
import type { GroundDynamicMesh, RoadDynamicMesh, SceneNode } from '@harmony/schema'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import polygonClipping from 'polygon-clipping'
import type {
  Pair as PolygonClippingPair,
  Ring as PolygonClippingRing,
  Polygon as PolygonClippingPolygon,
  MultiPolygon as PolygonClippingMultiPolygon,
} from 'polygon-clipping'
import { MATERIAL_CONFIG_ID_KEY } from './material'
import { sampleGroundHeight } from './groundMesh'
import { buildRoadCornerBezierCurvePath } from './roadCurvePath'
import { buildRoadGraph, getJunctionIncidentDirectionsXZ } from './roadGraph'
import { buildJunctionLoopXZ, triangulateJunctionPatchXZ } from './roadJunctionPatch'

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

const ROAD_CORNER_MIN_SEGMENTS_BASE = 12
const ROAD_CORNER_MIN_SEGMENTS_EXTRA = 12

const ROAD_OFFSET_MITER_LIMIT = 4

const ROAD_POLYGON_QUANTIZE_EPS = 1e-4

function polygonArea2XZ(points: THREE.Vector2[]): number {
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    area += a.x * b.y - b.x * a.y
  }
  return area * 0.5
}

function ensureWindingXZ(points: THREE.Vector2[], ccw: boolean): THREE.Vector2[] {
  if (points.length < 3) {
    return points
  }
  const area = polygonArea2XZ(points)
  const isCcw = area > 0
  if (isCcw === ccw) {
    return points
  }
  return points.slice().reverse()
}

function quantizeXZKey(x: number, z: number): string {
  const ix = Math.round(x / ROAD_POLYGON_QUANTIZE_EPS)
  const iz = Math.round(z / ROAD_POLYGON_QUANTIZE_EPS)
  return `${ix},${iz}`
}

function cleanLoopXZ(points: THREE.Vector2[], eps = ROAD_EPSILON): THREE.Vector2[] {
  if (points.length < 3) {
    return points
  }
  const cleaned: THREE.Vector2[] = []
  const eps2 = eps * eps
  for (const p of points) {
    const last = cleaned.length ? cleaned[cleaned.length - 1]! : null
    if (!last || last.distanceToSquared(p) > eps2) {
      cleaned.push(p)
    }
  }
  if (cleaned.length >= 3 && cleaned[0]!.distanceToSquared(cleaned[cleaned.length - 1]!) <= eps2) {
    cleaned.pop()
  }
  return cleaned
}

function vector2LoopToPolygonClippingRing(points: THREE.Vector2[]): PolygonClippingRing {
  const cleaned = cleanLoopXZ(points, ROAD_EPSILON)
  if (cleaned.length < 3) {
    return []
  }
  const ring: PolygonClippingRing = cleaned.map((p): PolygonClippingPair => [p.x, p.y])
  // polygon-clipping expects closed rings (first point repeated at end).
  const first = ring[0]!
  const last = ring[ring.length - 1]!
  const fx = first[0]
  const fz = first[1]
  const lx = last[0]
  const lz = last[1]
  if (Math.abs(fx - lx) > ROAD_EPSILON || Math.abs(fz - lz) > ROAD_EPSILON) {
    ring.push([fx, fz])
  }
  return ring
}

function polygonClippingRingToVector2Loop(ring: PolygonClippingRing): THREE.Vector2[] {
  if (!Array.isArray(ring) || ring.length < 4) {
    return []
  }
  const points: THREE.Vector2[] = []
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]
    if (!Array.isArray(p) || p.length < 2) {
      continue
    }
    const x = Number(p[0])
    const z = Number(p[1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    points.push(new THREE.Vector2(x, z))
  }
  // Drop the closing point for ShapeUtils.
  if (points.length >= 2 && points[0]!.distanceToSquared(points[points.length - 1]!) <= ROAD_EPSILON * ROAD_EPSILON) {
    points.pop()
  }
  return cleanLoopXZ(points, ROAD_EPSILON)
}

function computePlanarUvBoundsFromRings(polygons: PolygonClippingMultiPolygon): { minX: number; minZ: number; spanX: number; spanZ: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const poly of polygons) {
    for (const ring of poly) {
      for (const p of ring) {
        if (!Array.isArray(p) || p.length < 2) {
          continue
        }
        const x = Number(p[0])
        const z = Number(p[1])
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          continue
        }
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
    }
  }

  const spanX = Number.isFinite(maxX - minX) && Math.abs(maxX - minX) > ROAD_EPSILON ? (maxX - minX) : 1
  const spanZ = Number.isFinite(maxZ - minZ) && Math.abs(maxZ - minZ) > ROAD_EPSILON ? (maxZ - minZ) : 1
  return { minX, minZ, spanX, spanZ }
}

function buildOffsetRingXZForCurve(params: {
  curve: THREE.Curve<THREE.Vector3>
  divisions: number
  signedDistance: number
  sharedCenterHeights?: number[] | null
  heightSampler?: ((x: number, z: number) => number) | null
  yBaseOffset: number
  extraClearance: number
  yAdditionalOffset: number
  yMap: Map<string, number>
}): THREE.Vector2[] {
  const {
    curve,
    divisions,
    signedDistance,
    sharedCenterHeights,
    heightSampler,
    yBaseOffset,
    extraClearance,
    yAdditionalOffset,
    yMap,
  } = params

  const sampleCenters: THREE.Vector3[] = new Array(divisions + 1)
  const center = new THREE.Vector3()
  for (let i = 0; i <= divisions; i += 1) {
    curve.getPoint(i / divisions, center)
    sampleCenters[i] = center.clone()
  }

  const left = new THREE.Vector3()
  const right = new THREE.Vector3()
  const leftPoints: THREE.Vector2[] = new Array(divisions + 1)
  const rightPoints: THREE.Vector2[] = new Array(divisions + 1)

  for (let i = 0; i <= divisions; i += 1) {
    const prev = i > 0 ? sampleCenters[i - 1]! : null
    const cur = sampleCenters[i]!
    const next = i < divisions ? sampleCenters[i + 1]! : null

    computeOffsetPointMiterLimited(prev, cur, next, Math.abs(signedDistance), left)
    computeOffsetPointMiterLimited(prev, cur, next, -Math.abs(signedDistance), right)

    leftPoints[i] = new THREE.Vector2(left.x, left.z)
    rightPoints[i] = new THREE.Vector2(right.x, right.z)

    // Populate an XZ->Y lookup for boundary points so the shoulder triangulation can match
    // the road profile along shared edges (reduces cracks / z-fighting along the boundary).
    let y: number
    if (Array.isArray(sharedCenterHeights) && sharedCenterHeights.length === divisions + 1) {
      y = sharedCenterHeights[i]! + yAdditionalOffset
    } else if (typeof heightSampler === 'function') {
      const sampled = heightSampler(cur.x, cur.z)
      y = (Number.isFinite(sampled) ? sampled : 0) + yBaseOffset + extraClearance + yAdditionalOffset
    } else {
      y = yBaseOffset + yAdditionalOffset
    }

    yMap.set(quantizeXZKey(left.x, left.z), y)
    yMap.set(quantizeXZKey(right.x, right.z), y)
  }

  const ring = [...leftPoints, ...rightPoints.slice().reverse()]
  return ensureWindingXZ(cleanLoopXZ(ring, ROAD_EPSILON), true)
}

function triangulatePolygonClippingMultiPolygonXZ(params: {
  polygons: PolygonClippingMultiPolygon
  heightSampler?: ((x: number, z: number) => number) | null
  yBaseOffset: number
  extraClearance: number
  yAdditionalOffset: number
  yMap: Map<string, number>
}): THREE.BufferGeometry | null {
  const polygons = params.polygons
  if (!Array.isArray(polygons) || !polygons.length) {
    return null
  }

  const sampler = typeof params.heightSampler === 'function' ? params.heightSampler : null
  const { minX, minZ, spanX, spanZ } = computePlanarUvBoundsFromRings(polygons)

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vertexBase = 0

  for (const poly of polygons) {
    if (!Array.isArray(poly) || !poly.length) {
      continue
    }

    const contour = polygonClippingRingToVector2Loop(poly[0] as PolygonClippingRing)
    if (contour.length < 3) {
      continue
    }

    const holes: THREE.Vector2[][] = []
    for (let i = 1; i < poly.length; i += 1) {
      const hole = polygonClippingRingToVector2Loop(poly[i] as PolygonClippingRing)
      if (hole.length >= 3) {
        holes.push(hole)
      }
    }

    const ccwContour = ensureWindingXZ(contour, true)
    const woundHoles = holes.map((h) => ensureWindingXZ(h, false))
    const faces = THREE.ShapeUtils.triangulateShape(ccwContour, woundHoles)
    if (!faces.length) {
      continue
    }

    const points2: THREE.Vector2[] = [...ccwContour]
    for (const hole of woundHoles) {
      points2.push(...hole)
    }

    for (const p of points2) {
      const key = quantizeXZKey(p.x, p.y)
      const mapped = params.yMap.get(key)
      const sampled = sampler ? sampler(p.x, p.y) : 0
      const base = sampler ? ((Number.isFinite(sampled) ? sampled : 0) + params.yBaseOffset + params.extraClearance) : params.yBaseOffset
      const y = (typeof mapped === 'number' && Number.isFinite(mapped)) ? mapped : base + params.yAdditionalOffset

      positions.push(p.x, y, p.y)
      uvs.push((p.x - minX) / spanX, (p.y - minZ) / spanZ)
    }

    for (const f of faces) {
      indices.push(vertexBase + f[0]!, vertexBase + f[1]!, vertexBase + f[2]!)
    }
    vertexBase += points2.length
  }

  if (!indices.length || positions.length < 9) {
    return null
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
  const densityFactor = Math.max(0.1, Math.min(10, Number.isFinite(samplingDensityFactor) ? samplingDensityFactor : 1.0))
  return Math.max(
    ROAD_MIN_DIVISIONS,
    Math.min(ROAD_MAX_DIVISIONS, Math.ceil(length * ROAD_DIVISION_DENSITY * densityFactor)),
  )
}

function computeCornerMinSegments(junctionSmoothing = 0): number {
  const smoothing = normalizeJunctionSmoothing(junctionSmoothing)
  const suggested = Math.round(ROAD_CORNER_MIN_SEGMENTS_BASE + ROAD_CORNER_MIN_SEGMENTS_EXTRA * smoothing)
  return Math.max(6, Math.min(48, suggested))
}

function computeRoadDivisionsForCurve(
  curve: THREE.Curve<THREE.Vector3>,
  length: number,
  samplingDensityFactor = 1.0,
  junctionSmoothing = 0,
): number {
  let divisions = computeRoadDivisions(length, samplingDensityFactor)

  const curves = (curve as any)?.curves
  if (!Array.isArray(curves) || !curves.length) {
    return divisions
  }

  const cornerMinSegments = computeCornerMinSegments(junctionSmoothing)
  if (cornerMinSegments <= 0) {
    return divisions
  }

  for (const segment of curves as Array<THREE.Curve<THREE.Vector3>>) {
    const isQuadratic = Boolean((segment as any)?.isQuadraticBezierCurve3)
    if (!isQuadratic) {
      continue
    }
    const cornerLength = segment.getLength()
    if (!Number.isFinite(cornerLength) || cornerLength <= ROAD_EPSILON) {
      continue
    }
    // Ensure each corner curve receives a minimum number of samples by inflating
    // the total divisions only when the curve contains quadratic (corner) segments.
    const requiredTotal = Math.ceil((cornerMinSegments * length) / cornerLength)
    if (Number.isFinite(requiredTotal)) {
      divisions = Math.max(divisions, requiredTotal)
    }
  }

  return Math.max(ROAD_MIN_DIVISIONS, Math.min(ROAD_MAX_DIVISIONS, divisions))
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

function computeOffsetPointMiterLimited(
  prev: THREE.Vector3 | null,
  cur: THREE.Vector3,
  next: THREE.Vector3 | null,
  signedDistance: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  // Offsets a polyline vertex in XZ using a miter join with a miter limit.
  // This prevents huge spikes on very small angles (which can cause self-intersection / “fold loops”).
  const d = Number.isFinite(signedDistance) ? signedDistance : 0
  if (Math.abs(d) <= ROAD_EPSILON) {
    return out.copy(cur)
  }

  const dir0 = new THREE.Vector3()
  const dir1 = new THREE.Vector3()

  if (prev) {
    dir0.subVectors(cur, prev)
  }
  if (next) {
    dir1.subVectors(next, cur)
  }

  if (dir0.lengthSq() <= ROAD_EPSILON) {
    dir0.copy(dir1)
  }
  if (dir1.lengthSq() <= ROAD_EPSILON) {
    dir1.copy(dir0)
  }
  dir0.y = 0
  dir1.y = 0

  if (dir0.lengthSq() <= ROAD_EPSILON) {
    // Degenerate; fall back to an arbitrary normal.
    return out.set(cur.x - d, cur.y, cur.z)
  }

  dir0.normalize()
  dir1.normalize()

  // Perpendiculars in XZ.
  const n0 = new THREE.Vector3(-dir0.z, 0, dir0.x)
  const n1 = new THREE.Vector3(-dir1.z, 0, dir1.x)

  const miter = new THREE.Vector3().addVectors(n0, n1)
  if (miter.lengthSq() <= ROAD_EPSILON) {
    // 180° turn or near-collinear: just use the incoming normal.
    return out.copy(cur).addScaledVector(n0, d)
  }
  miter.normalize()

  const denom = miter.dot(n1)
  if (Math.abs(denom) <= 1e-3) {
    return out.copy(cur).addScaledVector(n1, d)
  }

  let miterLen = d / denom
  const limit = Math.max(1, ROAD_OFFSET_MITER_LIMIT) * Math.abs(d)
  if (Math.abs(miterLen) > limit) {
    miterLen = Math.sign(miterLen) * limit
  }

  return out.copy(cur).addScaledVector(miter, miterLen)
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

function createRoadCurve(points: THREE.Vector3[], closed: boolean, junctionSmoothing: number): THREE.Curve<THREE.Vector3> {
  // The road centerline uses straight (linear) segments for the main body,
  // with quadratic Bezier smoothing applied only at corners.
  // Points must NOT repeat the first point for closed curves; closure is expressed via `closed=true`.
  return buildRoadCornerBezierCurvePath(points, closed, junctionSmoothing)
}

function buildRoadCurves(smoothing: number, buildData: RoadBuildData): RoadCurveDescriptor[] {
  const curves: RoadCurveDescriptor[] = []
  for (const path of buildData.paths) {
    const points = path.indices
      .map((vertexIndex) => buildData.vertexVectors[vertexIndex])
      .filter((point): point is THREE.Vector3 => Boolean(point))
    if (points.length < 2) {
      continue
    }
    const curve = createRoadCurve(points, path.closed && points.length >= 3, smoothing)
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
  options: {
    samplingDensityFactor?: number
    smoothingStrengthFactor?: number
    minClearance?: number
    junctionSmoothing?: number
    segmentMask?: ((center: THREE.Vector3) => boolean) | null
  } = {},
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
    : computeRoadDivisionsForCurve(curve, length, options.samplingDensityFactor, options.junctionSmoothing)

  const halfWidth = Math.max(ROAD_OVERLAY_MIN_WIDTH * 0.5, width * 0.5)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const center = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const lateral = new THREE.Vector3()
  const left = new THREE.Vector3()
  const right = new THREE.Vector3()
  const leftEdge = new THREE.Vector3()
  const rightEdge = new THREE.Vector3()

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

  const segmentMask = typeof options.segmentMask === 'function' ? options.segmentMask : null

  const sampleCenters: THREE.Vector3[] = new Array(divisions + 1)
  for (let i = 0; i <= divisions; i += 1) {
    const t = i / divisions
    curve.getPoint(t, center)
    sampleCenters[i] = center.clone()
  }

  if (!useSharedHeightSeries && heights && minHeights) {
    for (let i = 0; i <= divisions; i += 1) {
      const prev = i > 0 ? sampleCenters[i - 1]! : null
      const next = i < divisions ? sampleCenters[i + 1]! : null
      center.copy(sampleCenters[i]!)

      // Distances are signed (positive = left of travel direction).
      computeOffsetPointMiterLimited(prev, center, next, offset + halfWidth, left,)
      computeOffsetPointMiterLimited(prev, center, next, offset - halfWidth, right,)

      // Sample an envelope across the strip width to avoid terrain poking through.
      const sampledCenter = sampler!(center.x, center.z)
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
    const prev = i > 0 ? sampleCenters[i - 1]! : null
    const next = i < divisions ? sampleCenters[i + 1]! : null
    center.copy(sampleCenters[i]!)

    // Build the strip boundaries using a miter-limited polyline offset.
    computeOffsetPointMiterLimited(prev, center, next, offset + halfWidth, leftEdge)
    computeOffsetPointMiterLimited(prev, center, next, offset - halfWidth, rightEdge)

    // Terrain conformance uses a smoothed height sampled along the curve centerline.
    // This keeps the road surface smooth and avoids jagged edges from per-vertex sampling.
    const y = heights
      ? (useSharedHeightSeries ? heights[i]! + yOffset : heights[i]!)
      : yOffset
    leftEdge.y = y
    rightEdge.y = y

    positions.push(leftEdge.x, leftEdge.y, leftEdge.z, rightEdge.x, rightEdge.y, rightEdge.z)
    uvs.push(t, 0, t, 1)

    if (i < divisions) {
      const base = i * 2
      const allowed = segmentMask ? segmentMask(sampleCenters[i]!) : true
      if (allowed) {
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
  options: {
    samplingDensityFactor?: number
    smoothingStrengthFactor?: number
    minClearance?: number
    junctionSmoothing?: number
  } = {},
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
  options: {
    samplingDensityFactor?: number
    smoothingStrengthFactor?: number
    minClearance?: number
    junctionSmoothing?: number
    segmentMask?: ((center: THREE.Vector3) => boolean) | null
  } = {},
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
  const meshOptions = { samplingDensityFactor, smoothingStrengthFactor, minClearance, junctionSmoothing: smoothing }

  const graph = buildRoadGraph(definition)
  const junctionPolygons: THREE.Vector2[][] = []
  const junctionSurfaceLoops: THREE.Vector2[][] = []
  const junctionOuterLoops: THREE.Vector2[][] = []
  const junctionSurfaceGeometries: THREE.BufferGeometry[] = []
  if (graph && graph.junctionVertices.length) {
    const shoulderWidth = Number.isFinite(options.shoulderWidth) && options.shoulderWidth! > 0.01
      ? options.shoulderWidth!
      : ROAD_SHOULDER_WIDTH
    const roadRadius = Math.max(ROAD_OVERLAY_MIN_WIDTH * 0.5, width * 0.5)
    const outerRadius = width * 0.5 + shoulderWidth
    const roundSegments = 8 + Math.round(24 * smoothing)

    for (const junctionVertex of graph.junctionVertices) {
      const center = graph.vertices[junctionVertex]
      if (!center) {
        continue
      }
      const dirs = getJunctionIncidentDirectionsXZ(graph, junctionVertex)
      if (dirs.length < 3) {
        continue
      }

      const surfaceLoop = buildJunctionLoopXZ({
        center,
        incidentDirsXZ: dirs,
        radius: roadRadius,
        roundSegments,
      })
      if (surfaceLoop.length >= 3) {
        junctionSurfaceLoops.push(surfaceLoop)
        junctionPolygons.push(surfaceLoop)
        const surface = triangulateJunctionPatchXZ({
          contour: surfaceLoop,
          heightSampler,
          yOffset: ROAD_SURFACE_Y_OFFSET,
          minClearance,
        })
        if (surface) {
          junctionSurfaceGeometries.push(surface)
        }
      }

      if (options.shoulders) {
        const outerLoop = buildJunctionLoopXZ({
          center,
          incidentDirsXZ: dirs,
          radius: outerRadius,
          roundSegments,
        })
        if (outerLoop.length >= 3) {
          junctionOuterLoops.push(outerLoop)
        }
      }
    }
  }

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
          const divisions = computeRoadDivisionsForCurve(curve, length, samplingDensityFactor, smoothing)

          const maxDeltaY = Math.max(
            ROAD_HEIGHT_SLOPE_MIN_DELTA_Y,
            (length / Math.max(1, divisions)) * ROAD_HEIGHT_SLOPE_MAX_GRADE,
          )

          const values: number[] = []
          const minimums: number[] = []
          for (let i = 0; i <= divisions; i += 1) {
            const t = i / divisions
            curve.getPoint(t, point)
            curve.getTangent(t, tangent)
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

  let roadGeometry = buildMultiCurveGeometry(
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

  if (junctionSurfaceGeometries.length) {
    const merged = mergeGeometries([roadGeometry, ...junctionSurfaceGeometries], false)
    junctionSurfaceGeometries.forEach((g) => g.dispose())
    if (merged) {
      roadGeometry.dispose()
      roadGeometry = merged
    }
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
    const outerDistance = width * 0.5 + shoulderWidth
    const surfaceDistance = Math.max(ROAD_OVERLAY_MIN_WIDTH * 0.5, width * 0.5)
    const extraClearance = Number.isFinite(minClearance) ? Math.max(0, minClearance) : 0
    const yBaseOffset = ROAD_SURFACE_Y_OFFSET
    const yAdditionalOffset = sharedHeightSeriesList
      ? ROAD_SHOULDER_OFFSET_Y
      : ROAD_SHOULDER_OFFSET_Y

    const yMap = new Map<string, number>()

    const surfacePolys: PolygonClippingPolygon[] = []
    const outerPolys: PolygonClippingPolygon[] = []

    for (let curveIndex = 0; curveIndex < curves.length; curveIndex += 1) {
      const curve = curves[curveIndex]!.curve
      const length = curve.getLength()
      if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
        continue
      }

      const shared = sharedHeightSeriesList ? (sharedHeightSeriesList[curveIndex] ?? null) : null
      const divisions = Array.isArray(shared) && shared.length >= 2
        ? shared.length - 1
        : computeRoadDivisionsForCurve(curve, length, samplingDensityFactor, smoothing)

      const surfaceLoop = buildOffsetRingXZForCurve({
        curve,
        divisions,
        signedDistance: surfaceDistance,
        sharedCenterHeights: shared,
        heightSampler,
        yBaseOffset,
        extraClearance,
        yAdditionalOffset,
        yMap,
      })
      const outerLoop = buildOffsetRingXZForCurve({
        curve,
        divisions,
        signedDistance: outerDistance,
        sharedCenterHeights: shared,
        heightSampler,
        yBaseOffset,
        extraClearance,
        yAdditionalOffset,
        yMap,
      })

      const surfaceRing = vector2LoopToPolygonClippingRing(surfaceLoop)
      if (surfaceRing.length >= 4) {
        surfacePolys.push([surfaceRing])
      }

      const outerRing = vector2LoopToPolygonClippingRing(outerLoop)
      if (outerRing.length >= 4) {
        outerPolys.push([outerRing])
      }
    }

    // Include junction loops so the boolean result follows the intended junction rounding.
    for (const loop of junctionSurfaceLoops) {
      const ring = vector2LoopToPolygonClippingRing(loop)
      if (ring.length >= 4) {
        surfacePolys.push([ring])
      }
      // Populate yMap for junction boundary vertices.
      if (heightSampler) {
        for (const p of loop) {
          const sampled = heightSampler(p.x, p.y)
          const y = (Number.isFinite(sampled) ? sampled : 0) + yBaseOffset + extraClearance + yAdditionalOffset
          yMap.set(quantizeXZKey(p.x, p.y), y)
        }
      }
    }
    for (const loop of junctionOuterLoops) {
      const ring = vector2LoopToPolygonClippingRing(loop)
      if (ring.length >= 4) {
        outerPolys.push([ring])
      }
      if (heightSampler) {
        for (const p of loop) {
          const sampled = heightSampler(p.x, p.y)
          const y = (Number.isFinite(sampled) ? sampled : 0) + yBaseOffset + extraClearance + yAdditionalOffset
          yMap.set(quantizeXZKey(p.x, p.y), y)
        }
      }
    }

    try {
      const outerUnion = (() => {
        if (!outerPolys.length) {
          return [] as PolygonClippingMultiPolygon
        }
        const [first, ...rest] = outerPolys
        return polygonClipping.union(first!, ...rest) as unknown as PolygonClippingMultiPolygon
      })()
      const surfaceUnion = (() => {
        if (!surfacePolys.length) {
          return [] as PolygonClippingMultiPolygon
        }
        const [first, ...rest] = surfacePolys
        return polygonClipping.union(first!, ...rest) as unknown as PolygonClippingMultiPolygon
      })()
      const shouldersPolys = outerUnion.length
        ? (surfaceUnion.length
            ? (polygonClipping.difference(outerUnion, surfaceUnion) as unknown as PolygonClippingMultiPolygon)
            : outerUnion)
        : []

      const shoulderGeometry = triangulatePolygonClippingMultiPolygonXZ({
        polygons: shouldersPolys,
        heightSampler,
        yBaseOffset,
        extraClearance,
        yAdditionalOffset,
        yMap,
      })

      if (shoulderGeometry) {
        const shoulderMesh = new THREE.Mesh(shoulderGeometry, createShoulderMaterial())
        shoulderMesh.name = 'RoadShoulders'
        shoulderMesh.userData.overrideMaterial = true
        group.add(shoulderMesh)
      }
    } catch {
      // If polygon boolean fails, skip shoulders to avoid crashing the scene.
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
      {
        ...meshOptions,
        segmentMask: junctionPolygons.length
          ? (centerPoint: THREE.Vector3) => {
              const x = centerPoint.x
              const z = centerPoint.z
              for (const poly of junctionPolygons) {
                let inside = false
                for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
                  const a = poly[i]!
                  const b = poly[j]!
                  const intersect = ((a.y > z) !== (b.y > z))
                    && (x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y + 1e-12) + a.x)
                  if (intersect) {
                    inside = !inside
                  }
                }
                if (inside) {
                  return false
                }
              }
              return true
            }
          : null,
      },
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
