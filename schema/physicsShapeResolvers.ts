import * as THREE from 'three'
import type {
  SceneNode,
  SceneNodeComponentState,
  FloorDynamicMesh,
  WallDynamicMesh,
  ModelCollisionDynamicMesh,
} from './index'
import { compileWallSegmentsFromDefinition } from './wallLayout'
import type {
  RigidbodyPhysicsShape,
  RigidbodyVector3Tuple,
} from './components'
import {
  WALL_COMPONENT_TYPE,
  clampWallProps,
} from './components'

const WALL_FORBIDDEN_COLLIDER_HEIGHT = 100
const FLOOR_EPSILON = 1e-6
const MODEL_COLLISION_EPSILON = 1e-5
const MODEL_COLLISION_DEFAULT_THICKNESS = 0.05
const MODEL_COLLISION_MIN_THICKNESS = 0.01

const wallAxisXHelper = new THREE.Vector3(1, 0, 0)
const wallStartHelper = new THREE.Vector3()
const wallEndHelper = new THREE.Vector3()
const wallDirHelper = new THREE.Vector3()
const wallUnitDirHelper = new THREE.Vector3()
const wallQuatThreeHelper = new THREE.Quaternion()
const modelCollisionNormalHelper = new THREE.Vector3()
const modelCollisionEdgeHelperA = new THREE.Vector3()
const modelCollisionEdgeHelperB = new THREE.Vector3()
const modelCollisionProjectedHelper = new THREE.Vector3()
const modelCollisionOriginHelper = new THREE.Vector3()

export type WallShapeCacheSegment = {
  halfExtents: [number, number, number]
  offset: [number, number, number]
  orientation: [number, number, number, number]
}

export type WallTrimeshCacheEntry = {
  signature: string
  segments: WallShapeCacheSegment[]
}

export type WallTrimeshCache = Map<string, WallTrimeshCacheEntry>

export type FloorShapeCacheEntry = {
  signature: string
  segments: Array<{
    shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>
  }>
}

export type FloorShapeCache = Map<string, FloorShapeCacheEntry>

type LoggerTag = string | undefined

function warn(loggerTag: LoggerTag, message: string, ...args: unknown[]): void {
  const prefix = loggerTag ?? '[PhysicsEngine]'
  console.warn(`${prefix} ${message}`, ...args)
}

function clampFloorSmooth(value: unknown): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (raw <= 0) {
    return 0
  }
  if (raw >= 1) {
    return 1
  }
  return raw
}

function clampFloorThickness(value: unknown): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (raw <= 0) {
    return 0
  }
  return Math.min(10, raw)
}

function sanitizeFloorVertices(vertices: unknown): Array<[number, number]> {
  if (!Array.isArray(vertices)) {
    return []
  }
  const out: Array<[number, number]> = []
  for (const entry of vertices) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue
    }
    const x = Number(entry[0])
    const z = Number(entry[1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    const prev = out[out.length - 1]
    if (prev) {
      const dx = x - prev[0]
      const dz = z - prev[1]
      if (dx * dx + dz * dz <= FLOOR_EPSILON) {
        continue
      }
    }
    out.push([x, z])
  }
  if (out.length >= 3) {
    const first = out[0]!
    const last = out[out.length - 1]!
    const dx = first[0] - last[0]
    const dz = first[1] - last[1]
    if (dx * dx + dz * dz <= FLOOR_EPSILON) {
      out.pop()
    }
  }
  return out
}

