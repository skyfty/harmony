import { Object3D, Shape, ShapeGeometry, Vector2, Vector3 } from 'three'
import type { GroundDynamicMesh, LandformDynamicMesh, SceneNode, Vector3Like, Vector2Like } from '@schema'
import { sampleGroundHeight } from '@schema/groundMesh'
import {
  clampLandformComponentProps,
  LANDFORM_DEFAULT_ENABLE_FEATHER,
  LANDFORM_DEFAULT_FEATHER,
  LANDFORM_DEFAULT_UV_SCALE,
  type LandformComponentProps,
} from '@schema/components'
import type { SceneMaterialProps, SceneNodeMaterial } from '@/types/material'

export type SceneStoreLandformHelpersDeps = {
  createLandformNodeMaterials: (options: { surfaceName: string }) => SceneNodeMaterial[]
  createNodeMaterial: (
    materialId: string | null,
    props: SceneMaterialProps,
    options: { id?: string; name?: string; type?: any },
  ) => SceneNodeMaterial
  getRuntimeObject: (id: string) => Object3D | null
  updateLandformGroup: (runtime: Object3D, mesh: LandformDynamicMesh) => void
}

const LANDFORM_TARGET_TRI_EDGE_LENGTH = 0.5
const LANDFORM_MAX_CELL_SUBDIVISIONS = 4
const LANDFORM_MAX_REFINEMENT_STEPS = 8
const LANDFORM_HEIGHT_ERROR_TOLERANCE = 0.01
const LANDFORM_MAX_TRIANGLE_SAMPLE_DIVISIONS = 5
const LANDFORM_INTERIOR_MAX_TRIANGLE_SAMPLE_DIVISIONS = 3
const LANDFORM_INTERIOR_EDGE_LENGTH_SCALE = 2.25
const LANDFORM_INTERIOR_HEIGHT_ERROR_TOLERANCE_SCALE = 1.5
const LANDFORM_COMPACT_EDGE_LENGTH_SCALE = 1.8
const LANDFORM_COMPACT_INTERIOR_EDGE_LENGTH_SCALE = 1.35
const LANDFORM_COMPACT_HEIGHT_ERROR_TOLERANCE_SCALE = 1.75
const LANDFORM_COMPACT_MAX_SAMPLE_DIVISIONS = 3
const LANDFORM_COMPACT_BOUNDARY_SIMPLIFY_SCALE = 0.45
const LANDFORM_COMPACT_BOUNDARY_MIN_EDGE_SCALE = 0.65
const LANDFORM_SUPPORT_RING_MIN_WIDTH = 0.2
const LANDFORM_SUPPORT_RING_MAX_WIDTH = 1.5
const LANDFORM_SUPPORT_RING_WIDTH_SCALE = 0.35
const LANDFORM_SUPPORT_RING_EDGE_LENGTH_SCALE = 1.5

type GroundTransform = {
  position: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
}

type LandformFeatherRefinementOptions = {
  footprint: Array<[number, number]>
  featherWidth: number
  supportRingWidth?: number
  protectedDistance?: number
  segmentIndex?: FootprintSegmentIndex | null
  distanceCache?: Map<string, number>
}

function buildWorldPoints(points: Vector3Like[]): Vector3[] {
  const out: Vector3[] = []
  points.forEach((point) => {
    if (!point) {
      return
    }
    const x = Number(point.x)
    const y = Number(point.y)
    const z = Number(point.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return
    }
    const next = new Vector3(x, Number.isFinite(y) ? y : 0, z)
    const previous = out[out.length - 1]
    if (previous && previous.distanceToSquared(next) <= 1e-10) {
      return
    }
    out.push(next)
  })
  if (out.length >= 3) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.abs(first.x - last.x) <= 1e-10 && Math.abs(first.z - last.z) <= 1e-10) {
      out.pop()
    }
  }
  return out
}

function computeCenter(points: Vector3[]): Vector3 {
  const min = new Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY)
  const max = new Vector3(Number.NEGATIVE_INFINITY, 0, Number.NEGATIVE_INFINITY)
  points.forEach((point) => {
    min.x = Math.min(min.x, point.x)
    min.z = Math.min(min.z, point.z)
    max.x = Math.max(max.x, point.x)
    max.z = Math.max(max.z, point.z)
  })
  const baseY = points[0] && Number.isFinite(points[0].y) ? points[0].y : 0
  return new Vector3((min.x + max.x) * 0.5, baseY, (min.z + max.z) * 0.5)
}

function createNodeTransformObject(node: SceneNode): Object3D {
  const object = new Object3D()
  object.position.set(
    Number.isFinite(node.position?.x) ? Number(node.position.x) : 0,
    Number.isFinite(node.position?.y) ? Number(node.position.y) : 0,
    Number.isFinite(node.position?.z) ? Number(node.position.z) : 0,
  )
  object.rotation.set(
    Number.isFinite(node.rotation?.x) ? Number(node.rotation.x) : 0,
    Number.isFinite(node.rotation?.y) ? Number(node.rotation.y) : 0,
    Number.isFinite(node.rotation?.z) ? Number(node.rotation.z) : 0,
  )
  object.scale.set(
    Number.isFinite(node.scale?.x) && Math.abs(Number(node.scale.x)) > 1e-6 ? Number(node.scale.x) : 1,
    Number.isFinite(node.scale?.y) && Math.abs(Number(node.scale.y)) > 1e-6 ? Number(node.scale.y) : 1,
    Number.isFinite(node.scale?.z) && Math.abs(Number(node.scale.z)) > 1e-6 ? Number(node.scale.z) : 1,
  )
  object.updateMatrixWorld(true)
  return object
}

function resolveLandformFrameObject(node: SceneNode, runtimeObject?: Object3D | null): Object3D {
  if (runtimeObject) {
    runtimeObject.updateMatrixWorld(true)
    return runtimeObject
  }
  return createNodeTransformObject(node)
}

