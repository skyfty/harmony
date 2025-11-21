import { defineStore } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import type { SceneNode } from '@harmony/schema'
import { fetchAssetBlob } from '@schema/assetCache'
import type { AssetCacheEntry as SharedAssetCacheEntry, AssetCacheStatus as SharedAssetCacheStatus } from '@schema/assetCache'
import { extractExtension } from '@/utils/blob'
import { invalidateModelObject } from './modelObjectCache'

export type AssetCacheStatus = SharedAssetCacheStatus

export type AssetCacheEntry = SharedAssetCacheEntry

export interface AssetDownloadOptions {
  force?: boolean
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

const IMAGE_FILE_EXTENSIONS = new Set<string>([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'svg',
  'avif',
  'ico',
  'heic',
  'heif',
])

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
  return IMAGE_FILE_EXTENSIONS.has(extension)
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
  if (type === 'model' || type == 'prefab' || type === 'mesh') {
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
const INDEXED_DB_VERSION = 2
const INDEXED_DB_STORE = 'assets'
const INDEXED_DB_MAX_RECORDS = 1000
const INDEXED_DB_PRUNE_BATCH = 100

interface StoredAssetRecord {
  assetId: string
  blob: Blob
  mimeType: string | null
  filename: string | null
  downloadUrl: string | null
  size: number
  cachedAt: number
}

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

async function writeAssetToIndexedDb(record: StoredAssetRecord) {
  await runIndexedDbOperation<IDBValidKey>('readwrite', (store) => store.put(record))
  await enforceIndexedDbLimit()
}

function deleteAssetFromIndexedDb(assetId: string) {
  return runIndexedDbOperation<undefined>('readwrite', (store) => store.delete(assetId))
}

function countAssetsInIndexedDb() {
  return runIndexedDbOperation<number>('readonly', (store) => store.count())
}

async function enforceIndexedDbLimit() {
  const total = await countAssetsInIndexedDb()
  if (!total || total <= INDEXED_DB_MAX_RECORDS) {
    return
  }
  const pruneCount = Math.min(INDEXED_DB_PRUNE_BATCH, total)
  await deleteOldestAssetsFromIndexedDb(pruneCount)
}

async function deleteOldestAssetsFromIndexedDb(count: number) {
  if (count <= 0) {
    return
  }
  const db = await openIndexedDb()
  if (!db) {
    return
  }
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(INDEXED_DB_STORE, 'readwrite')
      const store = transaction.objectStore(INDEXED_DB_STORE)
      const index = store.index('cachedAt')
      let remaining = count
      const request = index.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor && remaining > 0) {
          cursor.delete()
          remaining -= 1
          cursor.continue()
        }
      }
      request.onerror = () => {
        console.warn('IndexedDB 删除旧缓存失败', request.error)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => {
        console.warn('IndexedDB 删除事务失败', transaction.error)
        resolve()
      }
      transaction.onabort = () => {
        console.warn('IndexedDB 删除事务中止', transaction.error)
        resolve()
      }
    } catch (error) {
      console.warn('IndexedDB 删除旧缓存异常', error)
      resolve()
    }
  })
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
    arrayBuffer: null,
    size: 0,
    refCount: 0,
    lastUsedAt: 0,
    abortController: null,
    mimeType: null,
    filename: null,
    downloadUrl: null,
  }
}

