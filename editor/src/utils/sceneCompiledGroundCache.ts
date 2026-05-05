import {
  COMPILED_GROUND_MANIFEST_VERSION,
  computeCompiledGroundManifestRevision,
  isGroundDynamicMesh,
  isIndexedDbPersistentAssetStorageSupported,
  type CompiledGroundBounds,
  type CompiledGroundCollisionTileRecord,
  type CompiledGroundManifest,
  type CompiledGroundRenderTileRecord,
  type GroundDynamicMesh,
  type SceneJsonExportDocument,
  type SceneNode,
} from '@schema'
import {
  buildCompiledGroundPackageFilesAsync,
  resolvePreferredCompiledGroundWorkerCount,
  type CompiledGroundBuildProgress,
} from './compiledGroundExport'

export type SceneCompiledGroundPackage = {
  manifest: CompiledGroundManifest
  files: Map<string, ArrayBuffer>
}

type SceneCompiledGroundMemoryCacheEntry = {
  pkg: SceneCompiledGroundPackage
  sourceSignature: string
}

export type SceneCompiledGroundCacheLoadDiagnostics = {
  buildKey: string
  status: 'hit' | 'miss' | 'partial' | 'corrupt' | 'stale'
  elapsedMs: number
  indexedFileCount: number
  loadedFileCount: number
  missingFileCount: number
  renderTileCount: number
  collisionTileCount: number
  totalBytes: number
}

export type SceneCompiledGroundCacheLoadResult = {
  pkg: SceneCompiledGroundPackage | null
  diagnostics: SceneCompiledGroundCacheLoadDiagnostics
}

type SceneCompiledGroundCacheIndexEntry = {
  path: string
  key: string
  size: number
}

type SceneCompiledGroundCacheIndex = {
  version: number
  buildKey: string
  sourceSignature: string
  storedAt: number
  lastAccessedAt: number
  manifest: CompiledGroundManifest
  files: SceneCompiledGroundCacheIndexEntry[]
}

type SceneCompiledGroundCacheCatalogEntry = {
  buildKey: string
  indexKey: string
  storedAt: number
  lastAccessedAt: number
}

type SceneCompiledGroundCacheCatalog = {
  version: number
  entries: SceneCompiledGroundCacheCatalogEntry[]
}

type SceneCompiledGroundCatalogRecord = SceneCompiledGroundCacheCatalog & {
  key: string
  storedAt?: number
  lastAccessedAt?: number
}

type SceneCompiledGroundPackageIndexRecord = SceneCompiledGroundCacheIndex & {
  key: string
}

type SceneCompiledGroundTileStorageRecord = {
  key: string
  buildKey: string
  path: string
  size: number
  bytes: ArrayBuffer
  storedAt: number
  lastAccessedAt: number
}

export type EnsureSceneCompiledGroundOptions = {
  forceRebuild?: boolean
  sourceSignature?: string
  onProgress?: (progress: CompiledGroundBuildProgress) => void
}

export type RebuildSceneCompiledGroundChunksOptions = {
  sourceSignature?: string
  onProgress?: (progress: CompiledGroundBuildProgress) => void
}

export const SCENE_COMPILED_GROUND_PROFILE_VERSION = 1
export const SCENE_COMPILED_GROUND_BUILD_OPTIONS = Object.freeze({
  renderChunksPerTile: 1,
  collisionChunksPerTile: 1,
  renderSampleStepMultiplier: 1,
  minRenderSampleStepMeters: 1,
  collisionSampleStepMultiplier: 1,
  minCollisionSampleStepMeters: 1,
})

const CACHE_FORMAT_VERSION = 2
const CACHE_KEY_PREFIX = `scene-compiled-ground:v${CACHE_FORMAT_VERSION}:`
const CACHE_CATALOG_KEY = `${CACHE_KEY_PREFIX}__catalog__`
const CACHE_MAX_PACKAGES = 12
const CACHE_BATCH_SIZE = 24
const CACHE_DB_NAME = 'harmony-scene-compiled-ground-v2'
const CACHE_DB_VERSION = 1
const CACHE_META_STORE = 'meta'
const CACHE_TILE_STORE = 'tiles'

