import * as THREE from 'three'

import {
  deserializeCompiledGroundRenderTile,
  type CompiledGroundManifest,
  type CompiledGroundRenderTileRecord,
} from './compiledGround'
import type { GroundDynamicMesh } from './core'

type CompiledGroundRenderRuntime = {
  group: THREE.Group
  meshes: Map<string, THREE.Mesh>
  pendingLoads: Map<string, Promise<void>>
  sourceId: string | null
  revision: number
  lastDebugLogAt: number
  lastDebugSignature: string
  loadedChunkKeysVersion: number
  loadedChunkKeysCacheVersion: number
  loadedChunkKeysCacheManifest: CompiledGroundManifest | null
  loadedChunkKeysCache: string[]
}

type CompiledGroundRenderTileGridIndex = {
  rows: Map<number, Map<number, CompiledGroundRenderTileRecord>>
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

type SyncCompiledGroundRenderTilesParams = {
  groundObject: THREE.Object3D
  groundDefinition: GroundDynamicMesh
  camera: THREE.Camera | null | undefined
  sourceId: string
  revision: number
  manifest: CompiledGroundManifest
  loadTileData: (record: CompiledGroundRenderTileRecord) => Promise<ArrayBuffer | null>
  activeRadiusTiles?: number
  retainRadiusTiles?: number
  streamingMode?: 'runtime-camera' | 'editor-overview'
  tileFrustumCulled?: boolean
}

const renderRuntimeMap = new WeakMap<THREE.Object3D, CompiledGroundRenderRuntime>()
const compiledGroundRenderTileRecordMapCache = new WeakMap<CompiledGroundManifest, Map<string, CompiledGroundRenderTileRecord>>()
const compiledGroundRenderTileChunkKeyCache = new WeakMap<CompiledGroundManifest, Map<string, string[]>>()
const compiledGroundRenderTileKeySetCache = new WeakMap<CompiledGroundManifest, Set<string>>()
const compiledGroundRenderTileGridIndexCache = new WeakMap<CompiledGroundManifest, CompiledGroundRenderTileGridIndex>()
const cameraLocalHelper = new THREE.Vector3()
const compiledGroundCameraQuaternion = new THREE.Quaternion()
const compiledGroundVisiblePlane = new THREE.Plane()
const compiledGroundVisiblePlanePoint = new THREE.Vector3()
const compiledGroundVisiblePlaneNormal = new THREE.Vector3()
const compiledGroundVisibleSampleWorld = new THREE.Vector3()
const compiledGroundVisibleSampleLocal = new THREE.Vector3()
const compiledGroundVisibleRayOrigin = new THREE.Vector3()
const compiledGroundVisibleRayDirection = new THREE.Vector3()
const compiledGroundVisibleRay = new THREE.Ray()

function createCompiledGroundViewportSamplePoints(stepsPerAxis: number): ReadonlyArray<readonly [number, number]> {
  const safeSteps = Math.max(2, Math.trunc(stepsPerAxis))
  const points: Array<readonly [number, number]> = []
  for (let row = 0; row <= safeSteps; row += 1) {
    const ndcY = -1 + (row / safeSteps) * 2
    for (let column = 0; column <= safeSteps; column += 1) {
      const ndcX = -1 + (column / safeSteps) * 2
      points.push([ndcX, ndcY] as const)
    }
  }
  return points
}

const compiledGroundViewportSamplePoints = createCompiledGroundViewportSamplePoints(8)

function resolveCompiledGroundChunkSizeMeters(
  groundDefinition: { chunkSizeMeters?: number; renderRadiusChunks?: number; collisionRadiusChunks?: number },
  manifest: CompiledGroundManifest,
): number {
  const explicit = Number(groundDefinition.chunkSizeMeters)
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit
  }
  return Math.max(1e-6, Number(manifest.chunkSizeMeters) || 1)
}

function resolveCompiledGroundChunkRadiusChunks(
  groundDefinition: { renderRadiusChunks?: number; collisionRadiusChunks?: number },
): number {
  const renderRadiusChunks = Number(groundDefinition.renderRadiusChunks)
  if (Number.isFinite(renderRadiusChunks) && renderRadiusChunks > 0) {
    return Math.max(1, Math.trunc(renderRadiusChunks))
  }
  const collisionRadiusChunks = Number(groundDefinition.collisionRadiusChunks)
  if (Number.isFinite(collisionRadiusChunks) && collisionRadiusChunks > 0) {
    return Math.max(1, Math.trunc(collisionRadiusChunks))
  }
  return 1
}

