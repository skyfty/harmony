import { fetchAssetBlob as fetchAssetBlobInternal } from './assetDownload'

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

export type AssetCacheStatus = 'idle' | 'downloading' | 'cached' | 'error'

export interface AssetCacheEntry {
  assetId: string
  status: AssetCacheStatus
  progress: number
  error: string | null
  blob: Blob | null
  blobUrl: string | null
  size: number
  lastUsedAt: number
  abortController: AbortController | null
  mimeType: string | null
  filename: string | null
  downloadUrl: string | null
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

export interface AssetCacheOptions {
  maxEntries?: number
}

export interface AssetLoadOptions {
  force?: boolean
  onProgress?: (value: number) => void
}

export class AssetCache {
  private readonly entries = new Map<string, AssetCacheEntry>()
  private maxEntries: number

  constructor(options: AssetCacheOptions = {}) {
    this.maxEntries = Number.isFinite(options.maxEntries ?? Infinity) ? (options.maxEntries as number) : Infinity
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

  hasCache(assetId: string): boolean {
    return this.entries.get(assetId)?.status === 'cached'
  }

  touch(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (!entry) {
      return
    }
    entry.lastUsedAt = now()
  }

  setMaxEntries(count: number): void {
    this.maxEntries = Math.max(0, count)
  }

  async storeArrayBuffer(assetId: string, arrayBuffer: ArrayBuffer, payload: {
    mimeType?: string | null
    filename?: string | null
    downloadUrl?: string | null
  } = {}): Promise<AssetCacheEntry> {
    const entry = this.ensureEntry(assetId)
    revokeEntryBlobUrl(entry)

    let blob: Blob | null = null
    if (typeof Blob !== 'undefined') {
      blob = new Blob([arrayBuffer], { type: payload.mimeType ?? entry.mimeType ?? 'application/octet-stream' })
      entry.blobUrl = createObjectUrl(blob)
    }

    entry.blob = blob
    entry.mimeType = payload.mimeType ?? blob?.type ?? entry.mimeType ?? null
    entry.filename = payload.filename ?? entry.filename ?? null
    entry.downloadUrl = payload.downloadUrl ?? entry.downloadUrl ?? null
    entry.size = arrayBuffer.byteLength
    finalizeCachedEntry(entry)
    return entry
  }

  async storeBlob(assetId: string, blob: Blob, payload: {
    mimeType?: string | null
    filename?: string | null
    downloadUrl?: string | null
  } = {}): Promise<AssetCacheEntry> {
    const entry = this.ensureEntry(assetId)
    revokeEntryBlobUrl(entry)

    entry.blob = blob
    entry.mimeType = payload.mimeType ?? blob.type ?? entry.mimeType ?? null
    entry.filename = payload.filename ?? entry.filename ?? (blob instanceof File ? blob.name : null)
    entry.downloadUrl = payload.downloadUrl ?? entry.downloadUrl ?? null
    entry.size = blob.size
    entry.blobUrl = createObjectUrl(blob)
    finalizeCachedEntry(entry)
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
    entry.size = 0
    entry.mimeType = null
    entry.filename = null
    entry.downloadUrl = null
    entry.lastUsedAt = now()
  }

  setError(assetId: string, message: string): void {
    const entry = this.ensureEntry(assetId)
    entry.status = 'error'
    entry.error = message
    entry.progress = 0
    entry.abortController = null
    entry.lastUsedAt = now()
  }

  releaseInMemoryBlob(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (!entry) {
      return
    }
    revokeEntryBlobUrl(entry)
    entry.blob = null
    entry.blobUrl = null
    entry.status = 'idle'
    entry.progress = 0
    entry.error = null
    entry.size = 0
    entry.abortController = null
    entry.lastUsedAt = now()
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
      this.removeCache(entry.assetId)
      removed += 1
    }

    if (cachedEntries.length - removed > this.maxEntries && preferredAssetId) {
      this.removeCache(preferredAssetId)
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
        })
      }
      case 'blob': {
        const entry = await this.cache.storeBlob(assetId, source.blob ?? new Blob([]), {
          mimeType: source.mimeType ?? null,
          filename: source.filename ?? null,
          downloadUrl: source.url ?? null,
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
    const entry = this.cache.ensureEntry(assetId)
    const controller = new AbortController()
    entry.abortController = controller
    entry.status = 'downloading'
    entry.progress = 0
    entry.error = null
    entry.lastUsedAt = now()

    const { blob, mimeType, filename, url: resolvedUrl } = await fetchAssetBlobInternal(source.url, controller, (progress) => {
      entry.progress = progress
      options.onProgress?.(progress)
    })

    return this.cache.storeBlob(assetId, blob, {
      mimeType: source.mimeType ?? mimeType ?? null,
      filename: source.filename ?? filename ?? null,
      downloadUrl: resolvedUrl ?? source.url,
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
    size: 0,
    lastUsedAt: now(),
    abortController: null,
    mimeType: null,
    filename: null,
    downloadUrl: null,
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
