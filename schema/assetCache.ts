import { fetchAssetBlob as fetchAssetBlobInternal } from './assetDownload'
import { Semaphore, withSemaphore } from './concurrency'
import {
  resolvePersistentAssetKeys,
  type PersistentAssetStorage,
} from './persistentAssetStorage'

export {
  configureAssetBlobDownloader,
  configureAssetDownloadHostMirrors,
  AssetDownloadWorkerUnavailableError,
  fetchAssetBlob,
} from './assetDownload'

export type { AssetBlobPayload, AssetBlobDownloader, AssetDownloadHostMirrorMap } from './assetDownload'

const NodeBuffer: { from: (data: string, encoding: string) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number } } | undefined =
  typeof globalThis !== 'undefined' && (globalThis as any).Buffer
    ? (globalThis as any).Buffer
    : undefined

const DEFAULT_ASSET_DOWNLOAD_CONCURRENCY = 3
let assetDownloadSemaphore = new Semaphore(DEFAULT_ASSET_DOWNLOAD_CONCURRENCY)

/**
 * Bound how many remote asset downloads may be in flight at once. Runtime node
 * loads can burst when many LOD switches happen in the same frame; without a
 * cap they flood the main thread with concurrent fetch/uni.downloadFile work.
 */
export function configureAssetDownloadConcurrency(concurrency: number): void {
  const normalized = Number.isInteger(concurrency) && concurrency > 0
    ? concurrency
    : DEFAULT_ASSET_DOWNLOAD_CONCURRENCY
  assetDownloadSemaphore = new Semaphore(normalized)
}

export type AssetCacheStatus = 'idle' | 'downloading' | 'cached' | 'error'

export interface AssetCacheEntry {
  assetId: string
  status: AssetCacheStatus
  progress: number
  error: string | null
  blob: Blob | null
  blobUrl: string | null
  /**
   * Raw bytes behind `blob`, kept only when the downloader already had them.
   *
   * Model parsing can consume this directly instead of wrapping the blob in a
   * File and reading it back through FileReader (an extra full-buffer copy on the
   * render main thread, which mini-program runtimes pay dearly for). It is
   * released as soon as the parse that requested it finishes, so the steady-state
   * memory profile matches a cache that only holds blobs.
   */
  bytes: ArrayBuffer | null
  size: number
  lastUsedAt: number
  abortController: AbortController | null
  mimeType: string | null
  filename: string | null
  downloadUrl: string | null
  serverUpdatedAt?: string | null
  contentHash?: string | null
  contentHashAlgorithm?: string | null
  persistentKey?: string | null
}

export interface AssetSource {
  kind: 'arraybuffer' | 'data-url' | 'remote-url' | 'blob'
  data?: ArrayBuffer
  dataUrl?: string
  url?: string
  blob?: Blob
  mimeType?: string | null
  filename?: string | null
}

/**
 * 默认的内存缓存条目上限（微信等受限环境下的兜底值）。
 * 只限制内存中的 Blob/object URL，不影响持久化磁盘缓存。
 */
export const DEFAULT_ASSET_CACHE_MAX_ENTRIES = 80

export interface AssetCacheOptions {
  maxEntries?: number
  persistentStorage?: PersistentAssetStorage | null
}

export interface AssetLoadPersistenceOptions {
  keys?: string[]
  contentHash?: string | null
  contentHashAlgorithm?: string | null
  serverUpdatedAt?: string | null
}

export interface AssetLoadOptions {
  force?: boolean
  onProgress?: (value: number) => void
  persistence?: AssetLoadPersistenceOptions
}

export class AssetCache {
  private readonly entries = new Map<string, AssetCacheEntry>()
  private readonly persistentStorage: PersistentAssetStorage | null
  private readonly pendingHydrations = new Map<string, Promise<AssetCacheEntry | null>>()
  private maxEntries: number

  constructor(options: AssetCacheOptions = {}) {
    const requestedMaxEntries = options.maxEntries ?? DEFAULT_ASSET_CACHE_MAX_ENTRIES
    this.maxEntries = Number.isFinite(requestedMaxEntries) ? (requestedMaxEntries as number) : Infinity
    this.persistentStorage = options.persistentStorage ?? null
  }

