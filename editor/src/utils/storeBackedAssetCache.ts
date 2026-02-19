import { AssetCache, type AssetCacheEntry } from '@schema/assetCache'
import { useAssetCacheStore } from '@/stores/assetCacheStore'

export class StoreBackedAssetCache extends AssetCache {
  private readonly store: ReturnType<typeof useAssetCacheStore>

  constructor(store: ReturnType<typeof useAssetCacheStore>) {
    super()
    this.store = store
  }

  override ensureEntry(assetId: string): AssetCacheEntry {
    return this.store.ensureEntry(assetId)
  }

  override async getEntry(assetId: string): Promise<AssetCacheEntry | null | undefined> {
    if (!assetId) {
      return null
    }

    const existing = this.store.entries[assetId]
    if (existing) {
      // If it already exists (even if not cached), return it.
      return existing
    }

    // Try to hydrate from IndexedDB so we can reuse persistent cache.
    await this.store.loadFromIndexedDb(assetId)

    return this.store.entries[assetId] ?? null
  }

  override hasCache(assetId: string): boolean {
    return this.store.hasCache(assetId)
  }

  override touch(assetId: string): void {
    this.store.touch(assetId)
  }

  override async storeArrayBuffer(
    assetId: string,
    arrayBuffer: ArrayBuffer,
    payload: {
      mimeType?: string | null
      filename?: string | null
      downloadUrl?: string | null
    } = {},
  ): Promise<AssetCacheEntry> {
    if (typeof Blob === 'undefined') {
      // Fallback to the base implementation (non-persistent) in non-browser environments.
      return super.storeArrayBuffer(assetId, arrayBuffer, payload)
    }

    const mimeType = payload.mimeType ?? 'application/octet-stream'
    const blob = new Blob([arrayBuffer], { type: mimeType })

    return this.store.storeAssetBlob(assetId, {
      blob,
      mimeType: payload.mimeType ?? blob.type ?? null,
      filename: payload.filename ?? null,
      downloadUrl: payload.downloadUrl ?? null,
    })
  }

  override async storeBlob(
    assetId: string,
    blob: Blob,
    payload: {
      mimeType?: string | null
      filename?: string | null
      downloadUrl?: string | null
    } = {},
  ): Promise<AssetCacheEntry> {
    return this.store.storeAssetBlob(assetId, {
      blob,
      mimeType: payload.mimeType ?? blob.type ?? null,
      filename: payload.filename ?? (blob instanceof File ? blob.name : null),
      downloadUrl: payload.downloadUrl ?? null,
    })
  }

  override removeCache(assetId: string): void {
    this.store.removeCache(assetId)
  }

  override setError(assetId: string, message: string): void {
    this.store.setError(assetId, message)
  }

  override releaseInMemoryBlob(assetId: string): void {
    this.store.releaseInMemoryBlob(assetId)
  }

  override evictIfNeeded(preferredAssetId?: string): void {
    this.store.evictIfNeeded(preferredAssetId)
  }

  override setMaxEntries(count: number): void {
    this.store.setMaxEntries(count)
  }

  override createFileFromCache(assetId: string): File | null {
    return this.store.createFileFromCache(assetId)
  }
}
