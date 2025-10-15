export type AssetSourceMetadata =
  | {
      type: 'package'
      providerId: string
      originalAssetId: string
    }
  | {
      type: 'local'
    }
  | {
      type: 'url'
    }

export interface AssetIndexEntry {
  categoryId: string
  source?: AssetSourceMetadata
}