function createFloorShapeFromPolygon(points: THREE.Vector2[], smooth: number): THREE.Shape {
  const shape = new THREE.Shape()
  if (!points.length) {
    return shape
  }

  if (smooth <= Number.EPSILON) {
    shape.moveTo(points[0]!.x, points[0]!.y)
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i]!.x, points[i]!.y)
    }
    shape.closePath()
    return shape
  }

  type CornerInfo = {
    vertex: THREE.Vector2
    enter: THREE.Vector2
    exit: THREE.Vector2
  }

  const cornerInfos: CornerInfo[] = points.map((vertex, index) => {
    const prev = points[(index - 1 + points.length) % points.length]!
    const next = points[(index + 1) % points.length]!
    const directionToPrev = prev.clone().sub(vertex)
    const directionToNext = next.clone().sub(vertex)
    const lenPrev = directionToPrev.length()
    const lenNext = directionToNext.length()

    if (lenPrev <= FLOOR_EPSILON || lenNext <= FLOOR_EPSILON) {
      return {
        vertex: vertex.clone(),
        enter: vertex.clone(),
        exit: vertex.clone(),
      }
    }

    const maxOffset = Math.min(lenPrev, lenNext) * 0.5
    const radius = smooth * maxOffset
    if (radius <= FLOOR_EPSILON) {
      return {
        vertex: vertex.clone(),
        enter: vertex.clone(),
        exit: vertex.clone(),
      }
    }

    const enter = vertex.clone()
      .add(directionToPrev.clone().normalize().multiplyScalar(radius))
    const exit = vertex.clone()
      .add(directionToNext.clone().normalize().multiplyScalar(radius))

    return {
      vertex: vertex.clone(),
      enter,
      exit,
    }
  })

  shape.moveTo(cornerInfos[0]!.enter.x, cornerInfos[0]!.enter.y)
  for (let i = 0; i < cornerInfos.length; i += 1) {
    const current = cornerInfos[i]!
    const next = cornerInfos[(i + 1) % cornerInfos.length]!
    shape.quadraticCurveTo(current.vertex.x, current.vertex.y, current.exit.x, current.exit.y)
    if (current.exit.distanceToSquared(next.enter) > FLOOR_EPSILON) {
      shape.lineTo(next.enter.x, next.enter.y)
    }
  }
  shape.closePath()
  return shape
}

function buildFloorOutlinePoints(definition: FloorDynamicMesh): THREE.Vector2[] {
  const vertices = sanitizeFloorVertices(definition.vertices)
  if (vertices.length < 3) {
    return []
  }
  const points = vertices.map(([x, z]) => new THREE.Vector2(x, -z))
  const shape = createFloorShapeFromPolygon(points, clampFloorSmooth(definition.smooth))
  const extracted = shape.extractPoints(96)
  const raw = Array.isArray(extracted?.shape) && extracted.shape.length ? extracted.shape : points
  const outline: THREE.Vector2[] = []
  for (const entry of raw) {
    if (!entry) {
      continue
    }
    const x = Number(entry.x)
    const y = Number(entry.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }
    const nextPoint = new THREE.Vector2(x, y)
    const prev = outline[outline.length - 1]
    if (prev && prev.distanceToSquared(nextPoint) <= FLOOR_EPSILON) {
      continue
    }
    outline.push(nextPoint)
  }
  if (outline.length >= 2) {
    const first = outline[0]!
    const last = outline[outline.length - 1]!
    if (first.distanceToSquared(last) <= FLOOR_EPSILON) {
      outline.pop()
    }
  }
  return outline
}

function createFloorSignature(definition: FloorDynamicMesh, outline: THREE.Vector2[], thickness: number): string {
  let hash = 2166136261
  const quantize = 1000
  const fnv = (value: number) => {
    hash ^= value
    hash = Math.imul(hash, 16777619) >>> 0
  }
  outline.forEach((point) => {
    fnv(Math.round(point.x * quantize) | 0)
    fnv(Math.round(point.y * quantize) | 0)
  })
  fnv(Math.round(clampFloorSmooth(definition.smooth) * quantize) | 0)
  fnv(Math.round(thickness * quantize) | 0)
  return `f:${outline.length}:${hash.toString(16)}`
}

function buildTrianglePrismShape(
  a: THREE.Vector2,
  b: THREE.Vector2,
  c: THREE.Vector2,
  thickness: number,
): Extract<RigidbodyPhysicsShape, { kind: 'convex' }> | null {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const acx = c.x - a.x
  const acy = c.y - a.y
  const area2 = Math.abs(abx * acy - aby * acx)
  if (!Number.isFinite(area2) || area2 <= FLOOR_EPSILON) {
    return null
  }
  const vertices: [number, number, number][] = [
    [a.x, 0, -a.y],
    [b.x, 0, -b.y],
    [c.x, 0, -c.y],
    [a.x, thickness, -a.y],
    [b.x, thickness, -b.y],
    [c.x, thickness, -c.y],
  ]
  const faces = [
    [0, 2, 1],
    [3, 4, 5],
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [2, 0, 3, 5],
  ]
  return {
    kind: 'convex',
    vertices,
    faces,
    offset: [0, 0, 0],
    applyScale: false,
  }
}

