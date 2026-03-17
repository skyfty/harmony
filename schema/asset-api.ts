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
  directoryId?: string | null
  directoryPath?: AssetCategoryPathItem[]
  directoryPathString?: string
  type: AssetType
  tags: AssetTagSummary[]
  tagIds: string[]
  seriesId?: string | null
  seriesName?: string | null
  series?: AssetSeries | null
  terrainScatterPreset?: TerrainScatterCategory | null
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

export type AssetManifestResourceKind = 'embedded' | 'remote' | 'local' | 'inline' | 'manifest'

export interface AssetManifestResource {
  kind: AssetManifestResourceKind
  url?: string | null
  fileKey?: string | null
  path?: string | null
  mimeType?: string | null
  exportable?: boolean
  metadata?: Record<string, unknown>
}

export interface AssetManifestAsset {
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
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  sizeCategory?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  downloadUrl: string
  thumbnailUrl: string | null
  resource?: AssetManifestResource | null
  thumbnail?: AssetManifestResource | null
  description: string | null
  createdAt: string
  updatedAt: string
  size: number
}

export interface AssetManifestDirectory {
  id: string
  name: string
  parentId: string | null
  directoryIds: string[]
  assetIds: string[]
  createdAt?: string
  updatedAt?: string
}

export interface AssetManifest {
  format: 'harmony-asset-manifest'
  version: 2
  generatedAt: string
  rootDirectoryId: string
  directoriesById: Record<string, AssetManifestDirectory>
  assetsById: Record<string, AssetManifestAsset>
}

export type AssetManifestEntry = AssetManifestAsset

export interface LegacyAssetManifestEntry extends AssetManifestAsset {}

export interface LegacyAssetManifest {
  generatedAt: string
  assets: LegacyAssetManifestEntry[]
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
