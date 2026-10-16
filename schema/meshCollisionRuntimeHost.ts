import * as THREE from 'three'

import type { StaticMeshCollisionShapeDefinition } from './groundCollisionRuntimeBridge'
import { GROUND_COLLISION_RADIUS_METERS } from './groundCollisionRuntimeConstants'
import type {
  PhysicsBodyBindingEntry as RigidbodyInstance,
  PhysicsBodyLike,
  PhysicsOrientationAdjustment,
} from './physicsBodySync'
import {
  type PhysicsWorldLike,
  addPhysicsBodyToWorld,
  removePhysicsBodyBindingBodies,
} from './physicsRuntimeBridge'

// Mesh driven collision runtime.
//
// Scene nodes tagged with the `groundCollisionSource` component reuse the Ground Anchor
// probe points: triangles near a probe become static triangle mesh bodies and are
// destroyed again once every probe moved away.
//
// The indexed mesh set is not frozen: components may add or rebuild their meshes long
// after the first sync (the procedural landscape only creates its road band / walls once
// the terrain grid finished rasterizing). Every sync therefore compares a lightweight
// per-mesh signature of the source subtree and applies the difference incrementally:
// meshes that appeared get new chunks, meshes that disappeared / were hidden / swapped
// their geometry lose theirs, and unchanged meshes keep their resident bodies untouched
// (no collision gap while re-indexing).

/** Probe distance at which a collision chunk is created. */
export const MESH_COLLISION_ACTIVATION_RADIUS_METERS = GROUND_COLLISION_RADIUS_METERS
/** Probe distance at which a resident collision chunk is kept (hysteresis band). */
export const MESH_COLLISION_RETENTION_RADIUS_METERS = GROUND_COLLISION_RADIUS_METERS + 50
/** Maximum number of resident collision chunks per source node. */
export const MESH_COLLISION_MAX_RESIDENT_CHUNKS = 64
/** Maximum number of collision chunks created per sync call. */
export const MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC = 2
/**
 * Raised per-sync chunk budget while re-indexing after the collision mesh set changed
 * (a late added road band / rebuilt wall layer must become solid within a sync or two).
 * Falls back to `MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC` once nothing is pending.
 */
export const MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC_AFTER_CHANGE = 8
/** Grid cell size used when a sub mesh is too large to become a single chunk. */
export const MESH_COLLISION_CELL_SIZE_METERS = 128
/** Sub mesh triangle count above which the mesh gets spatially subdivided. */
export const MESH_COLLISION_MAX_TRIANGLES_PER_CHUNK = 20000
/** Sub mesh world extent above which the mesh gets spatially subdivided. */
export const MESH_COLLISION_SUBDIVIDE_EXTENT_METERS = 256
/** Smallest subdivision cell size; denser cells are skipped with a single warning. */
export const MESH_COLLISION_MIN_CELL_SIZE_METERS = 16
/** Indexing work budget (triangles) consumed per sync call. */
export const MESH_COLLISION_INDEX_TRIANGLES_PER_TICK = 200000
/** `userData` key: lazily assigned stable serial identifying a collision mesh. */
const MESH_COLLISION_MESH_SERIAL_KEY = '__meshCollisionSerial'
/** `userData` key (BufferGeometry): lazily assigned stable serial per geometry. */
const MESH_COLLISION_GEOMETRY_SERIAL_KEY = '__meshCollisionGeometrySerial'

export type MeshCollisionChunkShape = StaticMeshCollisionShapeDefinition

export type MeshCollisionRuntimeDeps = {
  getPhysicsWorld: () => PhysicsWorldLike | null
  ensurePhysicsWorld: () => PhysicsWorldLike
  createBody: (
    shapeDefinition: MeshCollisionChunkShape,
    object: THREE.Object3D,
  ) => { body: PhysicsBodyLike; orientationAdjustment: PhysicsOrientationAdjustment | null } | null
}

export type SyncMeshCollisionRuntimeHostParams = {
  enabled: boolean
  sourceId: string
  sourceObject: THREE.Object3D | null | undefined
  referenceWorldPositions: readonly THREE.Vector3[] | null | undefined
  runtimeDeps?: MeshCollisionRuntimeDeps | null | undefined
  loggerTag?: string
}