function resolveDefaultCompiledGroundActiveRadiusTiles(
  groundDefinition: { chunkSizeMeters?: number; renderRadiusChunks?: number; collisionRadiusChunks?: number },
  manifest: CompiledGroundManifest,
): number {
  const chunkSizeMeters = resolveCompiledGroundChunkSizeMeters(groundDefinition, manifest)
  const chunkRadiusChunks = resolveCompiledGroundChunkRadiusChunks(groundDefinition)
  const tileSizeMeters = Math.max(1e-6, Number(manifest.renderTileSizeMeters) || 1)
  return Math.max(1, Math.ceil((chunkRadiusChunks * chunkSizeMeters) / tileSizeMeters))
}

function resolveDefaultCompiledGroundRetainRadiusTiles(
  activeRadiusTiles: number,
  groundDefinition: { chunkSizeMeters?: number; renderRadiusChunks?: number; collisionRadiusChunks?: number },
  manifest: CompiledGroundManifest,
): number {
  const chunkSizeMeters = resolveCompiledGroundChunkSizeMeters(groundDefinition, manifest)
  const tileSizeMeters = Math.max(1e-6, Number(manifest.renderTileSizeMeters) || 1)
  const retainPaddingTiles = Math.max(1, Math.ceil(chunkSizeMeters / tileSizeMeters))
  return Math.max(activeRadiusTiles, activeRadiusTiles + retainPaddingTiles)
}

function buildCompiledGroundFallbackLocalBounds(
  manifest: CompiledGroundManifest,
  centerRow: number,
  centerColumn: number,
  radiusTiles: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const tileSize = Math.max(1e-6, Number(manifest.renderTileSizeMeters) || 1)
  return {
    minX: manifest.bounds.minX + (centerColumn - radiusTiles) * tileSize,
    maxX: manifest.bounds.minX + (centerColumn + radiusTiles + 1) * tileSize,
    minZ: manifest.bounds.minZ + (centerRow - radiusTiles) * tileSize,
    maxZ: manifest.bounds.minZ + (centerRow + radiusTiles + 1) * tileSize,
  }
}

function expandCompiledGroundLocalBounds(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  paddingMeters: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const safePadding = Math.max(0, paddingMeters)
  return {
    minX: bounds.minX - safePadding,
    maxX: bounds.maxX + safePadding,
    minZ: bounds.minZ - safePadding,
    maxZ: bounds.maxZ + safePadding,
  }
}

