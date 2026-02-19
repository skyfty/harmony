import { AssetLoader, type AssetCacheEntry, type AssetLoadOptions, type AssetSource } from '@schema/assetCache'

const HTTP_URL_PATTERN = /^(https?:)?\/\//i

export class CacheOnlyAssetLoader extends AssetLoader {
  override async load(assetId: string, source: AssetSource, options: AssetLoadOptions = {}): Promise<AssetCacheEntry> {
    if (!assetId) {
      throw new Error('assetId is required')
    }

    const existing = await this.getCache().getEntry(assetId)
    if (existing?.status === 'cached' && !options.force) {
      this.getCache().touch(assetId)
      return existing
    }

    // Allow inline sources (no network).
    if (source.kind === 'arraybuffer' || source.kind === 'data-url' || source.kind === 'blob') {
      return super.load(assetId, source, options)
    }

    // Block remote network downloads when cache is missing.
    const url = source.kind === 'remote-url' ? (source.url ?? '') : ''
    if (HTTP_URL_PATTERN.test(url)) {
      throw new Error(`Asset ${assetId} is not cached`) 
    }

    // Allow non-http remote urls such as blob: urls.
    return super.load(assetId, source, options)
  }
}