function getGroundTransform(groundNode: SceneNode | null): GroundTransform {
  const position = groundNode?.position ?? { x: 0, y: 0, z: 0 }
  const scaleLike = groundNode?.scale ?? { x: 1, y: 1, z: 1 }
  return {
    position: {
      x: Number.isFinite(position.x) ? position.x : 0,
      y: Number.isFinite(position.y) ? position.y : 0,
      z: Number.isFinite(position.z) ? position.z : 0,
    },
    scale: {
      x: Number.isFinite(scaleLike.x) && Math.abs(scaleLike.x) > 1e-6 ? scaleLike.x : 1,
      y: Number.isFinite(scaleLike.y) && Math.abs(scaleLike.y) > 1e-6 ? scaleLike.y : 1,
      z: Number.isFinite(scaleLike.z) && Math.abs(scaleLike.z) > 1e-6 ? scaleLike.z : 1,
    },
  }
}

function worldToGroundLocal(point: Vector3, transform: GroundTransform): Vector3 {
  return new Vector3(
    (point.x - transform.position.x) / transform.scale.x,
    (point.y - transform.position.y) / transform.scale.y,
    (point.z - transform.position.z) / transform.scale.z,
  )
}

function groundLocalToWorld(point: Vector3, transform: GroundTransform): Vector3 {
  return new Vector3(
    transform.position.x + point.x * transform.scale.x,
    transform.position.y + point.y * transform.scale.y,
    transform.position.z + point.z * transform.scale.z,
  )
}

function resolveGroundLocalDistance(distance: number, transform: GroundTransform): number {
  if (!Number.isFinite(distance) || distance <= 1e-6) {
    return 0
  }
  const scaleCandidates = [Math.abs(transform.scale.x), Math.abs(transform.scale.z)]
    .filter((value) => Number.isFinite(value) && value > 1e-6)
  const minScale = scaleCandidates.length ? Math.min(...scaleCandidates) : 1
  return distance / minScale
}

function computeSignedAreaXZ(points: Vector3[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current.x * next.z - next.x * current.z
  }
  return area * 0.5
}

function normalizePolygonWinding(points: Vector3[]): Vector3[] {
  if (points.length < 3) {
    return points
  }
  const area = computeSignedAreaXZ(points)
  if (Number.isFinite(area) && area < 0) {
    return [...points].reverse()
  }
  return points
}

function pointToSegmentDistanceXZ(point: Vector3, start: Vector3, end: Vector3): number {
  return pointToSegmentDistance2D(point.x, point.z, start.x, start.z, end.x, end.z)
}

function simplifyClosedPolygonXZ(points: Vector3[], tolerance: number, minEdgeLength: number): Vector3[] {
  if (points.length < 4) {
    return points.map((point) => point.clone())
  }

  const normalizedTolerance = Number.isFinite(tolerance) ? Math.max(1e-4, tolerance) : 1e-4
  const normalizedMinEdgeLength = Number.isFinite(minEdgeLength) ? Math.max(normalizedTolerance, minEdgeLength) : normalizedTolerance
  const simplified = points.map((point) => point.clone())

  let changed = true
  while (changed && simplified.length > 3) {
    changed = false

    for (let index = 0; index < simplified.length; index += 1) {
      if (simplified.length <= 3) {
        break
      }
      const previousIndex = (index + simplified.length - 1) % simplified.length
      const nextIndex = (index + 1) % simplified.length
      const previous = simplified[previousIndex]!
      const current = simplified[index]!
      const next = simplified[nextIndex]!
      const prevDistance = previous.distanceTo(current)
      const nextDistance = current.distanceTo(next)
      const boundaryDistance = pointToSegmentDistanceXZ(current, previous, next)

      if (
        prevDistance <= normalizedMinEdgeLength
        || nextDistance <= normalizedMinEdgeLength
        || boundaryDistance <= normalizedTolerance
      ) {
        simplified.splice(index, 1)
        changed = true
        break
      }
    }
  }

  return simplified.length >= 3 ? simplified : points.map((point) => point.clone())
}

function simplifyLandformOutlineForCompactMode(points: Vector3[], groundDefinition: GroundDynamicMesh | null): Vector3[] {
  if (points.length < 4) {
    return points
  }

  const baseEdgeLength = groundDefinition
    ? Math.max(groundDefinition.cellSize, LANDFORM_TARGET_TRI_EDGE_LENGTH)
    : LANDFORM_TARGET_TRI_EDGE_LENGTH
  const tolerance = baseEdgeLength * LANDFORM_COMPACT_BOUNDARY_SIMPLIFY_SCALE
  const minEdgeLength = baseEdgeLength * LANDFORM_COMPACT_BOUNDARY_MIN_EDGE_SCALE
  return normalizePolygonWinding(simplifyClosedPolygonXZ(points, tolerance, minEdgeLength))
}

function buildShapeTriangulation(points: Vector3[]): { vertices: Vector2[]; indices: number[] } | null {
  if (points.length < 3) {
    return null
  }

  const contour = points.map((point) => new Vector2(point.x, point.z))
  const shape = new Shape(contour)
  const geometry = new ShapeGeometry(shape)
  const position = geometry.getAttribute('position')
  if (!position || position.count < 3) {
    geometry.dispose()
    return null
  }

  const vertices: Vector2[] = []
  for (let index = 0; index < position.count; index += 1) {
    vertices.push(new Vector2(position.getX(index), position.getY(index)))
  }

  const indexAttribute = geometry.getIndex()
  const indices: number[] = []
  if (indexAttribute && indexAttribute.count >= 3) {
    for (let index = 0; index < indexAttribute.count; index += 1) {
      indices.push(indexAttribute.getX(index))
    }
  } else {
    for (let index = 0; index < position.count; index += 1) {
      indices.push(index)
    }
  }

  geometry.dispose()
  if (indices.length < 3) {
    return null
  }

  return { vertices, indices }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

function pointToSegmentDistance2D(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const abX = endX - startX
  const abZ = endZ - startZ
  const apX = pointX - startX
  const apZ = pointZ - startZ
  const abLengthSq = abX * abX + abZ * abZ
  if (abLengthSq <= 1e-12) {
    return Math.hypot(apX, apZ)
  }
  const projection = clamp01((apX * abX + apZ * abZ) / abLengthSq)
  const closestX = startX + abX * projection
  const closestZ = startZ + abZ * projection
  return Math.hypot(pointX - closestX, pointZ - closestZ)
}

function distanceToFootprintBoundary(pointX: number, pointZ: number, footprint: Array<[number, number]>): number {
  if (footprint.length < 2) {
    return 0
  }
  let minDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < footprint.length; index += 1) {
    const a = footprint[index]!
    const b = footprint[(index + 1) % footprint.length]!
    const distance = pointToSegmentDistance2D(pointX, pointZ, a[0], a[1], b[0], b[1])
    if (distance < minDistance) {
      minDistance = distance
    }
  }
  return Number.isFinite(minDistance) ? minDistance : 0
}