let sceneCompiledGroundDbPromise: Promise<IDBDatabase | null> | null = null
const sceneCompiledGroundMemoryCache = new Map<string, SceneCompiledGroundMemoryCacheEntry>()

function getIndexStorageKey(buildKey: string): string {
  return `${CACHE_KEY_PREFIX}${buildKey}:index`
}

function sanitizePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '_')
}

function getTileStorageKey(buildKey: string, path: string): string {
  return `${CACHE_KEY_PREFIX}${buildKey}:tile:${sanitizePathSegment(path)}`
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function openSceneCompiledGroundDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDbPersistentAssetStorageSupported()) {
    return null
  }
  if (!sceneCompiledGroundDbPromise) {
    sceneCompiledGroundDbPromise = new Promise<IDBDatabase | null>((resolve) => {
      const request = globalThis.indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION)
      request.onerror = () => {
        console.warn('[SceneCompiledGroundCache] Failed to open IndexedDB cache', request.error)
        resolve(null)
      }
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(CACHE_META_STORE)) {
          db.createObjectStore(CACHE_META_STORE, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(CACHE_TILE_STORE)) {
          const tileStore = db.createObjectStore(CACHE_TILE_STORE, { keyPath: 'key' })
          tileStore.createIndex('buildKey', 'buildKey', { unique: false })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          sceneCompiledGroundDbPromise = null
        }
        resolve(db)
      }
    })
  }
  return sceneCompiledGroundDbPromise
}

async function getMetaRecord<T>(key: string): Promise<T | null> {
  const db = await openSceneCompiledGroundDatabase()
  if (!db) {
    return null
  }
  const transaction = db.transaction(CACHE_META_STORE, 'readonly')
  const store = transaction.objectStore(CACHE_META_STORE)
  const result = await requestToPromise<T | undefined>(store.get(key))
  return result ?? null
}

async function putMetaRecord(record: SceneCompiledGroundCatalogRecord | SceneCompiledGroundPackageIndexRecord): Promise<void> {
  const db = await openSceneCompiledGroundDatabase()
  if (!db) {
    return
  }
  const transaction = db.transaction(CACHE_META_STORE, 'readwrite')
  transaction.objectStore(CACHE_META_STORE).put(record)
  await waitForTransaction(transaction)
}

async function deleteMetaRecord(key: string): Promise<void> {
  const db = await openSceneCompiledGroundDatabase()
  if (!db) {
    return
  }
  const transaction = db.transaction(CACHE_META_STORE, 'readwrite')
  transaction.objectStore(CACHE_META_STORE).delete(key)
  await waitForTransaction(transaction)
}

async function getTileRecords(keys: string[]): Promise<Map<string, SceneCompiledGroundTileStorageRecord>> {
  const normalizedKeys = Array.from(new Set(
    (Array.isArray(keys) ? keys : [])
      .map((key) => typeof key === 'string' ? key.trim() : '')
      .filter((key) => key.length > 0),
  ))
  const records = new Map<string, SceneCompiledGroundTileStorageRecord>()
  if (!normalizedKeys.length) {
    return records
  }
  const db = await openSceneCompiledGroundDatabase()
  if (!db) {
    return records
  }
  const transaction = db.transaction(CACHE_TILE_STORE, 'readonly')
  const store = transaction.objectStore(CACHE_TILE_STORE)
  const requests = normalizedKeys.map(async (key) => {
    const record = await requestToPromise<SceneCompiledGroundTileStorageRecord | undefined>(store.get(key))
    if (record?.bytes) {
      records.set(key, record)
    }
  })
  await Promise.all(requests)
  await waitForTransaction(transaction)
  return records
}

async function writeTileRecordDelta(
  upserts: SceneCompiledGroundTileStorageRecord[],
  deleteKeys: string[],
): Promise<void> {
  const normalizedDeleteKeys = Array.from(new Set(
    (Array.isArray(deleteKeys) ? deleteKeys : [])
      .map((key) => typeof key === 'string' ? key.trim() : '')
      .filter((key) => key.length > 0),
  ))
  if (!upserts.length && !normalizedDeleteKeys.length) {
    return
  }
  const db = await openSceneCompiledGroundDatabase()
  if (!db) {
    return
  }
  const transaction = db.transaction(CACHE_TILE_STORE, 'readwrite')
  const store = transaction.objectStore(CACHE_TILE_STORE)
  for (const record of upserts) {
    store.put(record)
  }
  for (const key of normalizedDeleteKeys) {
    store.delete(key)
  }
  await waitForTransaction(transaction)
}