  ensureEntry(assetId: string): AssetCacheEntry {
    let entry = this.entries.get(assetId)
    if (!entry) {
      entry = createEmptyEntry(assetId)
      this.entries.set(assetId, entry)
    }
    return entry
  }

  async getEntry(assetId: string): Promise<AssetCacheEntry | null | undefined> {
    return this.entries.get(assetId) ?? null
  }

  peekEntry(assetId: string): AssetCacheEntry | null {
    return this.entries.get(assetId) ?? null
  }

  async hydrateFromPersistent(assetId: string, persistence: AssetLoadPersistenceOptions = {}): Promise<AssetCacheEntry | null> {
    const existing = this.entries.get(assetId)
    if (existing?.status === 'cached') {
      return existing
    }
    if (!this.persistentStorage) {
      return null
    }

    const keys = resolvePersistentAssetKeys({
      assetId,
      contentHash: persistence.contentHash,
      keys: persistence.keys,
    })
    if (!keys.length) {
      return null
    }

    const hydrationKey = `${assetId}::${keys.join('|')}`
    const pending = this.pendingHydrations.get(hydrationKey)
    if (pending) {
      return pending
    }

    const hydratePromise = this.readFromPersistent(assetId, keys, persistence)
      .finally(() => {
        this.pendingHydrations.delete(hydrationKey)
      })

    this.pendingHydrations.set(hydrationKey, hydratePromise)
    return hydratePromise
  }

  hasCache(assetId: string): boolean {
    return this.entries.get(assetId)?.status === 'cached'
  }

  touch(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (!entry) {
      return
    }
    entry.lastUsedAt = now()
    if (entry.persistentKey) {
      void this.persistentStorage?.touch?.(entry.persistentKey, entry.lastUsedAt)
    }
  }

  setMaxEntries(count: number): void {
    this.maxEntries = Math.max(0, count)
  }

  async storeArrayBuffer(assetId: string, arrayBuffer: ArrayBuffer, payload: {
    mimeType?: string | null
    filename?: string | null
    downloadUrl?: string | null
    serverUpdatedAt?: string | null
    contentHash?: string | null
    contentHashAlgorithm?: string | null
    persistentKeys?: string[]
  } = {}): Promise<AssetCacheEntry> {
    const entry = this.applyArrayBufferToEntry(assetId, arrayBuffer, payload)
    await this.persistArrayBuffer(assetId, arrayBuffer, entry, payload)
    return entry
  }

  async storeBlob(assetId: string, blob: Blob, payload: {
    mimeType?: string | null
    filename?: string | null
    downloadUrl?: string | null
    serverUpdatedAt?: string | null
    contentHash?: string | null
    contentHashAlgorithm?: string | null
    persistentKeys?: string[]
    bytes?: ArrayBuffer | null
  } = {}): Promise<AssetCacheEntry> {
    const entry = this.applyBlobToEntry(assetId, blob, payload)
    await this.persistBlob(assetId, blob, entry, payload)
    return entry
  }

  removeCache(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (!entry) {
      return
    }
    if (entry.abortController) {
      entry.abortController.abort()
      entry.abortController = null
    }
    revokeEntryBlobUrl(entry)
    entry.status = 'idle'
    entry.progress = 0
    entry.error = null
    entry.blob = null
    entry.blobUrl = null
    entry.bytes = null
    entry.size = 0
    entry.mimeType = null
    entry.filename = null
    entry.downloadUrl = null
    entry.serverUpdatedAt = null
    entry.contentHash = null
    entry.contentHashAlgorithm = null
    const persistentKeys = resolvePersistentAssetKeys({
      assetId,
      contentHash: entry.contentHash ?? null,
      keys: entry.persistentKey ? [entry.persistentKey] : [],
    })
    entry.persistentKey = null
    entry.lastUsedAt = now()

    for (const key of persistentKeys) {
      void this.persistentStorage?.delete(key)
    }
  }

  setError(assetId: string, message: string): void {
    const entry = this.ensureEntry(assetId)
    entry.status = 'error'
    entry.error = message
    entry.progress = 0
    entry.abortController = null
    entry.lastUsedAt = now()
  }

  /**
   * Drop the retained raw bytes for an entry while keeping its blob cached.
   *
   * Call this once the consumer that needed real bytes (the GLB parser) is done,
   * so the cache goes back to holding a single copy per asset.
   */
  releaseBytes(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (entry) {
      entry.bytes = null
    }
  }

