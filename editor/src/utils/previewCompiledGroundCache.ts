import {
  createIndexedDbPersistentAssetStorage,
  createNoopPersistentAssetStorage,
  isIndexedDbPersistentAssetStorageSupported,
  type CompiledGroundManifest,
  type PersistentAssetStorage,
} from '@schema'

export type PreviewCompiledGroundPackage = {
  manifest: CompiledGroundManifest
  files: Map<string, ArrayBuffer>
}

export type PreviewCompiledGroundCacheLoadDiagnostics = {
  buildKey: string
  status: 'hit' | 'miss' | 'partial' | 'corrupt'
  elapsedMs: number
  indexedFileCount: number
  loadedFileCount: number
  missingFileCount: number
  renderTileCount: number
  collisionTileCount: number
  totalBytes: number
}

export type PreviewCompiledGroundCacheLoadResult = {
  pkg: PreviewCompiledGroundPackage | null
  diagnostics: PreviewCompiledGroundCacheLoadDiagnostics
}

type PreviewCompiledGroundCacheIndexEntry = {
  path: string
  key: string
  size: number
}

type PreviewCompiledGroundCacheIndex = {
  version: number
  buildKey: string
  storedAt: number
  lastAccessedAt: number
  manifest: CompiledGroundManifest
  files: PreviewCompiledGroundCacheIndexEntry[]
}

type PreviewCompiledGroundCacheCatalogEntry = {
  buildKey: string
  indexKey: string
  storedAt: number
  lastAccessedAt: number
}

type PreviewCompiledGroundCacheCatalog = {
  version: number
  entries: PreviewCompiledGroundCacheCatalogEntry[]
}

const CACHE_FORMAT_VERSION = 2
const CACHE_KEY_PREFIX = `preview-compiled-ground:v${CACHE_FORMAT_VERSION}:`
const CACHE_CATALOG_KEY = `${CACHE_KEY_PREFIX}__catalog__`
const CACHE_MAX_PACKAGES = 4
const CACHE_BATCH_SIZE = 24
export const PREVIEW_COMPILED_GROUND_PERSIST_MAX_BYTES = 512 * 1024 * 1024

let previewCompiledGroundCacheStorage: PersistentAssetStorage | null = null

function getPreviewCompiledGroundCacheStorage(): PersistentAssetStorage {
  if (!previewCompiledGroundCacheStorage) {
    previewCompiledGroundCacheStorage = isIndexedDbPersistentAssetStorageSupported()
      ? createIndexedDbPersistentAssetStorage({
          dbName: 'harmony-preview-compiled-ground',
          storeName: 'compiled-ground-packages',
          version: 1,
          maxRecords: 30000,
          pruneBatch: 512,
        })
      : createNoopPersistentAssetStorage()
  }
  return previewCompiledGroundCacheStorage
}

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

function encodeJson(value: unknown): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(JSON.stringify(value)))
}

function decodeJson<T>(bytes: ArrayBuffer): T | null {
  try {
    const decoded = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T
    return decoded && typeof decoded === 'object' ? decoded : null
  } catch (_error) {
    return null
  }
}

function normalizeCatalog(value: PreviewCompiledGroundCacheCatalog | null | undefined): PreviewCompiledGroundCacheCatalog {
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

async function loadCatalog(storage: PersistentAssetStorage): Promise<PreviewCompiledGroundCacheCatalog> {
  const record = await storage.get(CACHE_CATALOG_KEY)
  if (!record?.bytes) {
    return normalizeCatalog(null)
  }
  return normalizeCatalog(decodeJson<PreviewCompiledGroundCacheCatalog>(record.bytes))
}

async function saveCatalog(storage: PersistentAssetStorage, catalog: PreviewCompiledGroundCacheCatalog): Promise<void> {
  const now = Date.now()
  const bytes = encodeJson({
    version: CACHE_FORMAT_VERSION,
    entries: catalog.entries,
  })
  await storage.put({
    key: CACHE_CATALOG_KEY,
    bytes,
    size: bytes.byteLength,
    mimeType: 'application/json',
    filename: 'catalog.json',
    storedAt: now,
    lastAccessedAt: now,
  })
}

async function runInBatches<T>(
  items: T[],
  callback: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += CACHE_BATCH_SIZE) {
    await Promise.all(items.slice(index, index + CACHE_BATCH_SIZE).map((item) => callback(item)))
  }
}

async function deletePackageByIndex(
  storage: PersistentAssetStorage,
  index: PreviewCompiledGroundCacheIndex | null | undefined,
): Promise<void> {
  if (!index) {
    return
  }
  await runInBatches(index.files, async (entry) => {
    await storage.delete(entry.key)
  })
  await storage.delete(getIndexStorageKey(index.buildKey))
}

async function loadPackageIndex(
  storage: PersistentAssetStorage,
  buildKey: string,
): Promise<PreviewCompiledGroundCacheIndex | null> {
  const record = await storage.get(getIndexStorageKey(buildKey))
  if (!record?.bytes) {
    return null
  }
  const decoded = decodeJson<PreviewCompiledGroundCacheIndex>(record.bytes)
  if (!decoded || decoded.version !== CACHE_FORMAT_VERSION || !Array.isArray(decoded.files) || !decoded.manifest) {
    await storage.delete(record.key)
    return null
  }
  return decoded
}