type FootprintSegment = {
  index: number
  startX: number
  startZ: number
  endX: number
  endZ: number
}

type FootprintSegmentIndex = {
  bucketSize: number
  buckets: Map<string, FootprintSegment[]>
}

function bucketKey(x: number, z: number): string {
  return `${x}:${z}`
}

function buildFootprintSegmentIndex(footprint: Array<[number, number]>, maxDistance: number): FootprintSegmentIndex | null {
  if (footprint.length < 2 || !Number.isFinite(maxDistance) || maxDistance <= 1e-6) {
    return null
  }

  const bucketSize = Math.max(maxDistance, 1e-3)
  const buckets = new Map<string, FootprintSegment[]>()

  for (let index = 0; index < footprint.length; index += 1) {
    const a = footprint[index]!
    const b = footprint[(index + 1) % footprint.length]!
    const segment: FootprintSegment = {
      index,
      startX: a[0],
      startZ: a[1],
      endX: b[0],
      endZ: b[1],
    }
    const minBucketX = Math.floor((Math.min(segment.startX, segment.endX) - maxDistance) / bucketSize)
    const maxBucketX = Math.floor((Math.max(segment.startX, segment.endX) + maxDistance) / bucketSize)
    const minBucketZ = Math.floor((Math.min(segment.startZ, segment.endZ) - maxDistance) / bucketSize)
    const maxBucketZ = Math.floor((Math.max(segment.startZ, segment.endZ) + maxDistance) / bucketSize)

    for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
      for (let bucketZ = minBucketZ; bucketZ <= maxBucketZ; bucketZ += 1) {
        const key = bucketKey(bucketX, bucketZ)
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.push(segment)
        } else {
          buckets.set(key, [segment])
        }
      }
    }
  }

  return { bucketSize, buckets }
}

function distanceToFootprintBoundaryWithin(
  pointX: number,
  pointZ: number,
  footprint: Array<[number, number]>,
  maxDistance: number,
  segmentIndex?: FootprintSegmentIndex | null,
): number {
  if (!Number.isFinite(maxDistance) || maxDistance <= 1e-6) {
    return distanceToFootprintBoundary(pointX, pointZ, footprint)
  }

  if (!segmentIndex) {
    return Math.min(distanceToFootprintBoundary(pointX, pointZ, footprint), maxDistance)
  }

  const bucketX = Math.floor(pointX / segmentIndex.bucketSize)
  const bucketZ = Math.floor(pointZ / segmentIndex.bucketSize)
  const candidates = segmentIndex.buckets.get(bucketKey(bucketX, bucketZ)) ?? []
  if (!candidates.length) {
    return maxDistance
  }

  let minDistance = maxDistance
  const seen = new Set<number>()
  candidates.forEach((segment) => {
    if (seen.has(segment.index)) {
      return
    }
    seen.add(segment.index)
    const distance = pointToSegmentDistance2D(
      pointX,
      pointZ,
      segment.startX,
      segment.startZ,
      segment.endX,
      segment.endZ,
    )
    if (distance < minDistance) {
      minDistance = distance
    }
  })
  return minDistance
}

function buildLandformSurfaceFeather(
  footprint: Array<[number, number]>,
  surfaceVertices: Array<{ x: number; z: number }>,
  featherWidth: number,
  enableFeather: boolean = true,
): number[] {
  if (!enableFeather) {
    return surfaceVertices.map(() => 1)
  }
  const normalizedWidth = Number.isFinite(featherWidth) ? Math.max(0, featherWidth) : 0
  if (normalizedWidth <= 1e-6 || footprint.length < 3 || !surfaceVertices.length) {
    return surfaceVertices.map(() => 1)
  }

  const segmentIndex = buildFootprintSegmentIndex(footprint, normalizedWidth)

  return surfaceVertices.map((vertex) => {
    const distance = distanceToFootprintBoundaryWithin(vertex.x, vertex.z, footprint, normalizedWidth, segmentIndex)
    const t = clamp01(distance / normalizedWidth)
    // smoothstep for a softer, more natural transition.
    return t * t * (3 - 2 * t)
  })
}

function resolveLandformCellSubdivisions(cellSize: number): number {
  if (!Number.isFinite(cellSize) || cellSize <= 1e-6) {
    return 1
  }
  const subdivisions = Math.ceil(cellSize / LANDFORM_TARGET_TRI_EDGE_LENGTH)
  return Math.min(LANDFORM_MAX_CELL_SUBDIVISIONS, Math.max(1, subdivisions))
}

function resolveLandformSubdivisionSteps(cellSize: number): number {
  const targetSubdivisions = resolveLandformCellSubdivisions(cellSize)
  return Math.max(0, Math.ceil(Math.log2(targetSubdivisions)))
}

type SampledLandformVertex = {
  x: number
  z: number
  height: number
}

type LandformHeightSampler = (x: number, z: number) => number

function createLandformHeightSampler(groundDefinition: GroundDynamicMesh): LandformHeightSampler {
  const cache = new Map<string, number>()
  return (x: number, z: number) => {
    const key = `${x.toFixed(6)},${z.toFixed(6)}`
    const cached = cache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const sampled = sampleGroundHeight(groundDefinition, x, z)
    cache.set(key, sampled)
    return sampled
  }
}

function sampleLandformTriangleVertexHeight(sampleHeight: LandformHeightSampler, vertex: Vector2): SampledLandformVertex {
  return {
    x: vertex.x,
    z: vertex.y,
    height: sampleHeight(vertex.x, vertex.y),
  }
}