export type MeshCollisionRuntimeHostSnapshot = {
  activeChunkKeys: string[]
  chunkCount: number
  indexing: boolean
  /** Chunks inside the activation radius that are still waiting for their create budget. */
  pendingChunkCount: number
}

type MeshCollisionChunkBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type MeshCollisionMeshSource = {
  mesh: THREE.Mesh
  /** World matrix snapshot; the source node is treated as static. */
  matrixWorld: THREE.Matrix4
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  index: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null
  triangleCount: number
  vertexCount: number
  needsSubdivision: boolean
  bounds: MeshCollisionChunkBounds
}

type MeshCollisionChunk = MeshCollisionChunkBounds & {
  key: string
  meshIndex: number
  /** `null` means "every triangle of the mesh". */
  triangles: Int32Array | null
  triangleCount: number
}

type MeshCollisionMeshEntry = {
  /** `${meshSerial}:${geometrySerial}` — stable while mesh object and geometry stay the same. */
  signature: string
  /** Index into `sources`; `null` when the mesh cannot produce a collision source. */
  sourceIndex: number | null
}

type MeshCollisionMeshEntryCandidate = {
  signature: string
  object: THREE.Object3D
}

type MeshCollisionHostState = {
  sourceId: string
  phase: 'collect' | 'subdivide' | 'ready'
  traversalStack: THREE.Object3D[]
  /** Collision sources by index; `null` marks a retired mesh (index never reused). */
  sources: Array<MeshCollisionMeshSource | null>
  chunks: MeshCollisionChunk[]
  /** Ordered signatures of the indexed collision meshes (traversal order). */
  meshEntries: MeshCollisionMeshEntry[]
  sourceIndex: number
  triangleCursor: number
  buckets: Map<string, number[]> | null
  instances: Map<string, RigidbodyInstance>
  oversizeWarned: boolean
  /** Raised chunk-creation budget active while re-indexing a changed mesh set. */
  burst: boolean
  lastDeps: MeshCollisionRuntimeDeps | null
}

type MeshCollisionChunkCandidate = {
  chunk: MeshCollisionChunk
  distanceSq: number
}

const meshCollisionHostStateMap = new WeakMap<THREE.Object3D, MeshCollisionHostState>()
const meshCollisionHostObjects = new Set<THREE.Object3D>()

const meshCollisionVertexHelper = new THREE.Vector3()
const meshCollisionCentroidHelper = new THREE.Vector3()
const meshCollisionBoxCornerHelper = new THREE.Vector3()

const EMPTY_MESH_COLLISION_SNAPSHOT: MeshCollisionRuntimeHostSnapshot = {
  activeChunkKeys: [],
  chunkCount: 0,
  indexing: false,
  pendingChunkCount: 0,
}

let meshCollisionMeshSerialCounter = 0
let meshCollisionGeometrySerialCounter = 0

function resolveCollisionMeshSerial(mesh: THREE.Object3D): number {
  const stored = mesh.userData[MESH_COLLISION_MESH_SERIAL_KEY]
  if (typeof stored === 'number' && Number.isFinite(stored)) {
    return stored
  }
  meshCollisionMeshSerialCounter += 1
  mesh.userData[MESH_COLLISION_MESH_SERIAL_KEY] = meshCollisionMeshSerialCounter
  return meshCollisionMeshSerialCounter
}

function resolveCollisionGeometrySerial(geometry: THREE.BufferGeometry): number {
  const stored = geometry.userData[MESH_COLLISION_GEOMETRY_SERIAL_KEY]
  if (typeof stored === 'number' && Number.isFinite(stored)) {
    return stored
  }
  meshCollisionGeometrySerialCounter += 1
  geometry.userData[MESH_COLLISION_GEOMETRY_SERIAL_KEY] = meshCollisionGeometrySerialCounter
  return meshCollisionGeometrySerialCounter
}

function resolveCollisionMeshSignature(mesh: THREE.Object3D, geometry: THREE.BufferGeometry): string {
  return `${resolveCollisionMeshSerial(mesh)}:${resolveCollisionGeometrySerial(geometry)}`
}

/**
 * Cheap eligibility check shared by the budgeted collection and the per-sync change
 * detection; both must agree so a signature never skips a mesh the collector accepts.
 * Instanced meshes (grass / bushes / tree cards) stay out of collision on purpose.
 */