async function touchPackageCatalogEntry(
  storage: PersistentAssetStorage,
  buildKey: string,
): Promise<void> {
  const catalog = await loadCatalog(storage)
  const entry = catalog.entries.find((candidate) => candidate.buildKey === buildKey)
  if (!entry) {
    return
  }
  entry.lastAccessedAt = Date.now()
  await saveCatalog(storage, catalog)
}

async function pruneCatalog(storage: PersistentAssetStorage): Promise<void> {
  const catalog = await loadCatalog(storage)
  if (catalog.entries.length <= CACHE_MAX_PACKAGES) {
    return
  }
  catalog.entries.sort((left, right) => right.lastAccessedAt - left.lastAccessedAt)
  const retained = catalog.entries.slice(0, CACHE_MAX_PACKAGES)
  const removed = catalog.entries.slice(CACHE_MAX_PACKAGES)
  for (const entry of removed) {
    const index = await loadPackageIndex(storage, entry.buildKey)
    await deletePackageByIndex(storage, index)
  }
  catalog.entries = retained
  await saveCatalog(storage, catalog)
}

export function estimatePreviewCompiledGroundPackageBytes(pkg: PreviewCompiledGroundPackage): number {
  let total = encodeJson(pkg.manifest).byteLength
  pkg.files.forEach((buffer) => {
    total += buffer.byteLength
  })
  return total
}

export async function loadPreviewCompiledGroundPackageFromCache(
  buildKey: string,
): Promise<PreviewCompiledGroundCacheLoadResult> {
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
  const storage = getPreviewCompiledGroundCacheStorage()
  const index = await loadPackageIndex(storage, normalizedBuildKey)
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

  const files = new Map<string, ArrayBuffer>()
  let missingFile = false
  let missingFileCount = 0
  let totalBytes = encodeJson(index.manifest).byteLength
  await runInBatches(index.files, async (entry) => {
    if (missingFile) {
      return
    }
    const record = await storage.get(entry.key)
    if (!record?.bytes) {
      missingFile = true
      missingFileCount += 1
      return
    }
    files.set(entry.path, record.bytes)
    totalBytes += record.bytes.byteLength
  })

  if (missingFile || files.size !== index.files.length) {
    await deletePackageByIndex(storage, index)
    const catalog = await loadCatalog(storage)
    catalog.entries = catalog.entries.filter((entry) => entry.buildKey !== normalizedBuildKey)
    await saveCatalog(storage, catalog)
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

  await storage.touch?.(getIndexStorageKey(normalizedBuildKey), Date.now())
  void touchPackageCatalogEntry(storage, normalizedBuildKey)
  const pkg = {
    manifest: index.manifest,
    files,
  }
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

export async function savePreviewCompiledGroundPackageToCache(
  buildKey: string,
  pkg: PreviewCompiledGroundPackage,
): Promise<void> {
  const normalizedBuildKey = typeof buildKey === 'string' ? buildKey.trim() : ''
  if (!normalizedBuildKey) {
    return
  }

  const totalBytes = estimatePreviewCompiledGroundPackageBytes(pkg)
  if (totalBytes > PREVIEW_COMPILED_GROUND_PERSIST_MAX_BYTES) {
    return
  }

  const storage = getPreviewCompiledGroundCacheStorage()
  const now = Date.now()
  const previousIndex = await loadPackageIndex(storage, normalizedBuildKey)
  const previousKeys = new Set(previousIndex?.files.map((entry) => entry.key) ?? [])
  const nextEntries: PreviewCompiledGroundCacheIndexEntry[] = []

  const fileEntries = Array.from(pkg.files.entries()).map(([path, buffer]) => ({ path, buffer }))
  await runInBatches(fileEntries, async ({ path, buffer }) => {
    const key = getTileStorageKey(normalizedBuildKey, path)
    nextEntries.push({
      path,
      key,
      size: buffer.byteLength,
    })
    previousKeys.delete(key)
    await storage.put({
      key,
      bytes: buffer,
      size: buffer.byteLength,
      mimeType: 'application/octet-stream',
      filename: path.split('/').pop() ?? 'tile.bin',
      storedAt: now,
      lastAccessedAt: now,
    })
  })

  const index: PreviewCompiledGroundCacheIndex = {
    version: CACHE_FORMAT_VERSION,
    buildKey: normalizedBuildKey,
    storedAt: now,
    lastAccessedAt: now,
    manifest: pkg.manifest,
    files: nextEntries.sort((left, right) => left.path.localeCompare(right.path)),
  }
  const indexBytes = encodeJson(index)
  await storage.put({
    key: getIndexStorageKey(normalizedBuildKey),
    bytes: indexBytes,
    size: indexBytes.byteLength,
    mimeType: 'application/json',
    filename: `${normalizedBuildKey}.index.json`,
    storedAt: now,
    lastAccessedAt: now,
  })

  if (previousKeys.size > 0) {
    await runInBatches(Array.from(previousKeys), async (key) => {
      await storage.delete(key)
    })
  }

  const catalog = await loadCatalog(storage)
  const retainedEntries = catalog.entries.filter((entry) => entry.buildKey !== normalizedBuildKey)
  retainedEntries.push({
    buildKey: normalizedBuildKey,
    indexKey: getIndexStorageKey(normalizedBuildKey),
    storedAt: now,
    lastAccessedAt: now,
  })
  catalog.entries = retainedEntries
    .sort((left, right) => right.lastAccessedAt - left.lastAccessedAt)
  await saveCatalog(storage, catalog)
  await pruneCatalog(storage)
}