function interpolateTriangleHeightAtPoint(
  pointX: number,
  pointZ: number,
  a: SampledLandformVertex,
  b: SampledLandformVertex,
  c: SampledLandformVertex,
): number | null {
  const denominator = ((b.z - c.z) * (a.x - c.x)) + ((c.x - b.x) * (a.z - c.z))
  if (Math.abs(denominator) <= 1e-10) {
    return null
  }

  const weightA = (((b.z - c.z) * (pointX - c.x)) + ((c.x - b.x) * (pointZ - c.z))) / denominator
  const weightB = (((c.z - a.z) * (pointX - c.x)) + ((a.x - c.x) * (pointZ - c.z))) / denominator
  const weightC = 1 - weightA - weightB
  return (a.height * weightA) + (b.height * weightB) + (c.height * weightC)
}

function requiresGroundConformanceRefinement(
  sampleHeight: LandformHeightSampler,
  a: Vector2,
  b: Vector2,
  c: Vector2,
  tolerance: number,
  targetEdgeLength: number,
  maxSampleDivisions: number = LANDFORM_MAX_TRIANGLE_SAMPLE_DIVISIONS,
): boolean {
  if (!Number.isFinite(tolerance) || tolerance <= 1e-6) {
    return false
  }

  const sampledA = sampleLandformTriangleVertexHeight(sampleHeight, a)
  const sampledB = sampleLandformTriangleVertexHeight(sampleHeight, b)
  const sampledC = sampleLandformTriangleVertexHeight(sampleHeight, c)

  const d01 = a.distanceTo(b)
  const d12 = b.distanceTo(c)
  const d20 = c.distanceTo(a)
  const largestEdge = Math.max(d01, d12, d20)

  const testPoints = [
    { x: (a.x + b.x + c.x) / 3, z: (a.y + b.y + c.y) / 3 },
  ]

  const normalizedTargetEdgeLength = Number.isFinite(targetEdgeLength) && targetEdgeLength > 1e-6
    ? targetEdgeLength
    : LANDFORM_TARGET_TRI_EDGE_LENGTH
  const normalizedMaxSampleDivisions = Math.max(2, Math.trunc(maxSampleDivisions || LANDFORM_MAX_TRIANGLE_SAMPLE_DIVISIONS))
  const sampleDivisions = Math.min(
    normalizedMaxSampleDivisions,
    Math.max(2, Math.ceil(largestEdge / normalizedTargetEdgeLength)),
  )

  if (largestEdge > normalizedTargetEdgeLength * 1.25) {
    for (let step = 1; step < sampleDivisions; step += 1) {
      const t = step / sampleDivisions
      testPoints.push(
        { x: a.x + (b.x - a.x) * t, z: a.y + (b.y - a.y) * t },
        { x: b.x + (c.x - b.x) * t, z: b.y + (c.y - b.y) * t },
        { x: c.x + (a.x - c.x) * t, z: c.y + (a.y - c.y) * t },
      )
    }

    for (let row = 1; row < sampleDivisions; row += 1) {
      for (let column = 1; column < sampleDivisions - row; column += 1) {
        const weightA = row / sampleDivisions
        const weightB = column / sampleDivisions
        const weightC = 1 - weightA - weightB
        if (weightC <= 0) {
          continue
        }
        testPoints.push({
          x: a.x * weightA + b.x * weightB + c.x * weightC,
          z: a.y * weightA + b.y * weightB + c.y * weightC,
        })
      }
    }
  }

  return testPoints.some((point) => {
    const approximatedHeight = interpolateTriangleHeightAtPoint(point.x, point.z, sampledA, sampledB, sampledC)
    if (approximatedHeight === null || !Number.isFinite(approximatedHeight)) {
      return false
    }
    const actualHeight = sampleHeight(point.x, point.z)
    return Math.abs(actualHeight - approximatedHeight) > tolerance
  })
}

function resolveLandformFeatherRefinementEdgeLength(featherWidth: number, targetEdgeLength: number): number {
  const normalizedTarget = Number.isFinite(targetEdgeLength) && targetEdgeLength > 1e-6
    ? targetEdgeLength
    : LANDFORM_TARGET_TRI_EDGE_LENGTH
  if (!Number.isFinite(featherWidth) || featherWidth <= 1e-6) {
    return normalizedTarget
  }
  return Math.min(normalizedTarget, Math.max(0.1, featherWidth * 0.5))
}

function resolveLandformSupportRingWidth(featherWidth: number, targetEdgeLength: number): number {
  const normalizedTarget = Number.isFinite(targetEdgeLength) && targetEdgeLength > 1e-6
    ? targetEdgeLength
    : LANDFORM_TARGET_TRI_EDGE_LENGTH
  const normalizedFeatherWidth = Number.isFinite(featherWidth) ? Math.max(0, featherWidth) : 0
  const derived = Math.max(
    normalizedTarget,
    normalizedFeatherWidth * LANDFORM_SUPPORT_RING_WIDTH_SCALE,
  )
  return Math.min(LANDFORM_SUPPORT_RING_MAX_WIDTH, Math.max(LANDFORM_SUPPORT_RING_MIN_WIDTH, derived))
}

function resolveLandformSupportRingEdgeLength(featherWidth: number, targetEdgeLength: number): number {
  const featherTargetEdgeLength = resolveLandformFeatherRefinementEdgeLength(featherWidth, targetEdgeLength)
  const normalizedTarget = Number.isFinite(targetEdgeLength) && targetEdgeLength > 1e-6
    ? targetEdgeLength
    : LANDFORM_TARGET_TRI_EDGE_LENGTH
  return Math.max(featherTargetEdgeLength, normalizedTarget * LANDFORM_SUPPORT_RING_EDGE_LENGTH_SCALE)
}

function buildLandformBoundaryDistanceResolver(
  options: LandformFeatherRefinementOptions | null | undefined,
): ((pointX: number, pointZ: number) => number) | null {
  if (!options) {
    return null
  }

  const normalizedProtectedDistance = Number.isFinite(options.protectedDistance)
    ? Math.max(0, options.protectedDistance as number)
    : Math.max(0, Number(options.featherWidth) || 0)
  if (normalizedProtectedDistance <= 1e-6 || options.footprint.length < 3) {
    return null
  }

  const cache = options.distanceCache ?? new Map<string, number>()
  const segmentIndex = options.segmentIndex

  return (pointX: number, pointZ: number) => {
    const key = `${pointX.toFixed(6)},${pointZ.toFixed(6)}`
    const cached = cache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const distance = distanceToFootprintBoundaryWithin(
      pointX,
      pointZ,
      options.footprint,
      normalizedProtectedDistance,
      segmentIndex,
    )
    cache.set(key, distance)
    return distance
  }
}