function isCollisionEligibleMesh(object: THREE.Object3D): boolean {
  const mesh = object as THREE.Mesh & {
    isMesh?: boolean
    isInstancedMesh?: boolean
  }
  if (mesh.isMesh !== true || mesh.isInstancedMesh === true) {
    return false
  }
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined
  if (!geometry) {
    return false
  }
  const position = geometry.getAttribute('position')
  if (!position || position.itemSize < 3 || position.count < 3) {
    return false
  }
  const index = geometry.getIndex()
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
  return triangleCount > 0
}

/**
 * Walks the source subtree (visibility aware, same order as the budgeted collection)
 * and returns every collision-eligible mesh together with its signature.
 */
function collectCollisionMeshEntryCandidates(
  sourceObject: THREE.Object3D,
): MeshCollisionMeshEntryCandidate[] {
  const entries: MeshCollisionMeshEntryCandidate[] = []
  const stack: THREE.Object3D[] = [sourceObject]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || current.visible === false) {
      continue
    }
    if (isCollisionEligibleMesh(current)) {
      const geometry = (current as THREE.Mesh).geometry as THREE.BufferGeometry
      entries.push({
        signature: resolveCollisionMeshSignature(current, geometry),
        object: current,
      })
    }
    if (current.children.length > 0) {
      stack.push(...current.children)
    }
  }
  return entries
}

function hasCollisionMeshSetChanged(
  entries: readonly MeshCollisionMeshEntryCandidate[],
  state: MeshCollisionHostState,
): boolean {
  if (entries.length !== state.meshEntries.length) {
    return true
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]!.signature !== state.meshEntries[index]!.signature) {
      return true
    }
  }
  return false
}

/**
 * Incremental re-index: unchanged meshes keep their sources, chunks and resident bodies
 * untouched; vanished / hidden / geometry-swapped meshes are retired (chunks dropped,
 * bodies released); meshes that appeared after the initial collection are appended and
 * fed through the budgeted subdivision + chunk creation path.
 */
function applyCollisionMeshSetChanges(
  state: MeshCollisionHostState,
  entries: readonly MeshCollisionMeshEntryCandidate[],
  deps: MeshCollisionRuntimeDeps | null,
): void {
  const presentSignatures = new Set(entries.map((entry) => entry.signature))
  const retiredSourceIndexes = new Set<number>()
  state.meshEntries.forEach((entry) => {
    if (entry.sourceIndex == null || presentSignatures.has(entry.signature)) {
      return
    }
    retiredSourceIndexes.add(entry.sourceIndex)
  })

  if (retiredSourceIndexes.size > 0) {
    state.chunks = state.chunks.filter((chunk) => {
      if (!retiredSourceIndexes.has(chunk.meshIndex)) {
        return true
      }
      const instance = state.instances.get(chunk.key)
      if (instance) {
        removeChunkInstance(deps, instance)
        state.instances.delete(chunk.key)
      }
      return false
    })
    retiredSourceIndexes.forEach((index) => {
      state.sources[index] = null
    })
  }

  const keptSourceIndexes = new Map<string, number>()
  state.meshEntries.forEach((entry) => {
    if (entry.sourceIndex != null && presentSignatures.has(entry.signature)) {
      keptSourceIndexes.set(entry.signature, entry.sourceIndex)
    }
  })

  let appendedSources = false
  state.meshEntries = entries.map((entry) => {
    const kept = keptSourceIndexes.get(entry.signature)
    if (kept != null) {
      return { signature: entry.signature, sourceIndex: kept }
    }
    const source = resolveMeshSource(entry.object)
    if (!source) {
      return { signature: entry.signature, sourceIndex: null }
    }
    state.sources.push(source)
    appendedSources = true
    return { signature: entry.signature, sourceIndex: state.sources.length - 1 }
  })

  if (appendedSources) {
    // Every older source is fully processed before the state turns `ready`, so the
    // cursor already sits on the first appended source.
    state.sourceIndex = Math.min(state.sourceIndex, state.sources.length)
    state.phase = 'subdivide'
    state.triangleCursor = 0
    state.buckets = null
    state.burst = true
  }
}

