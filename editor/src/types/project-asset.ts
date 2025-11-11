import type { AssetType } from '@harmony/schema/asset-types'

export type ServerAssetType = AssetType

export interface ProjectAsset {
  id: string
  name: string
  type: ServerAssetType | 'behavior'
  description?: string
  downloadUrl: string
  previewColor: string
  thumbnail?: string | null
  tags?: string[]
  tagIds?: string[]
  gleaned: boolean
}