function clampModelCollisionThickness(value: unknown, fallback: unknown): number {
  const primary = Number(value)
  const secondary = Number(fallback)
  const raw = Number.isFinite(primary) ? primary : secondary
  if (!Number.isFinite(raw)) {
    return MODEL_COLLISION_DEFAULT_THICKNESS
  }
  return Math.max(MODEL_COLLISION_MIN_THICKNESS, raw)
}

function sanitizeModelCollisionVertices(
  vertices: ModelCollisionDynamicMesh['faces'][number]['vertices'],
): THREE.Vector3[] {
  const sanitized: THREE.Vector3[] = []
  for (const vertex of Array.isArray(vertices) ? vertices : []) {
    const x = Number(vertex?.x)
    const y = Number(vertex?.y)
    const z = Number(vertex?.z)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue
    }
    const next = new THREE.Vector3(x, y, z)
    const previous = sanitized[sanitized.length - 1]
    if (previous && previous.distanceToSquared(next) <= MODEL_COLLISION_EPSILON * MODEL_COLLISION_EPSILON) {
      continue
    }
    sanitized.push(next)
  }
  if (sanitized.length >= 3) {
    const first = sanitized[0]!
    const last = sanitized[sanitized.length - 1]!
    if (first.distanceToSquared(last) <= MODEL_COLLISION_EPSILON * MODEL_COLLISION_EPSILON) {
      sanitized.pop()
    }
  }
  return sanitized
}

function computeModelCollisionFaceNormal(vertices: THREE.Vector3[]): THREE.Vector3 | null {
  if (vertices.length < 3) {
    return null
  }
  modelCollisionNormalHelper.set(0, 0, 0)
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    modelCollisionNormalHelper.x += (current.y - next.y) * (current.z + next.z)
    modelCollisionNormalHelper.y += (current.z - next.z) * (current.x + next.x)
    modelCollisionNormalHelper.z += (current.x - next.x) * (current.y + next.y)
  }
  if (modelCollisionNormalHelper.lengthSq() <= MODEL_COLLISION_EPSILON * MODEL_COLLISION_EPSILON) {
    for (let index = 2; index < vertices.length; index += 1) {
      modelCollisionEdgeHelperA.subVectors(vertices[index - 1]!, vertices[0]!)
      modelCollisionEdgeHelperB.subVectors(vertices[index]!, vertices[0]!)
      modelCollisionNormalHelper.crossVectors(modelCollisionEdgeHelperA, modelCollisionEdgeHelperB)
      if (modelCollisionNormalHelper.lengthSq() > MODEL_COLLISION_EPSILON * MODEL_COLLISION_EPSILON) {
        break
      }
    }
  }
  if (modelCollisionNormalHelper.lengthSq() <= MODEL_COLLISION_EPSILON * MODEL_COLLISION_EPSILON) {
    return null
  }
  return modelCollisionNormalHelper.clone().normalize()
}

function buildModelCollisionBasis(normal: THREE.Vector3): { tangent: THREE.Vector3; bitangent: THREE.Vector3 } {
  const seed = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const tangent = seed.cross(normal).normalize()
  const bitangent = normal.clone().cross(tangent).normalize()
  return { tangent, bitangent }
}

function buildModelCollisionTrianglePrismShape(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  normal: THREE.Vector3,
  thickness: number,
): Extract<RigidbodyPhysicsShape, { kind: 'convex' }> | null {
  modelCollisionEdgeHelperA.subVectors(b, a)
  modelCollisionEdgeHelperB.subVectors(c, a)
  modelCollisionNormalHelper.crossVectors(modelCollisionEdgeHelperA, modelCollisionEdgeHelperB)
  if (modelCollisionNormalHelper.lengthSq() <= MODEL_COLLISION_EPSILON * MODEL_COLLISION_EPSILON) {
    return null
  }
  const halfThickness = Math.max(MODEL_COLLISION_MIN_THICKNESS, thickness) * 0.5
  const offset = normal.clone().multiplyScalar(halfThickness)
  const vertices: RigidbodyVector3Tuple[] = [
    [a.x - offset.x, a.y - offset.y, a.z - offset.z],
    [b.x - offset.x, b.y - offset.y, b.z - offset.z],
    [c.x - offset.x, c.y - offset.y, c.z - offset.z],
    [a.x + offset.x, a.y + offset.y, a.z + offset.z],
    [b.x + offset.x, b.y + offset.y, b.z + offset.z],
    [c.x + offset.x, c.y + offset.y, c.z + offset.z],
  ]
  return {
    kind: 'convex',
    vertices,
    faces: [
      [0, 2, 1],
      [3, 4, 5],
      [0, 1, 4, 3],
      [1, 2, 5, 4],
      [2, 0, 3, 5],
    ],
    offset: [0, 0, 0],
    applyScale: false,
  }
}

