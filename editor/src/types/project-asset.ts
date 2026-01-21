import type { AssetType } from '@harmony/schema'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'

export type ServerAssetType = AssetType

export interface ProjectAsset {
  id: string
  name: string
  categoryId?: string
  categoryPath?: { id: string; name: string }[]
  categoryPathString?: string
  type: ServerAssetType | 'behavior'
  description?: string
  downloadUrl: string
  previewColor: string
  thumbnail?: string | null
  tags?: string[]
  tagIds?: string[]
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  sizeCategory?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  seriesId?: string | null
  seriesName?: string | null
  terrainScatterPreset?: TerrainScatterCategory | null
  createdAt?: string
  updatedAt?: string
  gleaned: boolean
}