function applyBlobToEntry(entry: AssetCacheEntry, payload: {
  blob: Blob
  mimeType: string | null
  filename: string | null
  downloadUrl: string | null
  arrayBuffer?: ArrayBuffer | null
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
  entry.filename = payload.filename ?? `${entry.assetId}`
  entry.downloadUrl = payload.downloadUrl
  entry.arrayBuffer = payload.arrayBuffer ?? null
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
      const filename = entry.filename && entry.filename.trim().length ? entry.filename : `${assetId}`
      const mimeType = entry.mimeType ?? 'application/octet-stream'
      return new File([entry.blob], filename, { type: mimeType })
    },
    setError(assetId: string, message: string | null) {
      const entry = this.ensureEntry(assetId)
      entry.error = message
    },
    async loadFromIndexedDb(assetId: string): Promise<AssetCacheEntry | null> {
      if (this.hasCache(assetId)) {
        this.touch(assetId)
        return this.entries[assetId] ?? null
      }
      const stored = await readAssetFromIndexedDb(assetId)
      if (!stored?.blob) {
        return null
      }
      const entry = this.ensureEntry(assetId)
      const arrayBuffer = await stored.blob.arrayBuffer()
      applyBlobToEntry(entry, {
        blob: stored.blob,
        mimeType: stored.mimeType ?? stored.blob.type ?? null,
        filename: stored.filename,
        downloadUrl: stored.downloadUrl ?? null,
        arrayBuffer,
      })
      entry.lastUsedAt = now()
      this.evictIfNeeded(assetId)
      return entry
    },

    async storeAssetBlob(
      assetId: string,
      payload: {
        blob: Blob
        mimeType?: string | null
        filename?: string | null
        downloadUrl?: string | null
      },
    ): Promise<AssetCacheEntry> {
      const entry = this.ensureEntry(assetId)
      invalidateModelObject(assetId)
      const filename = payload.filename ?? (payload.blob instanceof File ? payload.blob.name : null)
      const arrayBuffer = typeof payload.blob.arrayBuffer === 'function' ? await payload.blob.arrayBuffer() : null

      applyBlobToEntry(entry, {
        blob: payload.blob,
        mimeType: payload.mimeType ?? payload.blob.type ?? entry.mimeType ?? null,
        filename,
        downloadUrl: payload.downloadUrl ?? entry.downloadUrl ?? null,
        arrayBuffer,
      })

      entry.size = payload.blob.size
      entry.lastUsedAt = now()

      try {
        await writeAssetToIndexedDb({
          assetId,
          blob: payload.blob,
          mimeType: entry.mimeType,
          filename: entry.filename,
          downloadUrl: entry.downloadUrl,
          size: payload.blob.size,
          cachedAt: now(),
        })
      } catch (error) {
        console.warn('写入 IndexedDB 失败', error)
      }

      this.evictIfNeeded(assetId)
      return entry
    },

    async downloadAsset(assetId:string, downloadUrl: string, name: string, options: AssetDownloadOptions = {}): Promise<AssetCacheEntry> {
      const scope = this
      const entry = scope.ensureEntry(assetId)
      if (entry.status === 'cached' && !options.force) {
        scope.touch(assetId)
        return entry
      }

      if (assetId in scope.pending) {
        return scope.pending[assetId]!
      }

      const promise = (async () => {
        if (!options.force) {
          const restored = await scope.loadFromIndexedDb(assetId)
          if (restored) {
            if (!restored.downloadUrl) {
              restored.downloadUrl = downloadUrl
            }
            return restored
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

    async downloaProjectAsset(asset: ProjectAsset, options: AssetDownloadOptions = {}): Promise<AssetCacheEntry> {
      const scope = this
      const url = asset.downloadUrl ?? asset.description ?? null
      if (!url) {
        throw new Error('该资源没有可用的下载地址')
      }
      return scope.downloadAsset(asset.id, url, asset.name, options)
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
        arrayBuffer: null,
        progress: 0,
        size: 0,
        abortController: null,
        error: null,
      }

      void deleteAssetFromIndexedDb(assetId)
    },
    touch(assetId: string) {
      const entry = this.ensureEntry(assetId)
      entry.lastUsedAt = now()
    },
    registerUsage(assetId: string) {
      const entry = this.ensureEntry(assetId)
      entry.refCount += 1
      entry.lastUsedAt = now()
    },
    unregisterUsage(assetId: string) {
      const entry = this.ensureEntry(assetId)
      entry.refCount = Math.max(0, entry.refCount - 1)
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
      entry.arrayBuffer = null
      entry.status = 'idle'
      entry.progress = 0
      entry.size = 0
      entry.abortController = null
      entry.error = null
      entry.lastUsedAt = now()
    },
    recalculateUsage(nodes: SceneNode[]) {
      const counts = new Map<string, number>()
      const visit = (node: SceneNode) => {
        if (node.sourceAssetId) {
          counts.set(node.sourceAssetId, (counts.get(node.sourceAssetId) ?? 0) + 1)
        }
        if (node.materials?.length) {
          node.materials.forEach((material) => {
            const textures = material.textures ?? null
            if (!textures) {
              return
            }
            Object.values(textures).forEach((ref) => {
              const assetId = ref?.assetId
              if (!assetId) {
                return
              }
              counts.set(assetId, (counts.get(assetId) ?? 0) + 1)
            })
          })
        }
        node.children?.forEach(visit)
      }
      nodes.forEach(visit)

      Object.keys(this.entries).forEach((assetId) => {
        const entry = this.ensureEntry(assetId)
        entry.refCount = counts.get(assetId) ?? 0
      })
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

      const sorted = cached.sort((a, b) => {
        if (a.refCount !== b.refCount) {
          return a.refCount - b.refCount
        }
        return a.lastUsedAt - b.lastUsedAt
      })

      let fallbackWithUsage: AssetCacheEntry | null = null

      for (const entry of sorted) {
        if (cached.length <= maxEntries) {
          break
        }
        if (preferredAssetId && entry.assetId === preferredAssetId) {
          continue
        }
        if (entry.refCount > 0) {
          if (!fallbackWithUsage) {
            fallbackWithUsage = entry
          }
          continue
        }
        this.removeCache(entry.assetId)
        cached.splice(cached.indexOf(entry), 1)
      }

      if (cached.length > maxEntries && fallbackWithUsage) {
        this.removeCache(fallbackWithUsage.assetId)
      }
    },
    setMaxEntries(count: number) {
      this.maxEntries = Math.max(0, count)
      this.evictIfNeeded()
    },
  },
})