function resolveMeshSource(object: THREE.Object3D): MeshCollisionMeshSource | null {
  if (!isCollisionEligibleMesh(object)) {
    return null
  }
  const mesh = object as THREE.Mesh
  const geometry = mesh.geometry as THREE.BufferGeometry
  const position = geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | undefined
  if (!position) {
    return null
  }
  const indexAttribute = geometry.getIndex() as
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | null
  const triangleCount = indexAttribute
    ? Math.floor(indexAttribute.count / 3)
    : Math.floor(position.count / 3)
  if (triangleCount <= 0) {
    return null
  }
  mesh.updateWorldMatrix(true, false)
  const matrixWorld = mesh.matrixWorld.clone()
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }
  const box = geometry.boundingBox
  if (!box || box.isEmpty()) {
    return null
  }
  const bounds = resolveWorldXZBoundsFromBox(box, matrixWorld)
  const extentX = bounds.maxX - bounds.minX
  const extentZ = bounds.maxZ - bounds.minZ
  return {
    mesh,
    matrixWorld,
    position,
    index: indexAttribute,
    triangleCount,
    vertexCount: position.count,
    needsSubdivision: triangleCount > MESH_COLLISION_MAX_TRIANGLES_PER_CHUNK
      || Math.max(extentX, extentZ) > MESH_COLLISION_SUBDIVIDE_EXTENT_METERS,
    bounds,
  }
}

function resolveWorldXZBoundsFromBox(
  box: THREE.Box3,
  matrixWorld: THREE.Matrix4,
): MeshCollisionChunkBounds {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let corner = 0; corner < 8; corner += 1) {
    meshCollisionBoxCornerHelper
      .set(
        corner & 1 ? box.max.x : box.min.x,
        corner & 2 ? box.max.y : box.min.y,
        corner & 4 ? box.max.z : box.min.z,
      )
      .applyMatrix4(matrixWorld)
    minX = Math.min(minX, meshCollisionBoxCornerHelper.x)
    maxX = Math.max(maxX, meshCollisionBoxCornerHelper.x)
    minZ = Math.min(minZ, meshCollisionBoxCornerHelper.z)
    maxZ = Math.max(maxZ, meshCollisionBoxCornerHelper.z)
  }
  return { minX, maxX, minZ, maxZ }
}

function readMeshVertex(
  source: MeshCollisionMeshSource,
  vertexOffset: number,
  target: THREE.Vector3,
): void {
  const positionIndex = source.index ? source.index.getX(vertexOffset) : vertexOffset
  target.set(
    source.position.getX(positionIndex),
    source.position.getY(positionIndex),
    source.position.getZ(positionIndex),
  )
}

function computeTriangleWorldCentroid(
  source: MeshCollisionMeshSource,
  triangleIndex: number,
  target: THREE.Vector3,
): void {
  const offset = triangleIndex * 3
  target.set(0, 0, 0)
  for (let corner = 0; corner < 3; corner += 1) {
    readMeshVertex(source, offset + corner, meshCollisionVertexHelper)
    target.add(meshCollisionVertexHelper)
  }
  target.multiplyScalar(1 / 3).applyMatrix4(source.matrixWorld)
}

function computeTrianglesWorldBounds(
  source: MeshCollisionMeshSource,
  triangles: ArrayLike<number>,
): MeshCollisionChunkBounds {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let entry = 0; entry < triangles.length; entry += 1) {
    const offset = (triangles[entry] ?? 0) * 3
    for (let corner = 0; corner < 3; corner += 1) {
      readMeshVertex(source, offset + corner, meshCollisionVertexHelper)
      meshCollisionVertexHelper.applyMatrix4(source.matrixWorld)
      minX = Math.min(minX, meshCollisionVertexHelper.x)
      maxX = Math.max(maxX, meshCollisionVertexHelper.x)
      minZ = Math.min(minZ, meshCollisionVertexHelper.z)
      maxZ = Math.max(maxZ, meshCollisionVertexHelper.z)
    }
  }
  return { minX, maxX, minZ, maxZ }
}

function createHostState(sourceId: string, sourceObject: THREE.Object3D): MeshCollisionHostState {
  return {
    sourceId,
    phase: 'collect',
    traversalStack: [sourceObject],
    sources: [],
    chunks: [],
    meshEntries: [],
    sourceIndex: 0,
    triangleCursor: 0,
    buckets: null,
    instances: new Map(),
    oversizeWarned: false,
    burst: false,
    lastDeps: null,
  }
}

