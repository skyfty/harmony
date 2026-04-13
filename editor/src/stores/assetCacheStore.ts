import { defineStore } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import { fetchAssetBlob } from '@schema/assetCache'
import type { AssetCacheEntry as SharedAssetCacheEntry, AssetCacheStatus as SharedAssetCacheStatus } from '@schema/assetCache'
import { createIndexedDbPersistentAssetStorage, resolvePersistentAssetKeys } from '@schema'
import { extractExtension, ensureExtension } from '@/utils/blob'
import { invalidateModelObject } from '@schema/modelObjectCache'
import { isImageLikeExtension } from '@schema'

export type AssetCacheStatus = SharedAssetCacheStatus

export type AssetCacheEntry = SharedAssetCacheEntry & {
  serverUpdatedAt?: string | null
}

export interface AssetDownloadOptions {
  force?: boolean
  expectedServerUpdatedAt?: string | null
  contentHash?: string | null
  contentHashAlgorithm?: string | null
}

export interface AssetAccessOptions extends AssetDownloadOptions {
  asset?: ProjectAsset | null
  downloadUrl?: string | null
  name?: string | null
}

export interface AssetThumbnailOptions {
  asset?: ProjectAsset | null
  assetId?: string | null
  cacheId?: string | null
}

const MAX_CACHE_ENTRIES = 10

const ABORT_ERROR_NAME = 'AbortError'

interface FetchedAssetData {
  blob: Blob
  contentType: string | null
  filename: string | null
}

function sanitizeUrlCandidate(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }
  const trimmed = url.trim()
  return trimmed.length ? trimmed : null
}

function isLikelyImageAssetUrl(url: string | null | undefined): boolean {
  const normalized = sanitizeUrlCandidate(url)
  if (!normalized) {
    return false
  }
  if (normalized.startsWith('data:image/')) {
    return true
  }
  if (normalized.startsWith('blob:')) {
    return true
  }
  if (!/^https?:\/\//i.test(normalized)) {
    return false
  }
  const withoutQuery = normalized.split(/[?#]/)[0] ?? normalized
  const extension = extractExtension(withoutQuery)
  if (!extension) {
    return true
  }
  return isImageLikeExtension(extension)
}

function deriveThumbnailFromAsset(asset: ProjectAsset): string | null {
  const type = asset.type
  if (type === 'image' || type === 'texture' || type === 'hdri') {
    const thumbnailCandidate = sanitizeUrlCandidate(asset.thumbnail ?? null)
    if (thumbnailCandidate && isLikelyImageAssetUrl(thumbnailCandidate)) {
      return thumbnailCandidate
    }
    const downloadCandidate = sanitizeUrlCandidate(asset.downloadUrl)
    if (downloadCandidate && isLikelyImageAssetUrl(downloadCandidate)) {
      return downloadCandidate
    }
    return null
  }
  if (type === 'model' || type == 'prefab' || type === 'mesh' || type === 'lod' || type === 'material') {
    const thumbnailCandidate = sanitizeUrlCandidate(asset.thumbnail ?? null)
    return thumbnailCandidate ?? null
  }
  return null
}

function inferFetchedFilename(candidate: string | null, fallbackName: string | null, sourceUrl: string): string | null {
  if (candidate && candidate.trim()) {
    return candidate.trim()
  }
  if (fallbackName && fallbackName.trim()) {
    return fallbackName.trim()
  }
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl)
      const last = parsed.pathname.split('/').filter(Boolean).pop()
      if (last) {
        return decodeURIComponent(last)
      }
    } catch (_error) {
      const sanitized = sourceUrl.split('?')[0]?.split('/').filter(Boolean).pop()
      if (sanitized) {
        try {
          return decodeURIComponent(sanitized)
        } catch (_decodeError) {
          return sanitized
        }
      }
    }
  }
  return null
}

const INDEXED_DB_NAME = 'harmony-asset-cache'
const INDEXED_DB_VERSION = 3
const INDEXED_DB_STORE = 'assets'

interface StoredAssetRecord {
  assetId: string
  blob: Blob
  mimeType: string | null
  filename: string | null
  downloadUrl: string | null
  serverUpdatedAt?: string | null
  size: number
  cachedAt: number
}