function resolveCompiledGroundVisibleLocalBounds(
  groundObject: THREE.Object3D,
  manifest: CompiledGroundManifest,
  camera: THREE.Camera,
  fallbackRadiusTiles: number,
): {
  visibleBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  fallbackBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  centerRow: number
  centerColumn: number
  cameraLocalX: number
  cameraLocalZ: number
  intersectionCount: number
} {
  groundObject.updateWorldMatrix(true, false)
  camera.updateWorldMatrix(true, false)
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera || (camera as THREE.OrthographicCamera).isOrthographicCamera) {
    ;(camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix()
  }

  camera.getWorldPosition(cameraLocalHelper)
  groundObject.worldToLocal(cameraLocalHelper)
  const tileSize = Math.max(1e-6, Number(manifest.renderTileSizeMeters) || 1)
  const centerColumn = Math.floor((cameraLocalHelper.x - manifest.bounds.minX) / tileSize)
  const centerRow = Math.floor((cameraLocalHelper.z - manifest.bounds.minZ) / tileSize)
  const fallbackBounds = buildCompiledGroundFallbackLocalBounds(manifest, centerRow, centerColumn, fallbackRadiusTiles)

  compiledGroundVisiblePlanePoint.set(0, Number.isFinite(manifest.baseHeight) ? Number(manifest.baseHeight) : 0, 0)
  groundObject.localToWorld(compiledGroundVisiblePlanePoint)
  compiledGroundVisiblePlaneNormal.set(0, 1, 0)
  groundObject.getWorldQuaternion(compiledGroundCameraQuaternion)
  compiledGroundVisiblePlaneNormal.applyQuaternion(compiledGroundCameraQuaternion).normalize()
  compiledGroundVisiblePlane.setFromNormalAndCoplanarPoint(
    compiledGroundVisiblePlaneNormal,
    compiledGroundVisiblePlanePoint,
  )

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let intersectionCount = 0

  for (const [ndcX, ndcY] of compiledGroundViewportSamplePoints) {
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      compiledGroundVisibleRayOrigin.set(ndcX, ndcY, -1).unproject(camera)
      camera.getWorldDirection(compiledGroundVisibleRayDirection)
    } else {
      camera.getWorldPosition(compiledGroundVisibleRayOrigin)
      compiledGroundVisibleSampleWorld.set(ndcX, ndcY, 0.5).unproject(camera)
      compiledGroundVisibleRayDirection
        .copy(compiledGroundVisibleSampleWorld)
        .sub(compiledGroundVisibleRayOrigin)
        .normalize()
    }
    if (compiledGroundVisibleRayDirection.lengthSq() <= 1e-12) {
      continue
    }
    compiledGroundVisibleRay.set(compiledGroundVisibleRayOrigin, compiledGroundVisibleRayDirection)
    if (!compiledGroundVisibleRay.intersectPlane(compiledGroundVisiblePlane, compiledGroundVisibleSampleWorld)) {
      continue
    }
    compiledGroundVisibleSampleLocal.copy(compiledGroundVisibleSampleWorld)
    groundObject.worldToLocal(compiledGroundVisibleSampleLocal)
    minX = Math.min(minX, compiledGroundVisibleSampleLocal.x)
    maxX = Math.max(maxX, compiledGroundVisibleSampleLocal.x)
    minZ = Math.min(minZ, compiledGroundVisibleSampleLocal.z)
    maxZ = Math.max(maxZ, compiledGroundVisibleSampleLocal.z)
    intersectionCount += 1
  }

  if (intersectionCount <= 0) {
    return {
      visibleBounds: fallbackBounds,
      fallbackBounds,
      centerRow,
      centerColumn,
      cameraLocalX: cameraLocalHelper.x,
      cameraLocalZ: cameraLocalHelper.z,
      intersectionCount: 0,
    }
  }

  return {
    visibleBounds: {
      minX: Math.min(fallbackBounds.minX, minX),
      maxX: Math.max(fallbackBounds.maxX, maxX),
      minZ: Math.min(fallbackBounds.minZ, minZ),
      maxZ: Math.max(fallbackBounds.maxZ, maxZ),
    },
    fallbackBounds,
    centerRow,
    centerColumn,
    cameraLocalX: cameraLocalHelper.x,
    cameraLocalZ: cameraLocalHelper.z,
    intersectionCount,
  }
}


function resolveCompiledGroundRenderTileRecordMap(
  manifest: CompiledGroundManifest,
): Map<string, CompiledGroundRenderTileRecord> {
  const cached = compiledGroundRenderTileRecordMapCache.get(manifest)
  if (cached) {
    return cached
  }
  const next = new Map<string, CompiledGroundRenderTileRecord>()
  for (const record of manifest.renderTiles) {
    next.set(record.key, record)
  }
  compiledGroundRenderTileRecordMapCache.set(manifest, next)
  return next
}

function resolveCompiledGroundRenderTileGridIndex(
  manifest: CompiledGroundManifest,
): CompiledGroundRenderTileGridIndex {
  const cached = compiledGroundRenderTileGridIndexCache.get(manifest)
  if (cached) {
    return cached
  }

  const rows = new Map<number, Map<number, CompiledGroundRenderTileRecord>>()
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minColumn = Number.POSITIVE_INFINITY
  let maxColumn = Number.NEGATIVE_INFINITY

  for (const record of manifest.renderTiles) {
    const row = Math.trunc(Number(record.row) || 0)
    const column = Math.trunc(Number(record.column) || 0)
    let rowEntries = rows.get(row)
    if (!rowEntries) {
      rowEntries = new Map<number, CompiledGroundRenderTileRecord>()
      rows.set(row, rowEntries)
    }
    rowEntries.set(column, record)
    minRow = Math.min(minRow, row)
    maxRow = Math.max(maxRow, row)
    minColumn = Math.min(minColumn, column)
    maxColumn = Math.max(maxColumn, column)
  }

  const next: CompiledGroundRenderTileGridIndex = {
    rows,
    minRow: Number.isFinite(minRow) ? minRow : 0,
    maxRow: Number.isFinite(maxRow) ? maxRow : -1,
    minColumn: Number.isFinite(minColumn) ? minColumn : 0,
    maxColumn: Number.isFinite(maxColumn) ? maxColumn : -1,
  }
  compiledGroundRenderTileGridIndexCache.set(manifest, next)
  return next
}