  /** Retained raw bytes for an entry, if the downloader handed them over. */
  getBytes(assetId: string): ArrayBuffer | null {
    return this.entries.get(assetId)?.bytes ?? null
  }

  /**
   * Approximate bytes the in-memory cache currently retains: every cached blob
   * plus the raw bytes a downloader handed over and the parser has not released
   * yet. Mini-program runtimes expose no heap API, so the viewer's debug overlay
   * reports this as the cache-visible part of its memory footprint.
   */
  getInMemoryBytes(): number {
    let total = 0
    for (const entry of this.entries.values()) {
      const blobSize = entry.blob?.size ?? 0
      if (Number.isFinite(blobSize) && blobSize > 0) {
        total += blobSize
      }
      const rawSize = entry.bytes?.byteLength ?? 0
      if (Number.isFinite(rawSize) && rawSize > 0) {
        total += rawSize
      }
    }
    return total
  }

  releaseInMemoryBlob(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (!entry) {
      return
    }
    revokeEntryBlobUrl(entry)
    entry.blob = null
    entry.blobUrl = null
    entry.bytes = null
    entry.status = 'idle'
    entry.progress = 0
    entry.error = null
    entry.size = 0
    entry.abortController = null
    entry.lastUsedAt = now()
  }

  clearInMemory(): void {
    for (const entry of this.entries.values()) {
      if (entry.abortController) {
        entry.abortController.abort()
        entry.abortController = null
      }
      revokeEntryBlobUrl(entry)
      entry.blob = null
      entry.blobUrl = null
      entry.bytes = null
    }
    this.entries.clear()
    this.pendingHydrations.clear()
  }

  evictIfNeeded(preferredAssetId?: string): void {
    if (!Number.isFinite(this.maxEntries) || this.maxEntries <= 0) {
      return
    }
    const cachedEntries = Array.from(this.entries.values()).filter((item) => item.status === 'cached')
    if (cachedEntries.length <= this.maxEntries) {
      return
    }

    cachedEntries.sort((a, b) => a.lastUsedAt - b.lastUsedAt)

    const removable = cachedEntries.filter((entry) => !preferredAssetId || entry.assetId !== preferredAssetId)
    const totalToRemove = cachedEntries.length - this.maxEntries
    let removed = 0

    for (const entry of removable) {
      if (removed >= totalToRemove) {
        break
      }
      this.releaseInMemoryBlob(entry.assetId)
      removed += 1
    }

    if (cachedEntries.length - removed > this.maxEntries && preferredAssetId) {
      this.releaseInMemoryBlob(preferredAssetId)
    }
  }

  createFileFromCache(assetId: string): File | null {
    const entry = this.entries.get(assetId)
    if (!entry || entry.status !== 'cached' || !entry.blob) {
      return null
    }
    const filename = entry.filename && entry.filename.trim().length ? entry.filename : `${assetId}`
    const mimeType = entry.mimeType ?? 'application/octet-stream'
    try {
      return new File([entry.blob], filename, { type: mimeType })
    } catch (_error) {
      return null
    }
  }

  getPersistentStorage(): PersistentAssetStorage | null {
    return this.persistentStorage
  }

  private async readFromPersistent(
    assetId: string,
    keys: string[],
    persistence: AssetLoadPersistenceOptions,
  ): Promise<AssetCacheEntry | null> {
    for (const key of keys) {
      const record = await this.persistentStorage?.get(key)
      if (!record || this.isStalePersistentRecord(record, persistence)) {
        continue
      }
      const entry = this.applyArrayBufferToEntry(assetId, record.bytes, {
        mimeType: record.mimeType,
        filename: record.filename,
        downloadUrl: record.downloadUrl,
        serverUpdatedAt: record.serverUpdatedAt ?? persistence.serverUpdatedAt ?? null,
        contentHash: record.contentHash ?? persistence.contentHash ?? null,
        contentHashAlgorithm: record.contentHashAlgorithm ?? persistence.contentHashAlgorithm ?? null,
        persistentKeys: [key],
      })
      entry.persistentKey = key
      entry.lastUsedAt = now()
      void this.persistentStorage?.touch?.(key, entry.lastUsedAt)
      return entry
    }
    return null
  }