function normalizeCatalog(value: SceneCompiledGroundCacheCatalog | null | undefined): SceneCompiledGroundCacheCatalog {
  if (!value || value.version !== CACHE_FORMAT_VERSION || !Array.isArray(value.entries)) {
    return {
      version: CACHE_FORMAT_VERSION,
      entries: [],
    }
  }
  return {
    version: CACHE_FORMAT_VERSION,
    entries: value.entries
      .map((entry) => ({
        buildKey: typeof entry?.buildKey === 'string' ? entry.buildKey.trim() : '',
        indexKey: typeof entry?.indexKey === 'string' ? entry.indexKey.trim() : '',
        storedAt: Number.isFinite(entry?.storedAt) ? Number(entry.storedAt) : Date.now(),
        lastAccessedAt: Number.isFinite(entry?.lastAccessedAt) ? Number(entry.lastAccessedAt) : Date.now(),
      }))
      .filter((entry) => entry.buildKey.length > 0 && entry.indexKey.length > 0),
  }
}

async function loadCatalog(): Promise<SceneCompiledGroundCacheCatalog> {
  const record = await getMetaRecord<SceneCompiledGroundCatalogRecord>(CACHE_CATALOG_KEY)
  return normalizeCatalog(record)
}

async function saveCatalog(catalog: SceneCompiledGroundCacheCatalog): Promise<void> {
  const now = Date.now()
  await putMetaRecord({
    key: CACHE_CATALOG_KEY,
    version: CACHE_FORMAT_VERSION,
    entries: catalog.entries,
    storedAt: now,
    lastAccessedAt: now,
  })
}

async function runInBatches<T>(items: T[], callback: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += CACHE_BATCH_SIZE) {
    await Promise.all(items.slice(index, index + CACHE_BATCH_SIZE).map((item) => callback(item)))
  }
}

async function loadPackageIndex(
  buildKey: string,
): Promise<SceneCompiledGroundCacheIndex | null> {
  const record = await getMetaRecord<SceneCompiledGroundPackageIndexRecord>(getIndexStorageKey(buildKey))
  if (!record) {
    return null
  }
  if (record.version !== CACHE_FORMAT_VERSION || !Array.isArray(record.files) || !record.manifest) {
    await deleteMetaRecord(record.key)
    return null
  }
  record.sourceSignature = typeof record.sourceSignature === 'string' ? record.sourceSignature.trim() : ''
  return record
}

async function deletePackageByIndex(
  index: SceneCompiledGroundCacheIndex | null | undefined,
): Promise<void> {
  if (!index) {
    return
  }
  await writeTileRecordDelta([], index.files.map((entry) => entry.key))
  await deleteMetaRecord(getIndexStorageKey(index.buildKey))
  sceneCompiledGroundMemoryCache.delete(index.buildKey)
}

async function touchPackageCatalogEntry(buildKey: string): Promise<void> {
  const catalog = await loadCatalog()
  const entry = catalog.entries.find((candidate) => candidate.buildKey === buildKey)
  if (!entry) {
    return
  }
  entry.lastAccessedAt = Date.now()
  await saveCatalog(catalog)
}