export function resolveModelCollisionFaceSegments(
  definition: ModelCollisionDynamicMesh,
): Array<{ shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }> }> {
  const segments: Array<{ shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }> }> = []
  for (const face of Array.isArray(definition.faces) ? definition.faces : []) {
    const vertices = sanitizeModelCollisionVertices(face?.vertices ?? [])
    if (vertices.length < 3) {
      continue
    }
    const normal = computeModelCollisionFaceNormal(vertices)
    if (!normal) {
      continue
    }
    const { tangent, bitangent } = buildModelCollisionBasis(normal)
    modelCollisionOriginHelper.set(0, 0, 0)
    vertices.forEach((vertex) => modelCollisionOriginHelper.add(vertex))
    modelCollisionOriginHelper.multiplyScalar(1 / vertices.length)
    const outline2D: THREE.Vector2[] = []
    const planarVertices: THREE.Vector3[] = []
    for (const vertex of vertices) {
      modelCollisionProjectedHelper.copy(vertex).sub(modelCollisionOriginHelper)
      const u = modelCollisionProjectedHelper.dot(tangent)
      const v = modelCollisionProjectedHelper.dot(bitangent)
      outline2D.push(new THREE.Vector2(u, v))
      planarVertices.push(
        modelCollisionOriginHelper.clone()
          .addScaledVector(tangent, u)
          .addScaledVector(bitangent, v),
      )
    }
    const triangles = THREE.ShapeUtils.triangulateShape(outline2D, [])
    const thickness = clampModelCollisionThickness(face?.thickness, definition.defaultThickness)
    for (const triangle of triangles) {
      if (!Array.isArray(triangle) || triangle.length !== 3) {
        continue
      }
      const a = planarVertices[triangle[0] ?? -1]
      const b = planarVertices[triangle[1] ?? -1]
      const c = planarVertices[triangle[2] ?? -1]
      if (!a || !b || !c) {
        continue
      }
      const shape = buildModelCollisionTrianglePrismShape(a, b, c, normal, thickness)
      if (shape) {
        segments.push({ shape })
      }
    }
  }
  return segments
}

export function resolveFloorShape(
  node: SceneNode,
  definition: FloorDynamicMesh,
  cache: FloorShapeCache,
): FloorShapeCacheEntry | null {
  const nodeId = node.id
  const thickness = clampFloorThickness(definition.thickness)
  if (thickness <= FLOOR_EPSILON) {
    cache.delete(nodeId)
    return null
  }
  const outline = buildFloorOutlinePoints(definition)
  if (outline.length < 3) {
    cache.delete(nodeId)
    return null
  }
  const signature = createFloorSignature(definition, outline, thickness)
  const cached = cache.get(nodeId)
  if (cached && cached.signature === signature) {
    return cached
  }
  const triangles = THREE.ShapeUtils.triangulateShape(outline, [])
  const segments: FloorShapeCacheEntry['segments'] = []
  triangles.forEach((triangle) => {
    if (!Array.isArray(triangle) || triangle.length !== 3) {
      return
    }
    const a = outline[triangle[0] ?? -1]
    const b = outline[triangle[1] ?? -1]
    const c = outline[triangle[2] ?? -1]
    if (!a || !b || !c) {
      return
    }
    const shape = buildTrianglePrismShape(a, b, c, thickness)
    if (shape) {
      segments.push({ shape })
    }
  })
  if (!segments.length) {
    cache.delete(nodeId)
    return null
  }
  const entry: FloorShapeCacheEntry = { signature, segments }
  cache.set(nodeId, entry)
  return entry
}