  private applyArrayBufferToEntry(
    assetId: string,
    arrayBuffer: ArrayBuffer,
    payload: {
      mimeType?: string | null
      filename?: string | null
      downloadUrl?: string | null
      serverUpdatedAt?: string | null
      contentHash?: string | null
      contentHashAlgorithm?: string | null
      persistentKeys?: string[]
    },
  ): AssetCacheEntry {
    const entry = this.ensureEntry(assetId)
    revokeEntryBlobUrl(entry)

    let blob: Blob | null = null
    if (typeof Blob !== 'undefined') {
      blob = new Blob([arrayBuffer], { type: payload.mimeType ?? entry.mimeType ?? 'application/octet-stream' })
      entry.blobUrl = createObjectUrl(blob)
    }

    entry.blob = blob
    entry.bytes = arrayBuffer
    entry.mimeType = payload.mimeType ?? blob?.type ?? entry.mimeType ?? null
    entry.filename = payload.filename ?? entry.filename ?? null
    entry.downloadUrl = payload.downloadUrl ?? entry.downloadUrl ?? null
    entry.size = arrayBuffer.byteLength
    entry.serverUpdatedAt = payload.serverUpdatedAt ?? entry.serverUpdatedAt ?? null
    entry.contentHash = payload.contentHash ?? entry.contentHash ?? null
    entry.contentHashAlgorithm = payload.contentHashAlgorithm ?? entry.contentHashAlgorithm ?? null
    entry.persistentKey = resolvePersistentAssetKeys({
      assetId,
      contentHash: payload.contentHash ?? entry.contentHash ?? null,
      keys: payload.persistentKeys,
    })[0] ?? entry.persistentKey ?? null
    finalizeCachedEntry(entry)
    return entry
  }

  private applyBlobToEntry(
    assetId: string,
    blob: Blob,
    payload: {
      mimeType?: string | null
      filename?: string | null
      downloadUrl?: string | null
      serverUpdatedAt?: string | null
      contentHash?: string | null
      contentHashAlgorithm?: string | null
      persistentKeys?: string[]
      bytes?: ArrayBuffer | null
    },
  ): AssetCacheEntry {
    const entry = this.ensureEntry(assetId)
    revokeEntryBlobUrl(entry)

    entry.blob = blob
    entry.bytes = payload.bytes ?? entry.bytes ?? null
    entry.mimeType = payload.mimeType ?? blob.type ?? entry.mimeType ?? null
    entry.filename = payload.filename ?? entry.filename ?? (blob instanceof File ? blob.name : null)
    entry.downloadUrl = payload.downloadUrl ?? entry.downloadUrl ?? null
    entry.size = blob.size
    entry.blobUrl = createObjectUrl(blob)
    entry.serverUpdatedAt = payload.serverUpdatedAt ?? entry.serverUpdatedAt ?? null
    entry.contentHash = payload.contentHash ?? entry.contentHash ?? null
    entry.contentHashAlgorithm = payload.contentHashAlgorithm ?? entry.contentHashAlgorithm ?? null
    entry.persistentKey = resolvePersistentAssetKeys({
      assetId,
      contentHash: payload.contentHash ?? entry.contentHash ?? null,
      keys: payload.persistentKeys,
    })[0] ?? entry.persistentKey ?? null
    finalizeCachedEntry(entry)
    return entry
  }

  private async persistArrayBuffer(
    assetId: string,
    arrayBuffer: ArrayBuffer,
    entry: AssetCacheEntry,
    payload: {
      mimeType?: string | null
      filename?: string | null
      downloadUrl?: string | null
      serverUpdatedAt?: string | null
      contentHash?: string | null
      contentHashAlgorithm?: string | null
      persistentKeys?: string[]
    },
  ): Promise<void> {
    const keys = resolvePersistentAssetKeys({
      assetId,
      contentHash: payload.contentHash ?? entry.contentHash ?? null,
      keys: payload.persistentKeys,
    })
    if (!keys.length || !this.persistentStorage) {
      return
    }
    const bytes = cloneArrayBuffer(arrayBuffer)
    for (const key of keys) {
      await this.persistentStorage.put({
        key,
        bytes,
        size: arrayBuffer.byteLength,
        mimeType: entry.mimeType,
        filename: entry.filename,
        downloadUrl: entry.downloadUrl,
        assetId,
        contentHash: payload.contentHash ?? entry.contentHash ?? null,
        contentHashAlgorithm: payload.contentHashAlgorithm ?? entry.contentHashAlgorithm ?? null,
        serverUpdatedAt: payload.serverUpdatedAt ?? entry.serverUpdatedAt ?? null,
      })
    }
  }