function ensureHostState(sourceObject: THREE.Object3D, sourceId: string): MeshCollisionHostState {
  const existing = meshCollisionHostStateMap.get(sourceObject)
  if (existing) {
    return existing
  }
  const state = createHostState(sourceId, sourceObject)
  meshCollisionHostStateMap.set(sourceObject, state)
  meshCollisionHostObjects.add(sourceObject)
  return state
}

function advanceCollection(state: MeshCollisionHostState, budget: number): number {
  let remaining = budget
  while (remaining > 0 && state.traversalStack.length > 0) {
    const current = state.traversalStack.pop()
    if (!current) {
      continue
    }
    // Collision follows visibility: a hidden mesh (and its subtree) contributes nothing,
    // matching what the player can see.
    if (current.visible === false) {
      remaining -= 1
      continue
    }
    let source: MeshCollisionMeshSource | null = null
    if (isCollisionEligibleMesh(current)) {
      const geometry = (current as THREE.Mesh).geometry as THREE.BufferGeometry
      state.meshEntries.push({
        signature: resolveCollisionMeshSignature(current, geometry),
        sourceIndex: null,
      })
      source = resolveMeshSource(current)
      if (source) {
        state.sources.push(source)
        state.meshEntries[state.meshEntries.length - 1]!.sourceIndex = state.sources.length - 1
      }
    }
    if (source) {
      remaining -= Math.max(1, Math.ceil(source.vertexCount / 3))
    } else {
      remaining -= 1
    }
    if (current.children.length > 0) {
      state.traversalStack.push(...current.children)
    }
  }
  if (state.traversalStack.length === 0) {
    state.phase = state.sources.length > 0 ? 'subdivide' : 'ready'
  }
  return Math.max(0, remaining)
}

