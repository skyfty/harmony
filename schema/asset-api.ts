import type { AssetType } from './asset-types'
import type { TerrainScatterCategory } from './terrain-scatter'

export interface AssetTagSummary {
  id: string
  name: string
}

export interface AssetTag extends AssetTagSummary {
  description?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AssetSeries {
  id: string
  name: string
  description?: string | null
  assetCount?: number
  createdAt?: string
  updatedAt?: string
}

export interface AssetCategoryPathItem {
  id: string
  name: string
}

export interface AssetCategory {
  id: string
  name: string
  description?: string | null
  parentId?: string | null
  depth: number
  path: AssetCategoryPathItem[]
  hasChildren?: boolean
  createdAt?: string
  updatedAt?: string
  children?: AssetCategory[]
}

export interface AssetSummary {
  id: string
  name: string
  categoryId: string
  categoryPath: AssetCategoryPathItem[]
  categoryPathString: string
  type: AssetType
  tags: AssetTagSummary[]
  tagIds: string[]
  seriesId?: string | null
  seriesName?: string | null
  series?: AssetSeries | null
  terrainScatterPreset?: TerrainScatterCategory | null
  mixtureType?: string | null
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  sizeCategory?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  size: number
  url: string
  downloadUrl: string
  previewUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  originalFilename?: string | null
  mimeType?: string | null
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface AssetManifestEntry {
  id: string
  name: string
  type: AssetType
  categoryId?: string
  categoryPath?: AssetCategoryPathItem[]
  categoryPathString?: string
  tags: AssetTagSummary[]
  tagIds: string[]
  seriesId?: string | null
  seriesName?: string | null
  series?: AssetSeries | null
  terrainScatterPreset?: TerrainScatterCategory | null
  mixtureType?: string | null
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  sizeCategory?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  downloadUrl: string
  thumbnailUrl: string | null
  description: string | null
  createdAt: string
  updatedAt: string
  size: number
}

export interface AssetManifest {
  generatedAt: string
  assets: AssetManifestEntry[]
}

export interface AssetDirectory<TAsset = AssetSummary> {
  id: string
  name: string
  children?: AssetDirectory<TAsset>[]
  assets?: TAsset[]
}

export interface PagedRequest {
  page?: number
  pageSize?: number
  keyword?: string
  [key: string]: unknown
}

export interface PagedResponse<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}

export interface AssetUploadResponse {
  asset: AssetSummary
}