  private async persistBlob(
    assetId: string,
    blob: Blob,
    entry: AssetCacheEntry,
    payload: {
      mimeType?: string | null
      filename?: string | null
      downloadUrl?: string | null
      serverUpdatedAt?: string | null
      contentHash?: string | null
      contentHashAlgorithm?: string | null
      persistentKeys?: string[]
    },
  ): Promise<void> {
    if (!this.persistentStorage || typeof blob.arrayBuffer !== 'function') {
      return
    }
    try {
      const bytes = await blob.arrayBuffer()
      await this.persistArrayBuffer(assetId, bytes, entry, payload)
    } catch (error) {
      console.warn('持久化资源 Blob 失败', assetId, error)
    }
  }

  private isStalePersistentRecord(
    record: { serverUpdatedAt?: string | null },
    persistence: AssetLoadPersistenceOptions,
  ): boolean {
    if (!persistence.serverUpdatedAt || !record.serverUpdatedAt) {
      return false
    }
    return persistence.serverUpdatedAt !== record.serverUpdatedAt
  }
}

export class AssetLoader {
  private readonly cache: AssetCache
  private readonly pending = new Map<string, Promise<AssetCacheEntry>>()

  constructor(cache: AssetCache) {
    this.cache = cache
  }

  getCache(): AssetCache {
    return this.cache
  }

  async load(assetId: string, source: AssetSource, options: AssetLoadOptions = {}): Promise<AssetCacheEntry> {
    if (!assetId) {
      throw new Error('assetId is required')
    }

    const existing = this.pending.get(assetId)
    if (existing) {
      return existing
    }

    if (!options.force) {
      const cached = await this.cache.getEntry(assetId)
      if (cached?.status === 'cached') {
        this.cache.touch(assetId)
        return cached
      }
      const hydrated = await this.cache.hydrateFromPersistent(assetId, options.persistence)
      if (hydrated?.status === 'cached') {
        this.cache.touch(assetId)
        return hydrated
      }
    }

    const promise = this.resolveLoad(assetId, source, options)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.cache.setError(assetId, message)
        throw error
      })
      .finally(() => {
        this.pending.delete(assetId)
      })

    this.pending.set(assetId, promise)
    return promise
  }

  async cancel(assetId: string): Promise<void> {
    const entry = await this.cache.getEntry(assetId)
    if (!entry || entry.status !== 'downloading') {
      return
    }
    entry.abortController?.abort()
    entry.abortController = null
    entry.status = 'idle'
    entry.progress = 0
    entry.error = '下载已取消'
  }

  private async resolveLoad(assetId: string, source: AssetSource, options: AssetLoadOptions): Promise<AssetCacheEntry> {
    switch (source.kind) {
      case 'arraybuffer':
        if (!(source.data instanceof ArrayBuffer) || source.data.byteLength === 0) {
          throw new Error('资源数据为空')
        }
        return this.cache.storeArrayBuffer(assetId, source.data, {
          mimeType: source.mimeType ?? null,
          filename: source.filename ?? null,
          downloadUrl: source.url ?? null,
          serverUpdatedAt: options.persistence?.serverUpdatedAt ?? null,
          contentHash: options.persistence?.contentHash ?? null,
          contentHashAlgorithm: options.persistence?.contentHashAlgorithm ?? null,
          persistentKeys: options.persistence?.keys,
        })
      case 'data-url': {
        const arrayBuffer = decodeDataUrl(source.dataUrl ?? '')
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          throw new Error('资源数据为空')
        }
        return this.cache.storeArrayBuffer(assetId, arrayBuffer, {
          mimeType: source.mimeType ?? null,
          filename: source.filename ?? null,
          downloadUrl: source.url ?? null,
          serverUpdatedAt: options.persistence?.serverUpdatedAt ?? null,
          contentHash: options.persistence?.contentHash ?? null,
          contentHashAlgorithm: options.persistence?.contentHashAlgorithm ?? null,
          persistentKeys: options.persistence?.keys,
        })
      }
      case 'blob': {
        const entry = await this.cache.storeBlob(assetId, source.blob ?? new Blob([]), {
          mimeType: source.mimeType ?? null,
          filename: source.filename ?? null,
          downloadUrl: source.url ?? null,
          serverUpdatedAt: options.persistence?.serverUpdatedAt ?? null,
          contentHash: options.persistence?.contentHash ?? null,
          contentHashAlgorithm: options.persistence?.contentHashAlgorithm ?? null,
          persistentKeys: options.persistence?.keys,
        })
        return entry
      }
      case 'remote-url':
      default:
        return this.loadRemote(assetId, source, options)
    }
  }

  private async loadRemote(assetId: string, source: AssetSource, options: AssetLoadOptions): Promise<AssetCacheEntry> {
    if (!source.url) {
      throw new Error('该资源没有可用的下载地址')
    }
    const sourceUrl = source.url
    const entry = this.cache.ensureEntry(assetId)
    const controller = new AbortController()
    entry.abortController = controller
    entry.status = 'downloading'
    entry.progress = 0
    entry.error = null
    entry.lastUsedAt = now()

    const { blob, mimeType, filename, url: resolvedUrl, bytes } = await withSemaphore(assetDownloadSemaphore, () =>
      fetchAssetBlobInternal(sourceUrl, controller, (progress) => {
        entry.progress = progress
        options.onProgress?.(progress)
      }, { fileDownload: true }),
    )

    return this.cache.storeBlob(assetId, blob, {
      mimeType: source.mimeType ?? mimeType ?? null,
      filename: source.filename ?? filename ?? null,
      downloadUrl: resolvedUrl ?? source.url,
      serverUpdatedAt: options.persistence?.serverUpdatedAt ?? null,
      contentHash: options.persistence?.contentHash ?? null,
      contentHashAlgorithm: options.persistence?.contentHashAlgorithm ?? null,
      persistentKeys: options.persistence?.keys,
      // Keep the raw bytes the downloader already materialised so the model
      // parser does not have to read the blob back out through FileReader.
      bytes: bytes ?? null,
    })
  }
}