function bucketMeshTriangles(
  state: MeshCollisionHostState,
  source: MeshCollisionMeshSource,
  budget: number,
): number {
  const buckets = state.buckets
  if (!buckets) {
    return 0
  }
  const start = state.triangleCursor
  const end = Math.min(source.triangleCount, start + Math.max(1, Math.floor(budget)))
  for (let triangleIndex = start; triangleIndex < end; triangleIndex += 1) {
    computeTriangleWorldCentroid(source, triangleIndex, meshCollisionCentroidHelper)
    const cellX = Math.floor(meshCollisionCentroidHelper.x / MESH_COLLISION_CELL_SIZE_METERS)
    const cellZ = Math.floor(meshCollisionCentroidHelper.z / MESH_COLLISION_CELL_SIZE_METERS)
    const key = `${cellX}|${cellZ}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(triangleIndex)
    } else {
      buckets.set(key, [triangleIndex])
    }
  }
  state.triangleCursor = end
  return end - start
}

function createWholeMeshChunk(
  source: MeshCollisionMeshSource,
  meshIndex: number,
): MeshCollisionChunk {
  return {
    key: `mesh:${meshIndex}`,
    meshIndex,
    triangles: null,
    triangleCount: source.triangleCount,
    ...source.bounds,
  }
}

function createSubdividedChunk(
  source: MeshCollisionMeshSource,
  meshIndex: number,
  triangles: number[],
  cellX: number,
  cellZ: number,
  cellSize: number,
): MeshCollisionChunk {
  const cellSizeKey = Math.round(cellSize * 100) / 100
  return {
    key: `mesh:${meshIndex}:cell:${cellX}:${cellZ}:${cellSizeKey}`,
    meshIndex,
    triangles: Int32Array.from(triangles),
    triangleCount: triangles.length,
    ...computeTrianglesWorldBounds(source, triangles),
  }
}

function appendBucketChunks(
  state: MeshCollisionHostState,
  source: MeshCollisionMeshSource,
  meshIndex: number,
  triangles: number[],
  cellX: number,
  cellZ: number,
  cellSize: number,
): void {
  if (triangles.length <= MESH_COLLISION_MAX_TRIANGLES_PER_CHUNK) {
    state.chunks.push(createSubdividedChunk(source, meshIndex, triangles, cellX, cellZ, cellSize))
    return
  }
  if (cellSize <= MESH_COLLISION_MIN_CELL_SIZE_METERS) {
    if (!state.oversizeWarned) {
      state.oversizeWarned = true
      console.warn(
        '[MeshCollision] Skipping oversized collision chunk',
        JSON.stringify({
          sourceId: state.sourceId,
          meshIndex,
          cellX,
          cellZ,
          cellSize,
          triangles: triangles.length,
        }),
      )
    }
    return
  }
  const half = cellSize * 0.5
  const splitX = (cellX + 0.5) * cellSize
  const splitZ = (cellZ + 0.5) * cellSize
  const quadrants: number[][] = [[], [], [], []]
  triangles.forEach((triangleIndex) => {
    computeTriangleWorldCentroid(source, triangleIndex, meshCollisionCentroidHelper)
    const offsetX = meshCollisionCentroidHelper.x < splitX ? 0 : 1
    const offsetZ = meshCollisionCentroidHelper.z < splitZ ? 0 : 1
    const quadrant = quadrants[offsetZ * 2 + offsetX]
    if (quadrant) {
      quadrant.push(triangleIndex)
    }
  })
  quadrants.forEach((list, index) => {
    if (list.length === 0) {
      return
    }
    const offsetX = index % 2
    const offsetZ = index >= 2 ? 1 : 0
    appendBucketChunks(
      state,
      source,
      meshIndex,
      list,
      cellX * 2 + offsetX,
      cellZ * 2 + offsetZ,
      half,
    )
  })
}

function finalizeSubdividedChunks(
  state: MeshCollisionHostState,
  source: MeshCollisionMeshSource,
  meshIndex: number,
): void {
  const buckets = state.buckets
  if (!buckets) {
    return
  }
  buckets.forEach((triangles, key) => {
    const separatorIndex = key.indexOf('|')
    const cellX = Number(key.slice(0, separatorIndex)) || 0
    const cellZ = Number(key.slice(separatorIndex + 1)) || 0
    appendBucketChunks(
      state,
      source,
      meshIndex,
      triangles,
      cellX,
      cellZ,
      MESH_COLLISION_CELL_SIZE_METERS,
    )
  })
}

function advanceSubdivision(state: MeshCollisionHostState, budget: number): number {
  let remaining = budget
  while (remaining > 0 && state.sourceIndex < state.sources.length) {
    const source = state.sources[state.sourceIndex]
    if (!source) {
      // Retired source (mesh removed / hidden / geometry swapped): skip its slot.
      state.sourceIndex += 1
      state.triangleCursor = 0
      state.buckets = null
      continue
    }
    if (!source.needsSubdivision) {
      state.chunks.push(createWholeMeshChunk(source, state.sourceIndex))
      state.sourceIndex += 1
      state.triangleCursor = 0
      state.buckets = null
      remaining -= 1
      continue
    }
    if (!state.buckets) {
      state.buckets = new Map()
    }
    const processed = bucketMeshTriangles(state, source, remaining)
    remaining -= processed
    if (state.triangleCursor >= source.triangleCount) {
      finalizeSubdividedChunks(state, source, state.sourceIndex)
      state.sourceIndex += 1
      state.triangleCursor = 0
      state.buckets = null
    } else if (processed <= 0) {
      // Guard against a stalled cursor; never spin inside a single sync call.
      break
    }
  }
  if (state.sourceIndex >= state.sources.length) {
    state.phase = 'ready'
  }
  return Math.max(0, remaining)
}

function buildChunkShape(
  source: MeshCollisionMeshSource,
  chunk: MeshCollisionChunk,
): MeshCollisionChunkShape | null {
  const triangleOrdinals = chunk.triangles
  const triangleCount = triangleOrdinals ? triangleOrdinals.length : source.triangleCount
  if (triangleCount <= 0) {
    return null
  }
  const vertices = new Float32Array(triangleCount * 9)
  const indices = new Uint32Array(triangleCount * 3)
  let vertexOffset = 0
  for (let entry = 0; entry < triangleCount; entry += 1) {
    const triangleIndex = triangleOrdinals ? (triangleOrdinals[entry] ?? 0) : entry
    const baseVertex = triangleIndex * 3
    for (let corner = 0; corner < 3; corner += 1) {
      readMeshVertex(source, baseVertex + corner, meshCollisionVertexHelper)
      meshCollisionVertexHelper.applyMatrix4(source.matrixWorld)
      vertices[vertexOffset] = meshCollisionVertexHelper.x
      vertices[vertexOffset + 1] = meshCollisionVertexHelper.y
      vertices[vertexOffset + 2] = meshCollisionVertexHelper.z
      indices[entry * 3 + corner] = entry * 3 + corner
      vertexOffset += 3
    }
  }
  return {
    kind: 'static-mesh',
    vertices,
    indices,
  }
}

function resolveChunkDistanceSq(
  chunk: MeshCollisionChunk,
  references: readonly THREE.Vector3[],
): number {
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index]
    if (!reference) {
      continue
    }
    const dx = reference.x < chunk.minX
      ? chunk.minX - reference.x
      : (reference.x > chunk.maxX ? reference.x - chunk.maxX : 0)
    const dz = reference.z < chunk.minZ
      ? chunk.minZ - reference.z
      : (reference.z > chunk.maxZ ? reference.z - chunk.maxZ : 0)
    const distanceSq = dx * dx + dz * dz
    if (distanceSq < best) {
      best = distanceSq
    }
  }
  return best
}

function createChunkInstance(
  deps: MeshCollisionRuntimeDeps,
  sourceId: string,
  sourceObject: THREE.Object3D,
  source: MeshCollisionMeshSource,
  chunk: MeshCollisionChunk,
): RigidbodyInstance | null {
  const shape = buildChunkShape(source, chunk)
  if (!shape) {
    return null
  }
  const bodyResult = deps.createBody(shape, sourceObject)
  if (!bodyResult?.body) {
    return null
  }
  addPhysicsBodyToWorld(deps.ensurePhysicsWorld(), bodyResult.body)
  ;(bodyResult.body as PhysicsBodyLike & { name?: string }).name = `terrain-collision:${sourceId}:${chunk.key}`
  return {
    nodeId: sourceId,
    body: bodyResult.body,
    bodies: [bodyResult.body],
    object: sourceObject,
    orientationAdjustment: bodyResult.orientationAdjustment,
    syncObjectFromBody: false,
    signature: `${sourceId}|${chunk.key}`,
  }
}

function removeChunkInstance(
  deps: MeshCollisionRuntimeDeps | null,
  instance: RigidbodyInstance,
): void {
  if (!deps) {
    return
  }
  removePhysicsBodyBindingBodies(deps.getPhysicsWorld(), instance)
}

function isLazyPlaceholderObject(object: THREE.Object3D | null | undefined): boolean {
  const lazyData = object?.userData?.lazyAsset as { placeholder?: unknown } | undefined
  return Boolean(lazyData?.placeholder)
}

// Lazy loaded scene nodes keep a placeholder object instead of the real meshes, so the
// collision index must wait until the detailed model replaced it.
function isSourceObjectLazyPlaceholder(object: THREE.Object3D): boolean {
  if (isLazyPlaceholderObject(object)) {
    return true
  }
  return object.children.some((child) => isLazyPlaceholderObject(child))
}

export function syncMeshCollisionRuntimeHost(
  params: SyncMeshCollisionRuntimeHostParams,
): MeshCollisionRuntimeHostSnapshot {
  const sourceObject = params.sourceObject ?? null
  const references = Array.isArray(params.referenceWorldPositions)
    ? params.referenceWorldPositions.filter((position) => Boolean(position))
    : []
  if (!params.enabled || !sourceObject || references.length === 0 || !params.runtimeDeps) {
    clearMeshCollisionRuntimeHost(sourceObject)
    return EMPTY_MESH_COLLISION_SNAPSHOT
  }
  if (isSourceObjectLazyPlaceholder(sourceObject)) {
    clearMeshCollisionRuntimeHost(sourceObject)
    return {
      activeChunkKeys: [],
      chunkCount: 0,
      indexing: true,
      pendingChunkCount: 0,
    }
  }

  const deps = params.runtimeDeps
  const state = ensureHostState(sourceObject, params.sourceId)
  state.sourceId = params.sourceId
  state.lastDeps = deps

  // Components may keep adding / rebuilding their meshes after the initial collection
  // (the procedural landscape's road band is created once the terrain grid finished).
  // Detect those changes and re-index the delta instead of freezing the first snapshot.
  if (state.phase === 'ready') {
    const entries = collectCollisionMeshEntryCandidates(sourceObject)
    if (hasCollisionMeshSetChanged(entries, state)) {
      applyCollisionMeshSetChanges(state, entries, deps)
    }
  }

  if (state.phase !== 'ready') {
    let budget: number = MESH_COLLISION_INDEX_TRIANGLES_PER_TICK
    if (state.phase === 'collect') {
      budget = advanceCollection(state, budget)
    }
    if (state.phase === 'subdivide' && budget > 0) {
      advanceSubdivision(state, budget)
    }
  }
  if (state.phase !== 'ready') {
    return {
      activeChunkKeys: Array.from(state.instances.keys()).sort(),
      chunkCount: state.instances.size,
      indexing: true,
      pendingChunkCount: 0,
    }
  }

  const activationSq = MESH_COLLISION_ACTIVATION_RADIUS_METERS * MESH_COLLISION_ACTIVATION_RADIUS_METERS
  const retentionSq = MESH_COLLISION_RETENTION_RADIUS_METERS * MESH_COLLISION_RETENTION_RADIUS_METERS
  const candidates: MeshCollisionChunkCandidate[] = []
  state.chunks.forEach((chunk) => {
    const distanceSq = resolveChunkDistanceSq(chunk, references)
    if (distanceSq <= retentionSq) {
      candidates.push({ chunk, distanceSq })
    }
  })
  candidates.sort((left, right) => left.distanceSq - right.distanceSq)

  // Keep already resident chunks first (nearest first) so crossing the budget does not
  // churn bodies that are still inside the window, then fill free slots with new ones.
  const residentKeys = new Set<string>()
  const pendingCandidates: MeshCollisionChunkCandidate[] = []
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    if (!candidate) {
      continue
    }
    if (residentKeys.size < MESH_COLLISION_MAX_RESIDENT_CHUNKS) {
      residentKeys.add(candidate.chunk.key)
    }
    if (!state.instances.has(candidate.chunk.key) && candidate.distanceSq <= activationSq) {
      pendingCandidates.push(candidate)
    }
  }

  Array.from(state.instances.entries()).forEach(([key, instance]) => {
    if (residentKeys.has(key)) {
      return
    }
    removeChunkInstance(deps, instance)
    state.instances.delete(key)
  })

  const createLimit = state.burst
    ? MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC_AFTER_CHANGE
    : MESH_COLLISION_MAX_NEW_CHUNKS_PER_SYNC
  let created = 0
  let pendingChunkCount = 0
  for (let index = 0; index < pendingCandidates.length; index += 1) {
    const candidate = pendingCandidates[index]
    if (!candidate || !residentKeys.has(candidate.chunk.key)) {
      continue
    }
    if (created >= createLimit) {
      pendingChunkCount += 1
      continue
    }
    const source = state.sources[candidate.chunk.meshIndex]
    if (!source) {
      continue
    }
    const instance = createChunkInstance(deps, state.sourceId, sourceObject, source, candidate.chunk)
    if (!instance) {
      continue
    }
    state.instances.set(candidate.chunk.key, instance)
    created += 1
  }
  if (pendingChunkCount === 0) {
    state.burst = false
  }

  return {
    activeChunkKeys: Array.from(state.instances.keys()).sort(),
    chunkCount: state.instances.size,
    indexing: false,
    pendingChunkCount,
  }
}

export function clearMeshCollisionRuntimeHost(
  sourceObject: THREE.Object3D | null | undefined,
): void {
  if (!sourceObject) {
    return
  }
  const state = meshCollisionHostStateMap.get(sourceObject)
  if (!state) {
    return
  }
  Array.from(state.instances.values()).forEach((instance) => {
    removeChunkInstance(state.lastDeps, instance)
  })
  state.instances.clear()
  meshCollisionHostStateMap.delete(sourceObject)
  meshCollisionHostObjects.delete(sourceObject)
}

export function clearAllMeshCollisionRuntimeHosts(): void {
  Array.from(meshCollisionHostObjects).forEach((object) => {
    clearMeshCollisionRuntimeHost(object)
  })
}

export function resolveMeshCollisionRuntimeHostSnapshot(
  sourceObject: THREE.Object3D | null | undefined,
): MeshCollisionRuntimeHostSnapshot {
  const state = sourceObject ? meshCollisionHostStateMap.get(sourceObject) ?? null : null
  if (!state) {
    return EMPTY_MESH_COLLISION_SNAPSHOT
  }
  return {
    activeChunkKeys: Array.from(state.instances.keys()).sort(),
    chunkCount: state.instances.size,
    indexing: state.phase !== 'ready',
    pendingChunkCount: 0,
  }
}
