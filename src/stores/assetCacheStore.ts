import { defineStore } from 'pinia'
import type { ProjectAsset } from './sceneStore'
import type { SceneNode } from '@/types/scene'

export type AssetCacheStatus = 'idle' | 'downloading' | 'cached' | 'error'

export interface AssetCacheEntry {
  assetId: string
  status: AssetCacheStatus
  progress: number
  error: string | null
  blob: Blob | null
  blobUrl: string | null
  size: number
  refCount: number
  lastUsedAt: number
  abortController: AbortController | null
}

export interface DownloadOptions {
  force?: boolean
}

const MAX_CACHE_ENTRIES = 10

const ABORT_ERROR_NAME = 'AbortError'

async function fetchAssetBlob(
  url: string,
  controller: AbortController,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  const response = await fetch(url, { signal: controller.signal })
  if (!response.ok) {
    throw new Error(`资源下载失败（${response.status}）`)
  }

  if (!response.body) {
    const blob = await response.blob()
    onProgress(100)
    return blob
  }

  const contentLengthHeader = response.headers.get('content-length')
  const total = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : 0
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value) {
      chunks.push(value)
      received += value.length
      if (total > 0) {
        onProgress(Math.min(99, Math.round((received / total) * 100)))
      } else {
        // 无法获取总长度时，按照分段递增 5%
        const estimated = Math.min(95, received % 100)
        onProgress(estimated)
      }
    }
  }

  const blob = new Blob(chunks)
  onProgress(100)
  return blob
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
    refCount: 0,
    lastUsedAt: 0,
    abortController: null,
  }
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
    async downloadAsset(asset: ProjectAsset, options: DownloadOptions = {}): Promise<AssetCacheEntry> {
      const entry = this.ensureEntry(asset.id)
      if (entry.status === 'cached' && !options.force) {
        this.touch(asset.id)
        return entry
      }

      if (this.pending[asset.id]) {
        return this.pending[asset.id]!
      }

      const downloadUrl = asset.downloadUrl ?? asset.description ?? null
      if (!downloadUrl) {
        throw new Error('该资源没有可用的下载地址')
      }

      const controller = new AbortController()
      entry.status = 'downloading'
      entry.progress = 0
      entry.error = null
      entry.abortController = controller
      entry.lastUsedAt = now()

      const promise = fetchAssetBlob(downloadUrl, controller, (progress) => {
        const current = this.ensureEntry(asset.id)
        current.progress = progress
      })
        .then((blob) => {
          const current = this.ensureEntry(asset.id)
          if (current.blobUrl) {
            URL.revokeObjectURL(current.blobUrl)
          }
          current.blob = blob
          current.blobUrl = URL.createObjectURL(blob)
          current.status = 'cached'
          current.progress = 100
          current.error = null
          current.size = blob.size
          current.abortController = null
          current.lastUsedAt = now()
          this.evictIfNeeded(asset.id)
          return current
        })
        .catch((error: unknown) => {
          const current = this.ensureEntry(asset.id)
          current.abortController = null
          if ((error as Error).name === ABORT_ERROR_NAME) {
            current.status = 'idle'
            current.progress = 0
            current.error = '下载已取消'
            return current
          }
          current.status = 'error'
          current.error = (error as Error).message ?? '未知错误'
          current.progress = 0
          throw error
        })
        .finally(() => {
          delete this.pending[asset.id]
        })

      this.pending[asset.id] = promise
      return promise
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
      }
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
    recalculateUsage(nodes: SceneNode[]) {
      const counts = new Map<string, number>()
      const visit = (node: SceneNode) => {
        if (node.sourceAssetId) {
          counts.set(node.sourceAssetId, (counts.get(node.sourceAssetId) ?? 0) + 1)
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