function createEmptyEntry(assetId: string): AssetCacheEntry {
  return {
    assetId,
    status: 'idle',
    progress: 0,
    error: null,
    blob: null,
    blobUrl: null,
    bytes: null,
    size: 0,
    lastUsedAt: now(),
    abortController: null,
    mimeType: null,
    filename: null,
    downloadUrl: null,
    serverUpdatedAt: null,
    contentHash: null,
    contentHashAlgorithm: null,
    persistentKey: null,
  }
}

function finalizeCachedEntry(entry: AssetCacheEntry): void {
  entry.status = 'cached'
  entry.progress = 100
  entry.error = null
  entry.abortController = null
  entry.lastUsedAt = now()
}

function now(): number {
  return Date.now()
}

function createObjectUrl(blob: Blob | null): string | null {
  if (!blob) {
    return null
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null
  }
  try {
    return URL.createObjectURL(blob)
  } catch (_error) {
    return null
  }
}

function revokeObjectUrl(url: string): void {
  if (!url) {
    return
  }
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return
  }
  try {
    URL.revokeObjectURL(url)
  } catch (_error) {
    /* noop */
  }
}

function revokeEntryBlobUrl(entry: { blobUrl: string | null }): void {
  if (!entry.blobUrl) {
    return
  }
  revokeObjectUrl(entry.blobUrl)
  entry.blobUrl = null
}

function decodeDataUrl(dataUrl: string): ArrayBuffer | null {
  if (typeof dataUrl !== 'string') {
    return null
  }
  const [, base64] = dataUrl.split(',')
  const clean = (base64 ?? '').replace(/\s/g, '')
  if (!clean) {
    return new ArrayBuffer(0)
  }
  if (typeof atob === 'function') {
    try {
      const binary = atob(clean)
      const length = binary.length
      const buffer = new Uint8Array(length)
      for (let index = 0; index < length; index += 1) {
        buffer[index] = binary.charCodeAt(index)
      }
      return buffer.buffer
    } catch (_error) {
      /* noop */
    }
  }
  if (NodeBuffer) {
    try {
      const buf = NodeBuffer.from(clean, 'base64')
      const array = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      return array
    } catch (_error) {
      /* noop */
    }
  }
  return null
}

function cloneArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0)
}