const persistentAssetStorage = createIndexedDbPersistentAssetStorage()

let dbPromise: Promise<IDBDatabase | null> | null = null

function isIndexedDbSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function openIndexedDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbSupported()) {
    return Promise.resolve(null)
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = window.indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION)
      request.onerror = () => {
        console.warn('无法打开 IndexedDB', request.error)
        resolve(null)
      }
      request.onupgradeneeded = () => {
        const db = request.result
        let store: IDBObjectStore
        if (!db.objectStoreNames.contains(INDEXED_DB_STORE)) {
          store = db.createObjectStore(INDEXED_DB_STORE, { keyPath: 'assetId' })
        } else {
          store = request.transaction!.objectStore(INDEXED_DB_STORE)
        }
        if (!store.indexNames.contains('cachedAt')) {
          store.createIndex('cachedAt', 'cachedAt', { unique: false })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
    })
  }
  return dbPromise
}

async function runIndexedDbOperation<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openIndexedDb()
  if (!db) {
    return null
  }
  return new Promise<T | null>((resolve) => {
    try {
      const transaction = db.transaction(INDEXED_DB_STORE, mode)
      const store = transaction.objectStore(INDEXED_DB_STORE)
      const request = operation(store)
      request.onerror = () => {
        console.warn('IndexedDB 操作失败', request.error)
        resolve(null)
      }
      transaction.oncomplete = () => {
        resolve(request.result ?? null)
      }
      transaction.onerror = () => {
        console.warn('IndexedDB 事务错误', transaction.error)
        resolve(null)
      }
      transaction.onabort = () => {
        console.warn('IndexedDB 事务已中止', transaction.error)
        resolve(null)
      }
    } catch (error) {
      console.warn('IndexedDB 操作抛出异常', error)
      resolve(null)
    }
  })
}

function readAssetFromIndexedDb(assetId: string) {
  return runIndexedDbOperation<StoredAssetRecord>('readonly', (store) => store.get(assetId))
}

function now() {
  return Date.now()
}