function resolveLandformTriangleBoundaryBand(
  a: Vector2,
  b: Vector2,
  c: Vector2,
  options: LandformFeatherRefinementOptions | null | undefined,
): 'none' | 'support' | 'feather' {
  if (!options) {
    return 'none'
  }

  const normalizedFeatherWidth = Number.isFinite(options.featherWidth) ? Math.max(0, options.featherWidth) : 0
  const normalizedSupportRingWidth = Number.isFinite(options.supportRingWidth)
    ? Math.max(0, options.supportRingWidth as number)
    : 0
  const protectedDistance = Number.isFinite(options.protectedDistance)
    ? Math.max(0, options.protectedDistance as number)
    : normalizedFeatherWidth
  if (protectedDistance <= 1e-6 || options.footprint.length < 3) {
    return 'none'
  }

  const resolveDistance = buildLandformBoundaryDistanceResolver(options)
  if (!resolveDistance) {
    return 'none'
  }

  const testPoints = [
    { x: a.x, z: a.y },
    { x: b.x, z: b.y },
    { x: c.x, z: c.y },
    { x: (a.x + b.x) * 0.5, z: (a.y + b.y) * 0.5 },
    { x: (b.x + c.x) * 0.5, z: (b.y + c.y) * 0.5 },
    { x: (c.x + a.x) * 0.5, z: (c.y + a.y) * 0.5 },
    { x: (a.x + b.x + c.x) / 3, z: (a.y + b.y + c.y) / 3 },
  ]

  let minDistance = Number.POSITIVE_INFINITY
  testPoints.forEach((point) => {
    minDistance = Math.min(minDistance, resolveDistance(point.x, point.z))
  })

  if (minDistance > protectedDistance) {
    return 'none'
  }
  if (normalizedFeatherWidth > 1e-6 && minDistance <= normalizedFeatherWidth) {
    return 'feather'
  }
  return normalizedSupportRingWidth > 1e-6 ? 'support' : 'none'
}

function requiresLandformProtectedBandRefinement(
  a: Vector2,
  b: Vector2,
  c: Vector2,
  boundaryBand: 'none' | 'support' | 'feather',
  featherWidth: number,
  targetEdgeLength: number,
): boolean {
  if (boundaryBand === 'none') {
    return false
  }

  const d01 = a.distanceTo(b)
  const d12 = b.distanceTo(c)
  const d20 = c.distanceTo(a)
  const largestEdge = Math.max(d01, d12, d20)
  const edgeThreshold = boundaryBand === 'feather'
    ? resolveLandformFeatherRefinementEdgeLength(featherWidth, targetEdgeLength)
    : resolveLandformSupportRingEdgeLength(featherWidth, targetEdgeLength)
  return largestEdge > edgeThreshold
}

function refineLandformTriangulationForGround(
  triangulation: { vertices: Vector2[]; indices: number[] },
  groundDefinition: GroundDynamicMesh,
  sampleHeight: LandformHeightSampler,
  enableFeather: boolean,
  featherOptions?: LandformFeatherRefinementOptions | null,
): { vertices: Vector2[]; indices: number[] } {
  const cellSize = Math.max(1e-6, groundDefinition.cellSize)
  const subdivisionSteps = resolveLandformSubdivisionSteps(cellSize)
  const baseTargetEdgeLength = cellSize / Math.max(1, resolveLandformCellSubdivisions(cellSize))
  const targetEdgeLength = enableFeather
    ? baseTargetEdgeLength
    : baseTargetEdgeLength * LANDFORM_COMPACT_EDGE_LENGTH_SCALE
  const interiorTargetEdgeLength = enableFeather
    ? targetEdgeLength * LANDFORM_INTERIOR_EDGE_LENGTH_SCALE
    : targetEdgeLength * LANDFORM_INTERIOR_EDGE_LENGTH_SCALE * LANDFORM_COMPACT_INTERIOR_EDGE_LENGTH_SCALE
  const interiorHeightTolerance = LANDFORM_HEIGHT_ERROR_TOLERANCE * (
    enableFeather ? LANDFORM_INTERIOR_HEIGHT_ERROR_TOLERANCE_SCALE : LANDFORM_INTERIOR_HEIGHT_ERROR_TOLERANCE_SCALE * LANDFORM_COMPACT_HEIGHT_ERROR_TOLERANCE_SCALE
  )
  const maxSteps = Math.min(LANDFORM_MAX_REFINEMENT_STEPS, Math.max(1, subdivisionSteps + (enableFeather ? 4 : 2)))
  const normalizedSupportRingWidth = resolveLandformSupportRingWidth(
    enableFeather ? (featherOptions?.featherWidth ?? 0) : 0,
    targetEdgeLength,
  )
  const protectedDistance = Math.max(0, enableFeather ? (Number(featherOptions?.featherWidth) || 0) : 0) + normalizedSupportRingWidth
  const normalizedFeatherOptions = enableFeather && featherOptions && featherOptions.footprint.length >= 3 && featherOptions.featherWidth > 1e-6
    ? {
      ...featherOptions,
      supportRingWidth: normalizedSupportRingWidth,
      protectedDistance,
      segmentIndex: buildFootprintSegmentIndex(featherOptions.footprint, protectedDistance),
      distanceCache: new Map<string, number>(),
    }
    : null

  return refineTriangulation(
    triangulation.vertices,
    triangulation.indices,
    targetEdgeLength,
    maxSteps,
    (a, b, c) => {
      const boundaryBand = resolveLandformTriangleBoundaryBand(a, b, c, normalizedFeatherOptions)
      if (requiresLandformProtectedBandRefinement(
        a,
        b,
        c,
        boundaryBand,
        normalizedFeatherOptions?.featherWidth ?? 0,
        targetEdgeLength,
      )) {
        return true
      }

      return requiresGroundConformanceRefinement(
        sampleHeight,
        a,
        b,
        c,
        boundaryBand === 'none' ? interiorHeightTolerance : LANDFORM_HEIGHT_ERROR_TOLERANCE,
        boundaryBand === 'none' ? interiorTargetEdgeLength : targetEdgeLength,
        boundaryBand === 'none'
          ? Math.min(LANDFORM_INTERIOR_MAX_TRIANGLE_SAMPLE_DIVISIONS, LANDFORM_COMPACT_MAX_SAMPLE_DIVISIONS)
          : (enableFeather ? LANDFORM_MAX_TRIANGLE_SAMPLE_DIVISIONS : LANDFORM_COMPACT_MAX_SAMPLE_DIVISIONS),
      )
    },
  )
}