export function resolveWallShape(params: {
  node: SceneNode
  definition: WallDynamicMesh
  cache: WallTrimeshCache
  loggerTag?: LoggerTag
}): WallTrimeshCacheEntry | null {
  const { node, definition, cache, loggerTag } = params
  const nodeId = node.id
  if (!nodeId) {
    return null
  }

  const rawSegments = compileWallSegmentsFromDefinition(definition)
  if (!rawSegments.length) {
    cache.delete(nodeId)
    return null
  }

  const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<Record<string, unknown>> | undefined
  const wallProps = wallComponent?.props
    ? clampWallProps(wallComponent.props as Partial<ReturnType<typeof clampWallProps>>)
    : null
  const forbiddenCollider = Boolean(wallComponent?.enabled !== false && wallProps?.forbidden)

  let hash = 2166136261
  const quantize = 1000
  const fnv = (value: number) => {
    hash ^= value
    hash = Math.imul(hash, 16777619) >>> 0
  }
  for (const segment of rawSegments) {
    const sx = Number((segment as any)?.start?.x)
    const sy = Number((segment as any)?.start?.y)
    const sz = Number((segment as any)?.start?.z)
    const ex = Number((segment as any)?.end?.x)
    const ey = Number((segment as any)?.end?.y)
    const ez = Number((segment as any)?.end?.z)
    const h = Number((segment as any)?.height)
    const w = Number((segment as any)?.width)
    const t = Number((segment as any)?.thickness)
    const values = [sx, sy, sz, ex, ey, ez, h, w, t]
    for (const value of values) {
      const q = Number.isFinite(value) ? Math.round(value * quantize) : 0
      fnv(q | 0)
    }
  }
  fnv(forbiddenCollider ? 1 : 0)
  if (forbiddenCollider) {
    fnv(Math.round(WALL_FORBIDDEN_COLLIDER_HEIGHT * quantize) | 0)
  }
  const signature = `s:${rawSegments.length}:${hash.toString(16)}`
  const cached = cache.get(nodeId)
  if (cached && cached.signature === signature) {
    return cached
  }

  try {
    const segments: WallTrimeshCacheEntry['segments'] = []
    const eps = 1e-3
    for (const segment of rawSegments) {
      const start = (segment as any)?.start as { x?: unknown; y?: unknown; z?: unknown } | undefined
      const end = (segment as any)?.end as { x?: unknown; y?: unknown; z?: unknown } | undefined
      const sx = Number(start?.x)
      const sy = Number(start?.y)
      const sz = Number(start?.z)
      const ex = Number(end?.x)
      const ey = Number(end?.y)
      const ez = Number(end?.z)
      if (!Number.isFinite(sx + sy + sz + ex + ey + ez)) {
        continue
      }
      wallStartHelper.set(sx, sy, sz)
      wallEndHelper.set(ex, ey, ez)
      wallDirHelper.subVectors(wallEndHelper, wallStartHelper)
      wallDirHelper.y = 0
      const length = wallDirHelper.length()
      if (!Number.isFinite(length) || length <= eps) {
        continue
      }
      wallUnitDirHelper.copy(wallDirHelper).multiplyScalar(1 / length)
      wallQuatThreeHelper.setFromUnitVectors(wallAxisXHelper, wallUnitDirHelper)

      const rawHeight = Number((segment as any)?.height)
      const rawWidth = Number((segment as any)?.width)
      const rawThickness = Number((segment as any)?.thickness)
      const visibleHeight = Number.isFinite(rawHeight) ? Math.max(eps, rawHeight) : 3
      const height = forbiddenCollider ? Math.max(visibleHeight, WALL_FORBIDDEN_COLLIDER_HEIGHT) : visibleHeight
      const thickness = Number.isFinite(rawWidth)
        ? Math.max(eps, rawWidth)
        : (Number.isFinite(rawThickness) ? Math.max(eps, rawThickness) : 0.2)

      const hx = Math.max(eps, length * 0.5)
      const hy = Math.max(eps, height * 0.5)
      const hz = Math.max(eps, thickness * 0.5)
      const cx = (sx + ex) * 0.5
      const cz = (sz + ez) * 0.5
      const baseY = (sy + ey) * 0.5
      const cy = baseY + hy

      segments.push({
        halfExtents: [hx, hy, hz],
        offset: [cx, cy, cz],
        orientation: [wallQuatThreeHelper.x, wallQuatThreeHelper.y, wallQuatThreeHelper.z, wallQuatThreeHelper.w],
      })
    }

    if (!segments.length) {
      cache.delete(nodeId)
      return null
    }
    const entry: WallTrimeshCacheEntry = { signature, segments }
    cache.set(nodeId, entry)
    return entry
  } catch (error) {
    warn(loggerTag, 'Failed to build wall colliders', error)
    cache.delete(nodeId)
    return null
  }
}