function collectCompiledGroundRenderTilesInBounds(
  manifest: CompiledGroundManifest,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): CompiledGroundRenderTileRecord[] {
  const index = resolveCompiledGroundRenderTileGridIndex(manifest)
  if (index.maxRow < index.minRow || index.maxColumn < index.minColumn) {
    return []
  }

  const tileSize = Math.max(1e-6, Number(manifest.renderTileSizeMeters) || 1)
  const epsilon = Math.max(1e-9, tileSize * 1e-9)
  const minColumn = Math.max(
    index.minColumn,
    Math.floor((bounds.minX - manifest.bounds.minX) / tileSize),
  )
  const maxColumn = Math.min(
    index.maxColumn,
    Math.floor((bounds.maxX - manifest.bounds.minX - epsilon) / tileSize),
  )
  const minRow = Math.max(
    index.minRow,
    Math.floor((bounds.minZ - manifest.bounds.minZ) / tileSize),
  )
  const maxRow = Math.min(
    index.maxRow,
    Math.floor((bounds.maxZ - manifest.bounds.minZ - epsilon) / tileSize),
  )

  if (maxColumn < minColumn || maxRow < minRow) {
    return []
  }

  const records: CompiledGroundRenderTileRecord[] = []
  for (let row = minRow; row <= maxRow; row += 1) {
    const rowEntries = index.rows.get(row)
    if (!rowEntries) {
      continue
    }
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const record = rowEntries.get(column)
      if (record) {
        records.push(record)
      }
    }
  }
  return records
}

function resolveCompiledGroundChunkCoordFromWorldPosition(
  worldX: number,
  worldZ: number,
  chunkSizeMeters: number,
): { chunkX: number; chunkZ: number } {
  const safeChunkSize = Math.max(1e-6, Number(chunkSizeMeters) || 1)
  const origin = -safeChunkSize * 0.5
  return {
    chunkX: Math.floor((worldX - origin) / safeChunkSize),
    chunkZ: Math.floor((worldZ - origin) / safeChunkSize),
  }
}

function collectCompiledGroundRenderTileChunkKeys(
  manifest: CompiledGroundManifest,
  record: CompiledGroundRenderTileRecord,
): string[] {
  let cache = compiledGroundRenderTileChunkKeyCache.get(manifest)
  if (!cache) {
    cache = new Map<string, string[]>()
    compiledGroundRenderTileChunkKeyCache.set(manifest, cache)
  }
  const cached = cache.get(record.key)
  if (cached) {
    return cached
  }
  const minX = Number.isFinite(record.bounds?.minX) ? Number(record.bounds.minX) : record.centerX - record.widthMeters * 0.5
  const maxX = Number.isFinite(record.bounds?.maxX) ? Number(record.bounds.maxX) : record.centerX + record.widthMeters * 0.5
  const minZ = Number.isFinite(record.bounds?.minZ) ? Number(record.bounds.minZ) : record.centerZ - record.depthMeters * 0.5
  const maxZ = Number.isFinite(record.bounds?.maxZ) ? Number(record.bounds.maxZ) : record.centerZ + record.depthMeters * 0.5
  const epsilon = Math.max(1e-9, Math.max(record.widthMeters, record.depthMeters, manifest.chunkSizeMeters) * 1e-9)
  const minCoord = resolveCompiledGroundChunkCoordFromWorldPosition(minX, minZ, manifest.chunkSizeMeters)
  const maxCoord = resolveCompiledGroundChunkCoordFromWorldPosition(maxX - epsilon, maxZ - epsilon, manifest.chunkSizeMeters)
  const chunkKeys: string[] = []
  for (let chunkZ = minCoord.chunkZ; chunkZ <= maxCoord.chunkZ; chunkZ += 1) {
    for (let chunkX = minCoord.chunkX; chunkX <= maxCoord.chunkX; chunkX += 1) {
      chunkKeys.push(`${chunkX}:${chunkZ}`)
    }
  }
  cache.set(record.key, chunkKeys)
  return chunkKeys
}