function compactLandformTriangulation(
  triangulation: { vertices: Vector2[]; indices: number[] },
): { vertices: Vector2[]; indices: number[] } {
  if (!triangulation.vertices.length || !triangulation.indices.length) {
    return { vertices: [], indices: [] }
  }

  const remappedIndices: number[] = []
  const nextVertices: Vector2[] = []
  const indexByKey = new Map<string, number>()
  const originalToCompacted = new Map<number, number>()

  const resolveVertexIndex = (originalIndex: number): number => {
    const cached = originalToCompacted.get(originalIndex)
    if (cached !== undefined) {
      return cached
    }
    const vertex = triangulation.vertices[originalIndex]!
    const key = `${vertex.x.toFixed(5)},${vertex.y.toFixed(5)}`
    const existing = indexByKey.get(key)
    if (existing !== undefined) {
      originalToCompacted.set(originalIndex, existing)
      return existing
    }
    const nextIndex = nextVertices.length
    nextVertices.push(vertex.clone())
    indexByKey.set(key, nextIndex)
    originalToCompacted.set(originalIndex, nextIndex)
    return nextIndex
  }

  for (let index = 0; index + 2 < triangulation.indices.length; index += 3) {
    const i0 = resolveVertexIndex(triangulation.indices[index]!)
    const i1 = resolveVertexIndex(triangulation.indices[index + 1]!)
    const i2 = resolveVertexIndex(triangulation.indices[index + 2]!)
    if (i0 === i1 || i1 === i2 || i0 === i2) {
      continue
    }
    remappedIndices.push(i0, i1, i2)
  }

  return {
    vertices: nextVertices,
    indices: remappedIndices,
  }
}