function createDefaultEntry(assetId: string): AssetCacheEntry {
  return {
    assetId,
    status: 'idle',
    progress: 0,
    error: null,
    blob: null,
    blobUrl: null,
    size: 0,
    lastUsedAt: 0,
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

function applyBlobToEntry(entry: AssetCacheEntry, payload: {
  blob: Blob
  mimeType: string | null
  filename: string | null
  downloadUrl: string | null
  serverUpdatedAt?: string | null
  contentHash?: string | null
  contentHashAlgorithm?: string | null
  persistentKey?: string | null
}) {
  if (entry.blobUrl) {
    URL.revokeObjectURL(entry.blobUrl)
  }
  entry.blob = payload.blob
  entry.blobUrl = URL.createObjectURL(payload.blob)
  entry.status = 'cached'
  entry.progress = 100
  entry.error = null
  entry.size = payload.blob.size
  entry.abortController = null
  entry.lastUsedAt = now()
  entry.mimeType = payload.mimeType
  // Ensure filename includes an extension when possible.
  let initialFilename = payload.filename ?? `${entry.assetId}`
  try {
    initialFilename = initialFilename.trim()
  } catch (_e) {
    /* noop */
  }
  let ext = extractExtension(initialFilename)
  if (!ext && payload.mimeType) {
    try {
      const parts = (payload.mimeType ?? '').split(';')
      const mtVal = parts[0] ?? ''
      const idx = mtVal.lastIndexOf('/')
      const maybe = idx >= 0 ? mtVal.slice(idx + 1) : mtVal
      if (maybe && maybe.length) {
        ext = maybe.toLowerCase()
      }
    } catch (_err) {
      /* noop */
    }
  }
  entry.filename = ext ? ensureExtension(initialFilename, ext) : initialFilename
  entry.downloadUrl = payload.downloadUrl
  entry.serverUpdatedAt = payload.serverUpdatedAt ?? entry.serverUpdatedAt ?? null
  entry.contentHash = payload.contentHash ?? entry.contentHash ?? null
  entry.contentHashAlgorithm = payload.contentHashAlgorithm ?? entry.contentHashAlgorithm ?? null
  entry.persistentKey = payload.persistentKey ?? entry.persistentKey ?? null
}

export const useAssetCacheStore = defineStore('assetCache', {
  state: () => ({
    entries: {} as Record<string, AssetCacheEntry>,
    pending: {} as Record<string, Promise<AssetCacheEntry>>,
    maxEntries: MAX_CACHE_ENTRIES,
  }),
  getters: {
    cachedEntries(state): AssetCacheEntry[] {
      return Object.values(state.entries).filter((entry) => entry.status === 'cached')
    },
    cachedCount(): number {
      return this.cachedEntries.length
    },
  },
  actions: {
    ensureEntry(assetId: string) {
      if (!this.entries[assetId]) {
        this.entries[assetId] = createDefaultEntry(assetId)
      }
      return this.entries[assetId]
    },
    getEntry(assetId: string): AssetCacheEntry {
      return this.ensureEntry(assetId)
    },
    hasCache(assetId: string): boolean {
      return this.entries[assetId]?.status === 'cached'
    },
    isDownloading(assetId: string): boolean {
      return this.entries[assetId]?.status === 'downloading'
    },
    getProgress(assetId: string): number {
      return this.entries[assetId]?.progress ?? 0
    },
    getError(assetId: string): string | null {
      return this.entries[assetId]?.error ?? null
    },
    getBlobUrl(assetId: string): string | null {
      return this.entries[assetId]?.blobUrl ?? null
    },
    resolveAssetThumbnail(options: AssetThumbnailOptions = {}): string | null {
      const asset = options.asset ?? null

      if (asset) {
        const derived = deriveThumbnailFromAsset(asset)
        if (derived) {
          return derived
        }
      }
      const cacheKey = options.cacheId ?? asset?.id ?? options.assetId ?? null
      if (cacheKey) {
        const entry = this.entries[cacheKey]
        if (entry && entry.status === 'cached' && entry.blobUrl) {
          const mimeType = entry.mimeType?.toLowerCase() ?? ''
          if (mimeType.startsWith('image/')) {
            return entry.blobUrl
          }
          if (!mimeType) {
            if (!asset || asset.type === 'image' || asset.type === 'texture') {
              return entry.blobUrl
            }
          }
        }
      }

      return null
    },
    createFileFromCache(assetId: string): File | null {
      const entry = this.entries[assetId]
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        return null
      }
      let filename = entry.filename && entry.filename.trim().length ? entry.filename.trim() : `${assetId}`
      const mimeType = entry.mimeType ?? 'application/octet-stream'

      // Ensure filename has an extension when possible. Prefer extension from
      // the stored filename, otherwise try to infer from mimeType.
      let extension = extractExtension(filename)
      if (!extension && entry.mimeType) {
        try {
          const parts = (entry.mimeType ?? '').split(';')
          const mtVal = parts[0] ?? ''
          const idx = mtVal.lastIndexOf('/')
          const maybe = idx >= 0 ? mtVal.slice(idx + 1) : mtVal
          if (maybe && maybe.length) {
            extension = maybe.toLowerCase()
          }
        } catch (_error) {
          /* noop */
        }
      }

      if (extension) {
        filename = ensureExtension(filename, extension)
      }

      try {
        return new File([entry.blob], filename, { type: mimeType })
      } catch (_error) {
        // Some environments may not support File constructor; fallback to null.
        return null
      }
    },
    setError(assetId: string, message: string | null) {
      const entry = this.ensureEntry(assetId)
      entry.error = message
    },
    async loadFromIndexedDb(
      assetId: string,
      options: { contentHash?: string | null; contentHashAlgorithm?: string | null } = {},
    ): Promise<AssetCacheEntry | null> {
      if (this.hasCache(assetId)) {
        this.touch(assetId)
        return this.entries[assetId] ?? null
      }
      const persistentKeys = resolvePersistentAssetKeys({ assetId, contentHash: options.contentHash ?? null })
      for (const key of persistentKeys) {
        const stored = await persistentAssetStorage.get(key)
        if (!stored?.bytes) {
          continue
        }
        const blob = new Blob([stored.bytes], { type: stored.mimeType ?? 'application/octet-stream' })
        const entry = this.ensureEntry(assetId)
        applyBlobToEntry(entry, {
          blob,
          mimeType: stored.mimeType ?? blob.type ?? null,
          filename: stored.filename,
          downloadUrl: stored.downloadUrl ?? null,
          serverUpdatedAt: stored.serverUpdatedAt ?? null,
          contentHash: stored.contentHash ?? options.contentHash ?? null,
          contentHashAlgorithm: stored.contentHashAlgorithm ?? options.contentHashAlgorithm ?? null,
          persistentKey: stored.key,
        })
        entry.lastUsedAt = now()
        return entry
      }

      const stored = await readAssetFromIndexedDb(assetId)
      if (!stored?.blob) {
        return null
      }
      const entry = this.ensureEntry(assetId)
      applyBlobToEntry(entry, {
        blob: stored.blob,
        mimeType: stored.mimeType ?? stored.blob.type ?? null,
        filename: stored.filename,
        downloadUrl: stored.downloadUrl ?? null,
        serverUpdatedAt: stored.serverUpdatedAt ?? null,
        contentHash: options.contentHash ?? null,
        contentHashAlgorithm: options.contentHashAlgorithm ?? null,
        persistentKey: assetId,
      })
      entry.lastUsedAt = now()
      return entry
    },
    async restoreAssetEntry(
      assetId: string,
      options: { contentHash?: string | null; contentHashAlgorithm?: string | null } = {},
    ): Promise<AssetCacheEntry | null> {
      return await this.loadFromIndexedDb(assetId, options)
    },

    async storeAssetBlob(
      assetId: string,
      payload: {
        blob: Blob
        mimeType?: string | null
        filename?: string | null
        downloadUrl?: string | null
        serverUpdatedAt?: string | null
        contentHash?: string | null
        contentHashAlgorithm?: string | null
      },
    ): Promise<AssetCacheEntry> {
      const entry = this.ensureEntry(assetId)
      invalidateModelObject(assetId)
      const filename = payload.filename ?? (payload.blob instanceof File ? payload.blob.name : null)
      const persistentKeys = resolvePersistentAssetKeys({
        assetId,
        contentHash: payload.contentHash ?? entry.contentHash ?? null,
      })

      applyBlobToEntry(entry, {
        blob: payload.blob,
        mimeType: payload.mimeType ?? payload.blob.type ?? entry.mimeType ?? null,
        filename,
        downloadUrl: payload.downloadUrl ?? entry.downloadUrl ?? null,
        serverUpdatedAt: payload.serverUpdatedAt ?? entry.serverUpdatedAt ?? null,
        contentHash: payload.contentHash ?? entry.contentHash ?? null,
        contentHashAlgorithm: payload.contentHashAlgorithm ?? entry.contentHashAlgorithm ?? null,
        persistentKey: persistentKeys[0] ?? entry.persistentKey ?? null,
      })

      entry.size = payload.blob.size
      entry.lastUsedAt = now()

      try {
        const bytes = await payload.blob.arrayBuffer()
        for (const key of persistentKeys) {
          await persistentAssetStorage.put({
            key,
            bytes,
            size: payload.blob.size,
            mimeType: entry.mimeType,
            filename: entry.filename,
            downloadUrl: entry.downloadUrl,
            assetId,
            contentHash: entry.contentHash ?? null,
            contentHashAlgorithm: entry.contentHashAlgorithm ?? null,
            serverUpdatedAt: entry.serverUpdatedAt ?? null,
          })
        }
      } catch (error) {
        console.warn('写入持久化资产存储失败', error)
      }

      return entry
    },

    async downloadAsset(assetId:string, downloadUrl: string, name: string, options: AssetDownloadOptions = {}): Promise<AssetCacheEntry> {
      const scope = this
      const expectedServerUpdatedAt = options.expectedServerUpdatedAt ?? null
      const entry = scope.ensureEntry(assetId)
      if (entry.status === 'cached' && !options.force) {
        if (expectedServerUpdatedAt && entry.serverUpdatedAt && expectedServerUpdatedAt !== entry.serverUpdatedAt) {
          // Cached blob is stale; continue to re-download.
        } else {
          scope.touch(assetId)
          return entry
        }
      }

      if (assetId in scope.pending) {
        return scope.pending[assetId]!
      }

      const promise = (async () => {
        if (!options.force) {
          const restored = await scope.restoreAssetEntry(assetId, {
            contentHash: options.contentHash ?? null,
            contentHashAlgorithm: options.contentHashAlgorithm ?? null,
          })
          if (restored) {
            if (expectedServerUpdatedAt && restored.serverUpdatedAt && expectedServerUpdatedAt !== restored.serverUpdatedAt) {
              // IndexedDB blob is stale; continue to re-download.
            } else {
              if (!restored.downloadUrl) {
                restored.downloadUrl = downloadUrl
              }
              return restored
            }
          }
        }

        if (!downloadUrl) {
          throw new Error('该资源没有可用的下载地址')
        }

        const controller = new AbortController()
        const current = scope.ensureEntry(assetId)
        current.status = 'downloading'
        current.progress = 0
        current.error = null
        current.abortController = controller
        current.lastUsedAt = now()

        try {
          const raw = await fetchAssetBlob(
            downloadUrl,
            controller,
            (progress: number) => {
              const updating = scope.ensureEntry(assetId)
              updating.progress = progress
            },
          )
          const data: FetchedAssetData = {
            blob: raw.blob,
            contentType: raw.mimeType ?? raw.blob.type ?? null,
            filename: inferFetchedFilename(raw.filename, name, downloadUrl),
          }
          return await scope.storeAssetBlob(assetId, {
            blob: data.blob,
            mimeType: data.contentType,
            filename: data.filename,
            downloadUrl: raw.url ?? downloadUrl,
            serverUpdatedAt: expectedServerUpdatedAt,
            contentHash: options.contentHash ?? null,
            contentHashAlgorithm: options.contentHashAlgorithm ?? null,
          })

        } catch (error) {
          const failed = scope.ensureEntry(assetId)
          failed.abortController = null
          if ((error as Error).name === ABORT_ERROR_NAME) {
            failed.status = 'idle'
            failed.progress = 0
            failed.error = '下载已取消'
            return failed
          }
          failed.status = 'error'
          failed.error = (error as Error).message ?? '未知错误'
          failed.progress = 0
          throw error
        }
      })()
        .finally(() => {
          delete scope.pending[assetId]
        })

      scope.pending[assetId] = promise
      return promise
    },

    async downloadProjectAsset(asset: ProjectAsset, options: AssetDownloadOptions = {}): Promise<AssetCacheEntry> {
      const scope = this
      const url = asset.downloadUrl ?? asset.description ?? null
      if (!url) {
        throw new Error('该资源没有可用的下载地址')
      }
      const expectedServerUpdatedAt =
        options.expectedServerUpdatedAt
        ?? (typeof asset.updatedAt === 'string' ? asset.updatedAt : null)
        ?? null
      const entry = await scope.downloadAsset(asset.id, url, asset.name, {
        ...options,
        expectedServerUpdatedAt,
        contentHash: asset.contentHash ?? options.contentHash ?? null,
        contentHashAlgorithm: asset.contentHashAlgorithm ?? options.contentHashAlgorithm ?? null,
      })
      entry.contentHash = asset.contentHash ?? entry.contentHash ?? null
      entry.contentHashAlgorithm = asset.contentHashAlgorithm ?? entry.contentHashAlgorithm ?? null
      return entry
    },
    async ensureAssetEntry(assetId: string, options: AssetAccessOptions = {}): Promise<AssetCacheEntry | null> {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalizedAssetId) {
        return null
      }

      const asset = options.asset ?? null
      const contentHash = asset?.contentHash ?? options.contentHash ?? null
      const contentHashAlgorithm = asset?.contentHashAlgorithm ?? options.contentHashAlgorithm ?? null
      let entry = this.getEntry(normalizedAssetId)

      if (entry.status !== 'cached') {
        entry = (await this.restoreAssetEntry(normalizedAssetId, {
          contentHash,
          contentHashAlgorithm,
        })) ?? this.getEntry(normalizedAssetId)
      }

      if (entry.status === 'cached') {
        if (!entry.downloadUrl) {
          entry.downloadUrl = options.downloadUrl ?? asset?.downloadUrl ?? asset?.description ?? null
        }
        this.touch(normalizedAssetId)
        return entry
      }

      if (asset) {
        return await this.downloadProjectAsset(asset, {
          ...options,
          contentHash,
          contentHashAlgorithm,
        })
      }

      const downloadUrl = options.downloadUrl ?? entry.downloadUrl ?? null
      if (!downloadUrl) {
        return null
      }

      return await this.downloadAsset(normalizedAssetId, downloadUrl, options.name ?? normalizedAssetId, {
        ...options,
        contentHash,
        contentHashAlgorithm,
      })
    },
    async ensureAssetFile(assetId: string, options: AssetAccessOptions = {}): Promise<File | null> {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalizedAssetId) {
        return null
      }

      let file = this.createFileFromCache(normalizedAssetId)
      if (file) {
        this.touch(normalizedAssetId)
        return file
      }

      const entry = await this.ensureAssetEntry(normalizedAssetId, options)
      if (!entry || entry.status !== 'cached') {
        return null
      }

      file = this.createFileFromCache(normalizedAssetId)
      if (file) {
        this.touch(normalizedAssetId)
      }
      return file
    },
    
    cancelDownload(assetId: string) {
      const entry = this.entries[assetId]
      if (!entry || entry.status !== 'downloading') {
        return
      }
      entry.abortController?.abort()
      entry.abortController = null
      entry.status = 'idle'
      entry.progress = 0
      entry.error = '下载已取消'
    },
    removeCache(assetId: string) {
      const entry = this.entries[assetId]
      if (!entry) {
        return
      }

      invalidateModelObject(assetId)

      if (entry.abortController) {
        entry.abortController.abort()
      }

      if (entry.blobUrl) {
        URL.revokeObjectURL(entry.blobUrl)
      }

      this.entries[assetId] = {
        ...entry,
        status: 'idle',
        blob: null,
        blobUrl: null,
        progress: 0,
        size: 0,
        abortController: null,
        error: null,
        persistentKey: null,
      }

      const persistentKeys = resolvePersistentAssetKeys({
        assetId,
        contentHash: entry.contentHash ?? null,
        keys: entry.persistentKey ? [entry.persistentKey] : [],
      })
      for (const key of persistentKeys) {
        void persistentAssetStorage.delete(key)
      }
    },
    touch(assetId: string) {
      const entry = this.ensureEntry(assetId)
      entry.lastUsedAt = now()
    },
    releaseInMemoryBlob(assetId: string) {
      const entry = this.entries[assetId]
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        return
      }

      if (entry.blobUrl) {
        URL.revokeObjectURL(entry.blobUrl)
      }

      entry.blob = null
      entry.blobUrl = null
      entry.status = 'idle'
      entry.progress = 0
      entry.size = 0
      entry.abortController = null
      entry.error = null
      entry.lastUsedAt = now()
    },
    evictIfNeeded(preferredAssetId?: string) {
      const maxEntries = this.maxEntries
      if (maxEntries <= 0) {
        return
      }

      const cached = Object.values(this.entries).filter((entry) => entry.status === 'cached')
      if (cached.length <= maxEntries) {
        return
      }
      cached.sort((a, b) => a.lastUsedAt - b.lastUsedAt)

      const removable = cached.filter((entry) => !preferredAssetId || entry.assetId !== preferredAssetId)
      const totalToRemove = cached.length - maxEntries
      let removed = 0

      for (const entry of removable) {
        if (removed >= totalToRemove) {
          break
        }
        this.releaseInMemoryBlob(entry.assetId)
        removed += 1
      }

      if (cached.length - removed > maxEntries && preferredAssetId) {
        this.releaseInMemoryBlob(preferredAssetId)
      }
    },
    setMaxEntries(count: number) {
      this.maxEntries = Math.max(0, count)
    },
  },
})