function ensureCompiledGroundRenderRuntime(groundObject: THREE.Object3D): CompiledGroundRenderRuntime {
  const existing = renderRuntimeMap.get(groundObject)
  if (existing) {
    return existing
  }
  const group = new THREE.Group()
  group.name = 'CompiledGroundTiles'
  groundObject.add(group)
  const runtime: CompiledGroundRenderRuntime = {
    group,
    meshes: new Map(),
    pendingLoads: new Map(),
    sourceId: null,
    revision: -1,
    lastDebugLogAt: 0,
    lastDebugSignature: '',
    loadedChunkKeysVersion: 0,
    loadedChunkKeysCacheVersion: -1,
    loadedChunkKeysCacheManifest: null,
    loadedChunkKeysCache: [],
  }
  renderRuntimeMap.set(groundObject, runtime)
  return runtime
}

function disposeCompiledGroundRenderMesh(mesh: THREE.Mesh): void {
  mesh.removeFromParent()
  try {
    mesh.geometry?.dispose?.()
  } catch (_error) {
    /* noop */
  }
}

export function clearCompiledGroundRenderTiles(groundObject: THREE.Object3D): void {
  const runtime = renderRuntimeMap.get(groundObject)
  if (!runtime) {
    return
  }
  runtime.meshes.forEach((mesh) => disposeCompiledGroundRenderMesh(mesh))
  runtime.meshes.clear()
  runtime.pendingLoads.clear()
  runtime.sourceId = null
  runtime.revision = -1
  runtime.lastDebugLogAt = 0
  runtime.lastDebugSignature = ''
  runtime.loadedChunkKeysVersion += 1
  runtime.loadedChunkKeysCacheVersion = -1
  runtime.loadedChunkKeysCacheManifest = null
  runtime.loadedChunkKeysCache = []
}

export function collectLoadedCompiledGroundChunkKeys(
  groundObject: THREE.Object3D,
  manifest: CompiledGroundManifest | null | undefined,
): string[] {
  if (!manifest) {
    return []
  }
  const runtime = renderRuntimeMap.get(groundObject)
  if (!runtime || runtime.meshes.size <= 0) {
    return []
  }
  if (
    runtime.loadedChunkKeysCacheVersion === runtime.loadedChunkKeysVersion
    && runtime.loadedChunkKeysCacheManifest === manifest
  ) {
    return runtime.loadedChunkKeysCache
  }
  const recordMap = resolveCompiledGroundRenderTileRecordMap(manifest)
  const chunkKeys = new Set<string>()
  runtime.meshes.forEach((_mesh, tileKey) => {
    const record = recordMap.get(tileKey)
    if (!record) {
      return
    }
    for (const chunkKey of collectCompiledGroundRenderTileChunkKeys(manifest, record)) {
      chunkKeys.add(chunkKey)
    }
  })
  runtime.loadedChunkKeysCacheManifest = manifest
  runtime.loadedChunkKeysCacheVersion = runtime.loadedChunkKeysVersion
  runtime.loadedChunkKeysCache = Array.from(chunkKeys)
  return runtime.loadedChunkKeysCache
}

export function getCompiledGroundRenderWorkState(
  groundObject: THREE.Object3D,
): { pendingLoads: number; loadedChunkKeysVersion: number } | null {
  const runtime = renderRuntimeMap.get(groundObject)
  if (!runtime) {
    return null
  }
  return {
    pendingLoads: runtime.pendingLoads.size,
    loadedChunkKeysVersion: runtime.loadedChunkKeysVersion,
  }
}