function refineTriangulation(
  verticesInput: Vector2[],
  indicesInput: number[],
  targetEdgeLength: number,
  maxSteps: number,
  shouldSplitByShape?: (a: Vector2, b: Vector2, c: Vector2) => boolean,
): { vertices: Vector2[]; indices: number[] } {
  if (!Number.isFinite(targetEdgeLength) || targetEdgeLength <= 1e-6 || maxSteps <= 0 || indicesInput.length < 3) {
    return {
      vertices: verticesInput.map((entry) => entry.clone()),
      indices: [...indicesInput],
    }
  }

  const vertices = verticesInput.map((entry) => entry.clone())
  let indices = [...indicesInput]

  for (let step = 0; step < maxSteps; step += 1) {
    const nextIndices: number[] = []
    const midpointByEdge = new Map<string, number>()
    let anySplit = false

    const resolveMidpointIndex = (indexA: number, indexB: number): number => {
      const min = Math.min(indexA, indexB)
      const max = Math.max(indexA, indexB)
      const edgeKey = `${min}:${max}`
      const cached = midpointByEdge.get(edgeKey)
      if (cached !== undefined) {
        return cached
      }
      const a = vertices[indexA]!
      const b = vertices[indexB]!
      const midpoint = new Vector2((a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
      const nextIndex = vertices.length
      vertices.push(midpoint)
      midpointByEdge.set(edgeKey, nextIndex)
      return nextIndex
    }

    const shouldSplitTriangle = (i0: number, i1: number, i2: number): boolean => {
      const v0 = vertices[i0]!
      const v1 = vertices[i1]!
      const v2 = vertices[i2]!
      if (shouldSplitByShape) {
        return shouldSplitByShape(v0, v1, v2)
      }

      const d01 = v0.distanceTo(v1)
      const d12 = v1.distanceTo(v2)
      const d20 = v2.distanceTo(v0)
      return d01 > targetEdgeLength || d12 > targetEdgeLength || d20 > targetEdgeLength
    }

    for (let index = 0; index + 2 < indices.length; index += 3) {
      const i0 = indices[index]!
      const i1 = indices[index + 1]!
      const i2 = indices[index + 2]!

      if (!shouldSplitTriangle(i0, i1, i2)) {
        nextIndices.push(i0, i1, i2)
        continue
      }

      anySplit = true
      const m01 = resolveMidpointIndex(i0, i1)
      const m12 = resolveMidpointIndex(i1, i2)
      const m20 = resolveMidpointIndex(i2, i0)

      nextIndices.push(
        i0, m01, m20,
        m01, i1, m12,
        m20, m12, i2,
        m01, m12, m20,
      )
    }

    indices = nextIndices
    if (!anySplit) {
      break
    }
  }

  return { vertices, indices }
}

export function createSceneStoreLandformHelpers(deps: SceneStoreLandformHelpersDeps) {
  return {
    ensureLandformMaterialConvention(node: SceneNode): { materialsChanged: boolean; meshChanged: boolean } {
      if (node.dynamicMesh?.type !== 'Landform') {
        return { materialsChanged: false, meshChanged: false }
      }

      const currentMaterials = Array.isArray(node.materials) ? node.materials : []
      let nextMaterials = currentMaterials
      if (!currentMaterials.length) {
        nextMaterials = deps.createLandformNodeMaterials({ surfaceName: 'Surface' })
      } else {
        const normalizedMaterials = currentMaterials.map((entry) => {
          if (entry?.side === 'double') {
            return entry
          }
          return {
            ...entry,
            side: 'double',
          }
        })
        const sideChanged = normalizedMaterials.some((entry, index) => entry !== currentMaterials[index])
        if (sideChanged) {
          nextMaterials = normalizedMaterials as SceneNodeMaterial[]
        }
      }

      const materialsChanged = nextMaterials !== currentMaterials
      if (materialsChanged) {
        node.materials = nextMaterials as any
      }

      const normalizeId = (value: unknown) => (typeof value === 'string' && value.trim().length ? value.trim() : null)
      const materialIds = (nextMaterials as any[]).map((entry) => entry.id)
      const fallbackId = (nextMaterials as any[])[0]?.id ?? null
      let materialConfigId = normalizeId((node.dynamicMesh as any).materialConfigId) ?? fallbackId
      if (materialConfigId && !materialIds.includes(materialConfigId)) {
        materialConfigId = fallbackId
      }

      const mesh = node.dynamicMesh as LandformDynamicMesh
      const footprint = Array.isArray(mesh.footprint)
        ? mesh.footprint
          .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
          .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
        : []
      const surfaceVertices = Array.isArray(mesh.surfaceVertices)
        ? mesh.surfaceVertices
          .map((entry) => ({ x: Number(entry?.x), z: Number(entry?.z) }))
          .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))
        : []
      const expectedFeather = buildLandformSurfaceFeather(
        footprint,
        surfaceVertices,
        Number(mesh.feather),
        typeof mesh.enableFeather === 'boolean' ? mesh.enableFeather : LANDFORM_DEFAULT_ENABLE_FEATHER,
      )
      const currentFeather = Array.isArray(mesh.surfaceFeather) ? mesh.surfaceFeather : []
      const featherNeedsSync = expectedFeather.length !== currentFeather.length
        || expectedFeather.some((value, index) => Math.abs(value - Number(currentFeather[index])) > 1e-5)

      const meshChanged = mesh.materialConfigId !== materialConfigId || featherNeedsSync
      if (meshChanged) {
        node.dynamicMesh = {
          ...mesh,
          materialConfigId,
          surfaceFeather: expectedFeather,
        }
      }

      return { materialsChanged, meshChanged }
    },

    buildLandformDynamicMeshFromWorldPoints(
      points: Vector3Like[],
      groundDefinition: GroundDynamicMesh | null,
      groundNode: SceneNode | null,
      options: Partial<LandformComponentProps> = {},
    ): { center: Vector3; definition: LandformDynamicMesh } | null {
      const worldPoints = normalizePolygonWinding(buildWorldPoints(points))
      if (worldPoints.length < 3) {
        return null
      }

      const normalizedProps = clampLandformComponentProps(options)
      const buildPoints = normalizedProps.enableFeather
        ? worldPoints
        : simplifyLandformOutlineForCompactMode(worldPoints, groundDefinition)
      if (buildPoints.length < 3) {
        return null
      }

      const center = computeCenter(buildPoints)
      const featherWidth = normalizedProps.enableFeather ? normalizedProps.feather : 0
      const footprint = buildPoints.map((point) => [point.x - center.x, point.z - center.z] as [number, number])

      if (!groundDefinition) {
        const triangulation = buildShapeTriangulation(buildPoints)
        if (!triangulation) {
          return null
        }

        const yByKey = new Map<string, number>()
        buildPoints.forEach((point) => {
          yByKey.set(`${point.x.toFixed(6)},${point.z.toFixed(6)}`, point.y)
        })
        const surfaceWorldVertices = triangulation.vertices.map((vertex) => {
          const key = `${vertex.x.toFixed(6)},${vertex.y.toFixed(6)}`
          const y = yByKey.get(key)
          return new Vector3(vertex.x, Number.isFinite(y as number) ? (y as number) : center.y, vertex.y)
        })

        const surfaceVertices = surfaceWorldVertices.map((point) => ({ x: point.x - center.x, y: point.y - center.y, z: point.z - center.z }))
        const surfaceIndices = [...triangulation.indices]
        const surfaceUvs = surfaceWorldVertices.map((point) => ({
          x: (point.x - center.x) / normalizedProps.uvScale.x,
          y: (point.z - center.z) / normalizedProps.uvScale.y,
        }) satisfies Vector2Like)
        return {
          center,
          definition: {
            type: 'Landform',
            footprint,
            surfaceVertices,
            surfaceIndices,
            surfaceUvs,
            materialConfigId: null,
            enableFeather: normalizedProps.enableFeather,
            feather: normalizedProps.feather,
            uvScale: { ...normalizedProps.uvScale },
            surfaceFeather: buildLandformSurfaceFeather(footprint, surfaceVertices, featherWidth, normalizedProps.enableFeather),
          },
        }
      }

      const transform = getGroundTransform(groundNode)
      const polygonLocal = normalizePolygonWinding(buildPoints.map((point) => worldToGroundLocal(point, transform)))
      const polygonTriangulation = buildShapeTriangulation(polygonLocal)
      if (!polygonTriangulation) {
        return null
      }

      const sampleHeight = createLandformHeightSampler(groundDefinition)

      const refinedTriangulation = refineLandformTriangulationForGround(
        polygonTriangulation,
        groundDefinition,
        sampleHeight,
        normalizedProps.enableFeather,
        {
          footprint: polygonLocal.map((point) => [point.x, point.z] as [number, number]),
          featherWidth: resolveGroundLocalDistance(featherWidth, transform),
        },
      )
      const triangulation = normalizedProps.enableFeather
        ? refinedTriangulation
        : compactLandformTriangulation(refinedTriangulation)

      const surfaceIndices = [...triangulation.indices]
      const surfaceWorldVertices = triangulation.vertices.map((vertex) => {
        const localHeight = sampleHeight(vertex.x, vertex.y)
        return groundLocalToWorld(new Vector3(vertex.x, localHeight, vertex.y), transform)
      })

      if (surfaceWorldVertices.length < 3 || surfaceIndices.length < 3) {
        return null
      }

      const surfaceVertices = surfaceWorldVertices.map((point) => ({
        x: point.x - center.x,
        y: point.y - center.y,
        z: point.z - center.z,
      }))
      const surfaceUvs = surfaceWorldVertices.map((point) => ({
        x: (point.x - center.x) / normalizedProps.uvScale.x,
        y: (point.z - center.z) / normalizedProps.uvScale.y,
      }) satisfies Vector2Like)

      return {
        center,
        definition: {
          type: 'Landform',
          footprint,
          surfaceVertices,
          surfaceIndices,
          surfaceUvs,
          surfaceFeather: buildLandformSurfaceFeather(footprint, surfaceVertices, featherWidth, normalizedProps.enableFeather),
          materialConfigId: null,
          enableFeather: normalizedProps.enableFeather,
          feather: normalizedProps.feather,
          uvScale: { ...normalizedProps.uvScale },
        },
      }
    },

    buildLandformDynamicMeshFromLocalPoints(
      node: SceneNode,
      points: Array<[number, number]>,
      groundDefinition: GroundDynamicMesh | null,
      groundNode: SceneNode | null,
      options: Partial<LandformComponentProps> = {},
      runtimeObject?: Object3D | null,
    ): LandformDynamicMesh | null {
      const frameObject = resolveLandformFrameObject(node, runtimeObject)
      const worldPoints = normalizePolygonWinding(buildWorldPoints(
        points.map(([x, z]) => frameObject.localToWorld(new Vector3(Number(x), 0, Number(z)))),
      ))
      if (worldPoints.length < 3) {
        return null
      }

      const normalizedProps = clampLandformComponentProps(options)
      const buildPoints = normalizedProps.enableFeather
        ? worldPoints
        : simplifyLandformOutlineForCompactMode(worldPoints, groundDefinition)
      if (buildPoints.length < 3) {
        return null
      }
      const featherWidth = normalizedProps.enableFeather ? normalizedProps.feather : 0
      const footprint = buildPoints
        .map((point) => frameObject.worldToLocal(point.clone()))
        .map((point) => [point.x, point.z] as [number, number])
        .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]))

      if (footprint.length < 3) {
        return null
      }

      let surfaceWorldVertices: Vector3[] = []
      let surfaceIndices: number[] = []

      if (!groundDefinition) {
        const triangulation = buildShapeTriangulation(buildPoints)
        if (!triangulation) {
          return null
        }

        const yByKey = new Map<string, number>()
        buildPoints.forEach((point) => {
          yByKey.set(`${point.x.toFixed(6)},${point.z.toFixed(6)}`, point.y)
        })
        surfaceWorldVertices = triangulation.vertices.map((vertex) => {
          const key = `${vertex.x.toFixed(6)},${vertex.y.toFixed(6)}`
          const y = yByKey.get(key)
          return new Vector3(vertex.x, Number.isFinite(y as number) ? (y as number) : 0, vertex.y)
        })
        surfaceIndices = [...triangulation.indices]
      } else {
        const transform = getGroundTransform(groundNode)
        const polygonLocal = normalizePolygonWinding(buildPoints.map((point) => worldToGroundLocal(point, transform)))
        const polygonTriangulation = buildShapeTriangulation(polygonLocal)
        if (!polygonTriangulation) {
          return null
        }

        const sampleHeight = createLandformHeightSampler(groundDefinition)

        const refinedTriangulation = refineLandformTriangulationForGround(
          polygonTriangulation,
          groundDefinition,
          sampleHeight,
          normalizedProps.enableFeather,
          {
            footprint: polygonLocal.map((point) => [point.x, point.z] as [number, number]),
            featherWidth: resolveGroundLocalDistance(featherWidth, transform),
          },
        )
        const triangulation = normalizedProps.enableFeather
          ? refinedTriangulation
          : compactLandformTriangulation(refinedTriangulation)

        surfaceIndices = [...triangulation.indices]
        surfaceWorldVertices = triangulation.vertices.map((vertex) => {
          const localHeight = sampleHeight(vertex.x, vertex.y)
          return groundLocalToWorld(new Vector3(vertex.x, localHeight, vertex.y), transform)
        })
      }

      if (surfaceWorldVertices.length < 3 || surfaceIndices.length < 3) {
        return null
      }

      const surfaceVertices = surfaceWorldVertices
        .map((point) => frameObject.worldToLocal(point.clone()))
        .map((point) => ({ x: point.x, y: point.y, z: point.z }))
      const surfaceUvs = surfaceVertices.map((point) => ({
        x: point.x / normalizedProps.uvScale.x,
        y: point.z / normalizedProps.uvScale.y,
      }) satisfies Vector2Like)

      return {
        type: 'Landform',
        footprint,
        surfaceVertices,
        surfaceIndices,
        surfaceUvs,
        materialConfigId: null,
        enableFeather: normalizedProps.enableFeather,
        feather: normalizedProps.feather,
        uvScale: { ...normalizedProps.uvScale },
        surfaceFeather: buildLandformSurfaceFeather(footprint, surfaceVertices, featherWidth, normalizedProps.enableFeather),
      }
    },

    applyLandformComponentPropsToNode(node: SceneNode, props: LandformComponentProps): boolean {
      if (node.dynamicMesh?.type !== 'Landform') {
        return false
      }
      const normalized = clampLandformComponentProps(props)
      const mesh = node.dynamicMesh as LandformDynamicMesh
      const currentEnableFeather = typeof mesh.enableFeather === 'boolean'
        ? mesh.enableFeather
        : LANDFORM_DEFAULT_ENABLE_FEATHER
      const currentFeather = Number.isFinite(mesh.feather) ? Number(mesh.feather) : LANDFORM_DEFAULT_FEATHER
      const currentU = Number.isFinite(mesh.uvScale?.x) ? Number(mesh.uvScale?.x) : LANDFORM_DEFAULT_UV_SCALE.x
      const currentV = Number.isFinite(mesh.uvScale?.y) ? Number(mesh.uvScale?.y) : LANDFORM_DEFAULT_UV_SCALE.y
      const unchanged = currentEnableFeather === normalized.enableFeather
        && Math.abs(currentFeather - normalized.feather) <= 1e-6
        && Math.abs(currentU - normalized.uvScale.x) <= 1e-6
        && Math.abs(currentV - normalized.uvScale.y) <= 1e-6
      if (unchanged) {
        return false
      }

      const nextMesh: LandformDynamicMesh = {
        ...mesh,
        enableFeather: normalized.enableFeather,
        feather: normalized.feather,
        uvScale: { x: normalized.uvScale.x, y: normalized.uvScale.y },
        surfaceFeather: buildLandformSurfaceFeather(
          Array.isArray(mesh.footprint)
            ? mesh.footprint
              .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
              .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
            : [],
          Array.isArray(mesh.surfaceVertices)
            ? mesh.surfaceVertices
              .map((entry) => ({ x: Number(entry?.x), z: Number(entry?.z) }))
              .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))
            : [],
          normalized.enableFeather ? normalized.feather : 0,
          normalized.enableFeather,
        ),
      }
      node.dynamicMesh = nextMesh
      const runtime = deps.getRuntimeObject(node.id)
      if (runtime) {
        deps.updateLandformGroup(runtime, nextMesh)
      }
      return true
    },
  }
}