async function pruneCatalog(): Promise<void> {
  const catalog = await loadCatalog()
  if (catalog.entries.length <= CACHE_MAX_PACKAGES) {
    return
  }
  catalog.entries.sort((left, right) => right.lastAccessedAt - left.lastAccessedAt)
  const retained = catalog.entries.slice(0, CACHE_MAX_PACKAGES)
  const removed = catalog.entries.slice(CACHE_MAX_PACKAGES)
  for (const entry of removed) {
    const index = await loadPackageIndex(entry.buildKey)
    await deletePackageByIndex(index)
  }
  catalog.entries = retained
  await saveCatalog(catalog)
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (isGroundDynamicMesh(node.dynamicMesh)) {
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return null
}

function summarizeLocalEditTileSignature(dynamicGround: GroundDynamicMesh): string {
  const localEditTiles = dynamicGround.localEditTiles && typeof dynamicGround.localEditTiles === 'object'
    ? Object.values(dynamicGround.localEditTiles)
    : []
  if (!localEditTiles.length) {
    return 'none'
  }
  let maxUpdatedAt = 0
  const resolutionBuckets = new Map<number, number>()
  for (const tile of localEditTiles) {
    const resolution = Math.max(1, Math.trunc(Number(tile?.resolution) || 0))
    resolutionBuckets.set(resolution, (resolutionBuckets.get(resolution) ?? 0) + 1)
    const updatedAt = Number(tile?.updatedAt)
    if (Number.isFinite(updatedAt)) {
      maxUpdatedAt = Math.max(maxUpdatedAt, updatedAt)
    }
  }
  return `${localEditTiles.length}:${maxUpdatedAt}:${Array.from(resolutionBuckets.entries()).sort((a, b) => a[0] - b[0]).map(([resolution, count]) => `${resolution}x${count}`).join(',')}`
}

export function computeSceneCompiledGroundBuildKey(
  sceneId: string,
  dynamicGround: GroundDynamicMesh | null,
  terrainDatasetId: string | null = null,
): string {
  if (!dynamicGround) {
    return `${sceneId}|no-ground`
  }
  const worldBounds = dynamicGround.worldBounds ?? null
  const heightComposition = dynamicGround.heightComposition ?? null
  return [
    sceneId,
    dynamicGround.terrainMode ?? 'finite',
    dynamicGround.chunkSizeMeters ?? '',
    dynamicGround.baseHeight ?? '',
    dynamicGround.cellSize ?? '',
    dynamicGround.editTileSizeMeters ?? '',
    dynamicGround.editTileResolution ?? '',
    worldBounds?.minX ?? '',
    worldBounds?.minZ ?? '',
    worldBounds?.maxX ?? '',
    worldBounds?.maxZ ?? '',
    heightComposition?.mode ?? '',
    heightComposition?.policyVersion ?? '',
    terrainDatasetId ?? '',
    `scene-profile:${SCENE_COMPILED_GROUND_PROFILE_VERSION}`,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.renderChunksPerTile,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.collisionChunksPerTile,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.renderSampleStepMultiplier,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.minRenderSampleStepMeters,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.collisionSampleStepMultiplier,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.minCollisionSampleStepMeters,
  ].join('|')
}

export function computeSceneCompiledGroundSourceSignature(
  sceneId: string,
  dynamicGround: GroundDynamicMesh | null,
  terrainDatasetId: string | null = null,
): string {
  if (!dynamicGround) {
    return `${sceneId}|no-ground`
  }
  const worldBounds = dynamicGround.worldBounds ?? null
  const heightComposition = dynamicGround.heightComposition ?? null
  return [
    sceneId,
    dynamicGround.terrainMode ?? 'finite',
    dynamicGround.surfaceRevision ?? 0,
    dynamicGround.chunkManifestRevision ?? 0,
    dynamicGround.chunkSizeMeters ?? '',
    dynamicGround.baseHeight ?? '',
    dynamicGround.cellSize ?? '',
    dynamicGround.editTileSizeMeters ?? '',
    dynamicGround.editTileResolution ?? '',
    worldBounds?.minX ?? '',
    worldBounds?.minZ ?? '',
    worldBounds?.maxX ?? '',
    worldBounds?.maxZ ?? '',
    heightComposition?.mode ?? '',
    heightComposition?.policyVersion ?? '',
    terrainDatasetId ?? '',
    summarizeLocalEditTileSignature(dynamicGround),
    `scene-profile:${SCENE_COMPILED_GROUND_PROFILE_VERSION}`,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.renderChunksPerTile,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.collisionChunksPerTile,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.renderSampleStepMultiplier,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.minRenderSampleStepMeters,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.collisionSampleStepMultiplier,
    SCENE_COMPILED_GROUND_BUILD_OPTIONS.minCollisionSampleStepMeters,
  ].join('|')
}

export function resolveSceneCompiledGroundPackagePaths(sceneId: string): {
  manifestPath: string
  renderRootPath: string
  collisionRootPath: string
} {
  const sceneRoot = `scenes/${encodeURIComponent(sceneId)}/compiled-ground`
  return {
    manifestPath: `${sceneRoot}/manifest.json`,
    renderRootPath: `${sceneRoot}/render`,
    collisionRootPath: `${sceneRoot}/collision`,
  }
}

function estimateStringBytes(value: string | null | undefined): number {
  return typeof value === 'string' ? value.length * 2 : 0
}

function estimateCompiledGroundManifestBytes(manifest: CompiledGroundManifest): number {
  let total = 512
  total += estimateStringBytes(manifest.sceneId)
  total += estimateStringBytes(manifest.groundNodeId)
  total += 8 * 16
  total += (manifest.renderTiles?.length ?? 0) * 80
  total += (manifest.collisionTiles?.length ?? 0) * 56
  for (const tile of manifest.renderTiles ?? []) {
    total += estimateStringBytes(tile.key)
    total += estimateStringBytes(tile.path)
  }
  for (const tile of manifest.collisionTiles ?? []) {
    total += estimateStringBytes(tile.key)
    total += estimateStringBytes(tile.path)
  }
  return total
}

export function estimateSceneCompiledGroundPackageBytes(pkg: SceneCompiledGroundPackage): number {
  let total = estimateCompiledGroundManifestBytes(pkg.manifest)
  pkg.files.forEach((buffer) => {
    total += buffer.byteLength
  })
  return total
}

export async function loadSceneCompiledGroundPackageFromCache(
  buildKey: string,
  options: {
    sourceSignature?: string
    allowStale?: boolean
  } = {},
): Promise<SceneCompiledGroundCacheLoadResult> {
  const startedAt = Date.now()
  const normalizedBuildKey = typeof buildKey === 'string' ? buildKey.trim() : ''
  if (!normalizedBuildKey) {
    return {
      pkg: null,
      diagnostics: {
        buildKey: '',
        status: 'miss',
        elapsedMs: Date.now() - startedAt,
        indexedFileCount: 0,
        loadedFileCount: 0,
        missingFileCount: 0,
        renderTileCount: 0,
        collisionTileCount: 0,
        totalBytes: 0,
      },
    }
  }

  const expectedSourceSignature = typeof options.sourceSignature === 'string'
    ? options.sourceSignature.trim()
    : ''
  const memoryCached = sceneCompiledGroundMemoryCache.get(normalizedBuildKey) ?? null
  if (
    memoryCached
    && (
      options.allowStale === true
      || !expectedSourceSignature
      || memoryCached.sourceSignature === expectedSourceSignature
    )
  ) {
    return {
      pkg: memoryCached.pkg,
      diagnostics: {
        buildKey: normalizedBuildKey,
        status: 'hit',
        elapsedMs: Date.now() - startedAt,
        indexedFileCount: memoryCached.pkg.files.size,
        loadedFileCount: memoryCached.pkg.files.size,
        missingFileCount: 0,
        renderTileCount: memoryCached.pkg.manifest.renderTiles.length,
        collisionTileCount: memoryCached.pkg.manifest.collisionTiles.length,
        totalBytes: estimateSceneCompiledGroundPackageBytes(memoryCached.pkg),
      },
    }
  }

  const index = await loadPackageIndex(normalizedBuildKey)
  if (!index) {
    return {
      pkg: null,
      diagnostics: {
        buildKey: normalizedBuildKey,
        status: 'miss',
        elapsedMs: Date.now() - startedAt,
        indexedFileCount: 0,
        loadedFileCount: 0,
        missingFileCount: 0,
        renderTileCount: 0,
        collisionTileCount: 0,
        totalBytes: 0,
      },
    }
  }

  if (
    expectedSourceSignature
    && index.sourceSignature !== expectedSourceSignature
    && options.allowStale !== true
  ) {
    return {
      pkg: null,
      diagnostics: {
        buildKey: normalizedBuildKey,
        status: 'stale',
        elapsedMs: Date.now() - startedAt,
        indexedFileCount: index.files.length,
        loadedFileCount: 0,
        missingFileCount: 0,
        renderTileCount: index.manifest.renderTiles.length,
        collisionTileCount: index.manifest.collisionTiles.length,
        totalBytes: estimateCompiledGroundManifestBytes(index.manifest),
      },
    }
  }

  const files = new Map<string, ArrayBuffer>()
  let missingFile = false
  let missingFileCount = 0
  let totalBytes = estimateCompiledGroundManifestBytes(index.manifest)
  const loadedTileRecords = await getTileRecords(index.files.map((entry) => entry.key))
  for (const entry of index.files) {
    const record = loadedTileRecords.get(entry.key) ?? null
    if (!record?.bytes) {
      missingFile = true
      missingFileCount += 1
      continue
    }
    files.set(entry.path, record.bytes)
    totalBytes += record.bytes.byteLength
  }

  if (missingFile || files.size !== index.files.length) {
    await deletePackageByIndex(index)
    const catalog = await loadCatalog()
    catalog.entries = catalog.entries.filter((entry) => entry.buildKey !== normalizedBuildKey)
    await saveCatalog(catalog)
    return {
      pkg: null,
      diagnostics: {
        buildKey: normalizedBuildKey,
        status: files.size > 0 ? 'partial' : 'corrupt',
        elapsedMs: Date.now() - startedAt,
        indexedFileCount: index.files.length,
        loadedFileCount: files.size,
        missingFileCount: Math.max(1, missingFileCount),
        renderTileCount: index.manifest.renderTiles.length,
        collisionTileCount: index.manifest.collisionTiles.length,
        totalBytes,
      },
    }
  }

  const pkg = {
    manifest: index.manifest,
    files,
  }
  sceneCompiledGroundMemoryCache.set(normalizedBuildKey, {
    pkg,
    sourceSignature: index.sourceSignature,
  })
  void touchPackageCatalogEntry(normalizedBuildKey)
  return {
    pkg,
    diagnostics: {
      buildKey: normalizedBuildKey,
      status: 'hit',
      elapsedMs: Date.now() - startedAt,
      indexedFileCount: index.files.length,
      loadedFileCount: files.size,
      missingFileCount: 0,
      renderTileCount: index.manifest.renderTiles.length,
      collisionTileCount: index.manifest.collisionTiles.length,
      totalBytes,
    },
  }
}

export async function saveSceneCompiledGroundPackageToCache(
  buildKey: string,
  pkg: SceneCompiledGroundPackage,
  sourceSignature: string = '',
): Promise<void> {
  const normalizedBuildKey = typeof buildKey === 'string' ? buildKey.trim() : ''
  if (!normalizedBuildKey) {
    return
  }

  const now = Date.now()
  const previousIndex = await loadPackageIndex(normalizedBuildKey)
  const previousKeys = new Set(previousIndex?.files.map((entry) => entry.key) ?? [])
  const nextEntries: SceneCompiledGroundCacheIndexEntry[] = []

  const fileEntries = Array.from(pkg.files.entries()).map(([path, buffer]) => ({ path, buffer }))
  const tileRecords = fileEntries.map(({ path, buffer }) => {
    const key = getTileStorageKey(normalizedBuildKey, path)
    nextEntries.push({
      path,
      key,
      size: buffer.byteLength,
    })
    previousKeys.delete(key)
    return {
      key,
      buildKey: normalizedBuildKey,
      path,
      size: buffer.byteLength,
      bytes: buffer,
      storedAt: now,
      lastAccessedAt: now,
    } satisfies SceneCompiledGroundTileStorageRecord
  })

  const index: SceneCompiledGroundCacheIndex = {
    version: CACHE_FORMAT_VERSION,
    buildKey: normalizedBuildKey,
    sourceSignature: typeof sourceSignature === 'string' ? sourceSignature.trim() : '',
    storedAt: now,
    lastAccessedAt: now,
    manifest: pkg.manifest,
    files: nextEntries.sort((left, right) => left.path.localeCompare(right.path)),
  }
  await putMetaRecord({
    key: getIndexStorageKey(normalizedBuildKey),
    ...index,
  })

  await writeTileRecordDelta(tileRecords, Array.from(previousKeys))

  const catalog = await loadCatalog()
  catalog.entries = catalog.entries.filter((entry) => entry.buildKey !== normalizedBuildKey)
  catalog.entries.push({
    buildKey: normalizedBuildKey,
    indexKey: getIndexStorageKey(normalizedBuildKey),
    storedAt: now,
    lastAccessedAt: now,
  })
  catalog.entries.sort((left, right) => right.lastAccessedAt - left.lastAccessedAt)
  await saveCatalog(catalog)
  await pruneCatalog()
  sceneCompiledGroundMemoryCache.set(normalizedBuildKey, {
    pkg,
    sourceSignature: index.sourceSignature,
  })
}

function toSceneCompiledGroundPackage(
  built: Awaited<ReturnType<typeof buildCompiledGroundPackageFilesAsync>>,
): SceneCompiledGroundPackage | null {
  if (!built) {
    return null
  }
  const files = new Map<string, ArrayBuffer>()
  Object.entries(built.files).forEach(([path, bytes]) => {
    files.set(path, toArrayBuffer(bytes))
  })
  return {
    manifest: built.manifest,
    files,
  }
}

async function buildSceneCompiledGroundPackage(
  document: SceneJsonExportDocument,
  options: {
    includedTileKeys?: string[]
    onProgress?: (progress: CompiledGroundBuildProgress) => void
  } = {},
): Promise<SceneCompiledGroundPackage | null> {
  const built = await buildCompiledGroundPackageFilesAsync(document, {
    yieldEveryTiles: 2,
    workerCount: resolvePreferredCompiledGroundWorkerCount(),
    ...SCENE_COMPILED_GROUND_BUILD_OPTIONS,
    includedTileKeys: options.includedTileKeys,
    onProgress: options.onProgress,
  })
  return toSceneCompiledGroundPackage(built)
}

function mergeTileRecords<T extends { key: string }>(
  baseRecords: T[],
  patchRecords: T[],
): T[] {
  const next = new Map<string, T>()
  for (const record of baseRecords) {
    next.set(record.key, record)
  }
  for (const record of patchRecords) {
    next.set(record.key, record)
  }
  return Array.from(next.values()).sort((left, right) => {
    const leftRow = Number((left as { row?: number }).row ?? 0)
    const rightRow = Number((right as { row?: number }).row ?? 0)
    const leftColumn = Number((left as { column?: number }).column ?? 0)
    const rightColumn = Number((right as { column?: number }).column ?? 0)
    return (leftRow - rightRow) || (leftColumn - rightColumn)
  })
}

function computeManifestBounds(
  manifest: Pick<CompiledGroundManifest, 'renderTiles' | 'collisionTiles' | 'baseHeight'>,
): CompiledGroundBounds {
  const renderTiles = manifest.renderTiles ?? []
  if (!renderTiles.length) {
    const baseHeight = Number.isFinite(manifest.baseHeight) ? Number(manifest.baseHeight) : 0
    return {
      minX: 0,
      minY: baseHeight,
      minZ: 0,
      maxX: 0,
      maxY: baseHeight,
      maxZ: 0,
    }
  }
  return {
    minX: Math.min(...renderTiles.map((tile) => tile.bounds.minX)),
    minY: Math.min(...renderTiles.map((tile) => tile.bounds.minY)),
    minZ: Math.min(...renderTiles.map((tile) => tile.bounds.minZ)),
    maxX: Math.max(...renderTiles.map((tile) => tile.bounds.maxX)),
    maxY: Math.max(...renderTiles.map((tile) => tile.bounds.maxY)),
    maxZ: Math.max(...renderTiles.map((tile) => tile.bounds.maxZ)),
  }
}

function mergeSceneCompiledGroundPackages(
  basePkg: SceneCompiledGroundPackage,
  patchPkg: SceneCompiledGroundPackage,
): SceneCompiledGroundPackage {
  const renderTiles = mergeTileRecords<CompiledGroundRenderTileRecord>(basePkg.manifest.renderTiles, patchPkg.manifest.renderTiles)
  const collisionTiles = mergeTileRecords<CompiledGroundCollisionTileRecord>(basePkg.manifest.collisionTiles, patchPkg.manifest.collisionTiles)
  const manifestWithoutRevision: Omit<CompiledGroundManifest, 'revision'> = {
    version: COMPILED_GROUND_MANIFEST_VERSION,
    sceneId: basePkg.manifest.sceneId,
    groundNodeId: basePkg.manifest.groundNodeId,
    chunkSizeMeters: basePkg.manifest.chunkSizeMeters,
    baseHeight: basePkg.manifest.baseHeight,
    renderTileSizeMeters: basePkg.manifest.renderTileSizeMeters,
    collisionTileSizeMeters: basePkg.manifest.collisionTileSizeMeters,
    coveredChunkBounds: basePkg.manifest.coveredChunkBounds,
    bounds: computeManifestBounds({
      renderTiles,
      collisionTiles,
      baseHeight: basePkg.manifest.baseHeight,
    }),
    renderTiles,
    collisionTiles,
  }
  const files = new Map<string, ArrayBuffer>(basePkg.files)
  patchPkg.files.forEach((buffer, path) => {
    files.set(path, buffer)
  })
  return {
    manifest: {
      ...manifestWithoutRevision,
      revision: computeCompiledGroundManifestRevision(manifestWithoutRevision),
    },
    files,
  }
}

export async function ensureSceneCompiledGroundPackage(
  document: SceneJsonExportDocument,
  buildKey: string,
  options: EnsureSceneCompiledGroundOptions = {},
): Promise<SceneCompiledGroundPackage> {
  if (!options.forceRebuild) {
    const cached = await loadSceneCompiledGroundPackageFromCache(buildKey, {
      sourceSignature: options.sourceSignature,
    })
    if (cached.pkg) {
      return cached.pkg
    }
  }
  const built = await buildSceneCompiledGroundPackage(document, {
    onProgress: options.onProgress,
  })
  if (!built) {
    throw new Error(`Compiled ground build failed for scene ${document.id}`)
  }
  await saveSceneCompiledGroundPackageToCache(buildKey, built, options.sourceSignature ?? '')
  return built
}

export async function rebuildSceneCompiledGroundPackageChunks(
  document: SceneJsonExportDocument,
  buildKey: string,
  chunkKeys: string[],
  options: RebuildSceneCompiledGroundChunksOptions = {},
): Promise<SceneCompiledGroundPackage> {
  const normalizedChunkKeys = Array.from(new Set(
    (Array.isArray(chunkKeys) ? chunkKeys : [])
      .map((key) => typeof key === 'string' ? key.trim() : '')
      .filter((key) => key.length > 0),
  ))
  if (!normalizedChunkKeys.length) {
    return ensureSceneCompiledGroundPackage(document, buildKey, {
      sourceSignature: options.sourceSignature,
      onProgress: options.onProgress,
    })
  }

  const cached = await loadSceneCompiledGroundPackageFromCache(buildKey, {
    allowStale: true,
  })
  if (!cached.pkg) {
    return ensureSceneCompiledGroundPackage(document, buildKey, {
      forceRebuild: true,
      sourceSignature: options.sourceSignature,
      onProgress: options.onProgress,
    })
  }

  const patch = await buildSceneCompiledGroundPackage(document, {
    includedTileKeys: normalizedChunkKeys,
    onProgress: options.onProgress,
  })
  if (!patch) {
    throw new Error(`Compiled ground partial rebuild failed for scene ${document.id}`)
  }

  const merged = mergeSceneCompiledGroundPackages(cached.pkg, patch)
  await saveSceneCompiledGroundPackageToCache(buildKey, merged, options.sourceSignature ?? '')
  return merged
}

export function getSceneCompiledGroundPackageFileBytes(
  pkg: SceneCompiledGroundPackage,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  pkg.files.forEach((buffer, path) => {
    files[path] = new Uint8Array(buffer)
  })
  return files
}

export function clearSceneCompiledGroundPackageMemoryCache(buildKey?: string | null): void {
  const normalizedBuildKey = typeof buildKey === 'string' ? buildKey.trim() : ''
  if (!normalizedBuildKey) {
    sceneCompiledGroundMemoryCache.clear()
    return
  }
  sceneCompiledGroundMemoryCache.delete(normalizedBuildKey)
}