function resolveGroundMaterial(groundObject: THREE.Object3D): THREE.Material {
  const cached = (groundObject.userData as Record<string, unknown> | undefined)?.groundMaterial
  if (cached && !Array.isArray(cached)) {
    return cached as THREE.Material
  }
  let resolved: THREE.Material | null = null
  groundObject.traverse((child) => {
    if (resolved || !(child as THREE.Mesh).isMesh) {
      return
    }
    const mesh = child as THREE.Mesh
    if (mesh.userData?.groundChunk || mesh.userData?.compiledGroundTile) {
      return
    }
    const material = mesh.material
    resolved = Array.isArray(material) ? (material[0] ?? null) : (material ?? null)
  })
  return resolved ?? new THREE.MeshStandardMaterial({
    color: '#707070',
    roughness: 1,
    metalness: 0.1,
  })
}

function resolveCompiledGroundRenderTileKeySet(manifest: CompiledGroundManifest): Set<string> {
  const cached = compiledGroundRenderTileKeySetCache.get(manifest)
  if (cached) {
    return cached
  }
  const next = new Set(manifest.renderTiles.map((record) => record.key))
  compiledGroundRenderTileKeySetCache.set(manifest, next)
  return next
}

function buildGeometryFromTileBuffer(buffer: ArrayBuffer | null): THREE.BufferGeometry | null {
  const decoded = deserializeCompiledGroundRenderTile(buffer)
  if (!decoded) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(decoded.normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(decoded.uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(decoded.indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function resolveTileWindowRecords(
  groundObject: THREE.Object3D,
  manifest: CompiledGroundManifest,
  camera: THREE.Camera,
  activeRadiusTiles: number,
  retainRadiusTiles: number,
  streamingMode: 'runtime-camera' | 'editor-overview',
): {
  desired: CompiledGroundRenderTileRecord[]
  retainedKeys: Set<string>
  visibleBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  desiredBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  retainedBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  centerRow: number
  centerColumn: number
  intersectionCount: number
} {
  if (streamingMode === 'editor-overview') {
    return {
      desired: manifest.renderTiles,
      retainedKeys: resolveCompiledGroundRenderTileKeySet(manifest),
      visibleBounds: {
        minX: manifest.bounds.minX,
        maxX: manifest.bounds.maxX,
        minZ: manifest.bounds.minZ,
        maxZ: manifest.bounds.maxZ,
      },
      desiredBounds: {
        minX: manifest.bounds.minX,
        maxX: manifest.bounds.maxX,
        minZ: manifest.bounds.minZ,
        maxZ: manifest.bounds.maxZ,
      },
      retainedBounds: {
        minX: manifest.bounds.minX,
        maxX: manifest.bounds.maxX,
        minZ: manifest.bounds.minZ,
        maxZ: manifest.bounds.maxZ,
      },
      centerRow: 0,
      centerColumn: 0,
      intersectionCount: 0,
    }
  }

  const tileSize = Math.max(1e-6, manifest.renderTileSizeMeters)
  const visibleLocal = resolveCompiledGroundVisibleLocalBounds(
    groundObject,
    manifest,
    camera,
    activeRadiusTiles,
  )
  const desiredBounds = expandCompiledGroundLocalBounds(visibleLocal.visibleBounds, activeRadiusTiles * tileSize)
  const retainedBounds = expandCompiledGroundLocalBounds(visibleLocal.visibleBounds, retainRadiusTiles * tileSize)
  const desired: Array<{ record: CompiledGroundRenderTileRecord; distSq: number }> = []
  const retainedKeys = new Set<string>()
  for (const record of collectCompiledGroundRenderTilesInBounds(manifest, retainedBounds)) {
    retainedKeys.add(record.key)
  }
  for (const record of collectCompiledGroundRenderTilesInBounds(manifest, desiredBounds)) {
    const dx = record.centerX - visibleLocal.cameraLocalX
    const dz = record.centerZ - visibleLocal.cameraLocalZ
    desired.push({ record, distSq: dx * dx + dz * dz })
  }
  desired.sort((left, right) => left.distSq - right.distSq)
  return {
    desired: desired.map((entry) => entry.record),
    retainedKeys,
    visibleBounds: visibleLocal.visibleBounds,
    desiredBounds,
    retainedBounds,
    centerRow: visibleLocal.centerRow,
    centerColumn: visibleLocal.centerColumn,
    intersectionCount: visibleLocal.intersectionCount,
  }
}

export function syncCompiledGroundRenderTiles(params: SyncCompiledGroundRenderTilesParams): void {
  if (!params.camera) {
    return
  }
  const runtime = ensureCompiledGroundRenderRuntime(params.groundObject)
  if (runtime.sourceId !== params.sourceId || runtime.revision !== params.revision) {
    clearCompiledGroundRenderTiles(params.groundObject)
    runtime.sourceId = params.sourceId
    runtime.revision = params.revision
  }
  const streamingMode = params.streamingMode === 'editor-overview' ? 'editor-overview' : 'runtime-camera'
  const tileFrustumCulled = params.tileFrustumCulled === true
  const activeRadiusTiles = Math.max(
    1,
    Math.trunc(params.activeRadiusTiles ?? resolveDefaultCompiledGroundActiveRadiusTiles(params.groundDefinition, params.manifest)),
  )
  const retainRadiusTiles = Math.max(
    activeRadiusTiles,
    Math.trunc(params.retainRadiusTiles ?? resolveDefaultCompiledGroundRetainRadiusTiles(
      activeRadiusTiles,
      params.groundDefinition,
      params.manifest,
    )),
  )
  const { desired, retainedKeys } = resolveTileWindowRecords(
    params.groundObject,
    params.manifest,
    params.camera,
    activeRadiusTiles,
    retainRadiusTiles,
    streamingMode,
  )
  const desiredKeys = new Set(desired.map((record) => record.key))
  params.camera.getWorldPosition(cameraLocalHelper)
  params.groundObject.worldToLocal(cameraLocalHelper)
  const nextDebugSignature = [
    params.sourceId,
    params.revision,
    desired.length,
    runtime.meshes.size,
    runtime.pendingLoads.size,
    activeRadiusTiles,
    retainRadiusTiles,
    Math.round(cameraLocalHelper.x),
    Math.round(cameraLocalHelper.z),
  ].join('|')
  const now = Date.now()
  runtime.lastDebugLogAt = now
  runtime.lastDebugSignature = nextDebugSignature

  runtime.meshes.forEach((mesh, key) => {
    if (mesh.frustumCulled !== tileFrustumCulled) {
      mesh.frustumCulled = tileFrustumCulled
    }
    if (desiredKeys.has(key) || retainedKeys.has(key)) {
      return
    }
    disposeCompiledGroundRenderMesh(mesh)
    runtime.meshes.delete(key)
    runtime.loadedChunkKeysVersion += 1
  })

  const material = resolveGroundMaterial(params.groundObject)
  for (const record of desired) {
    if (runtime.meshes.has(record.key) || runtime.pendingLoads.has(record.key)) {
      continue
    }
    const pending = params.loadTileData(record)
      .then((buffer) => {
        const activeRuntime = renderRuntimeMap.get(params.groundObject)
        if (!activeRuntime || activeRuntime.sourceId !== params.sourceId || activeRuntime.revision !== params.revision) {
          return
        }
        if (!(buffer instanceof ArrayBuffer)) {
          console.warn('[CompiledGroundRender] Missing tile buffer', {
            sourceId: params.sourceId,
            tileKey: record.key,
            path: record.path,
          })
          return
        }
        const geometry = buildGeometryFromTileBuffer(buffer)
        if (!geometry) {
          console.warn('[CompiledGroundRender] Failed to decode tile geometry', {
            sourceId: params.sourceId,
            tileKey: record.key,
            path: record.path,
            byteLength: buffer.byteLength,
          })
          return
        }
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = `CompiledGroundTile:${record.key}`
        mesh.receiveShadow = true
        mesh.castShadow = params.groundDefinition.castShadow === true
        // Tile streaming is controlled explicitly from the screen-visible ground footprint first.
        // Some camera modes still want mesh-level frustum culling on top, so keep this caller-configurable.
        mesh.frustumCulled = tileFrustumCulled
        mesh.userData.compiledGroundTile = true
        mesh.userData.compiledGroundTileKey = record.key
        activeRuntime.group.add(mesh)
        activeRuntime.meshes.set(record.key, mesh)
        activeRuntime.loadedChunkKeysVersion += 1
      })
      .finally(() => {
        renderRuntimeMap.get(params.groundObject)?.pendingLoads.delete(record.key)
      })
    runtime.pendingLoads.set(record.key, pending)
  }
}
