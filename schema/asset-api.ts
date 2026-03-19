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
  contentHash?: string | null
  contentHashAlgorithm?: AssetBundleHashAlgorithm | null
  sourceLocalAssetId?: string | null
  bundleRole?: AssetBundlePersistedRole | null
  bundlePrimaryAssetId?: string | null
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
  metadata?: Record<string, unknown>
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

export const ASSET_BUNDLE_FORMAT = 'harmony-asset-bundle' as const
export const ASSET_BUNDLE_VERSION = 1 as const
export const ASSET_BUNDLE_MANIFEST_FILENAME = 'asset-bundle.json' as const
export const ASSET_BUNDLE_HASH_ALGORITHM = 'fnv1a-64-compat' as const

export type AssetBundleHashAlgorithm = typeof ASSET_BUNDLE_HASH_ALGORITHM
export type AssetBundlePersistedRole = 'primary' | 'dependency'
export type AssetBundleFileRole = AssetBundlePersistedRole | 'thumbnail' | 'metadata'

export interface AssetBundleFileEntry {
  logicalId: string
  path: string
  filename: string
  role: AssetBundleFileRole
  assetType?: AssetType
  sourceLocalAssetId?: string | null
  mimeType?: string | null
  extension?: string | null
  hash: string
  hashAlgorithm: AssetBundleHashAlgorithm
  size: number
  rewriteTarget?: boolean
}

export interface AssetBundlePrimaryAsset {
  logicalId: string
  sourceLocalAssetId?: string | null
  name: string
  type: AssetType
  extension?: string | null
  description?: string | null
  thumbnailLogicalId?: string | null
  metadataLogicalId?: string | null
  dependencyLogicalIds: string[]
  categoryId?: string | null
  categoryPathSegments?: string[]
  tagIds?: string[]
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  imageWidth?: number | null
  imageHeight?: number | null
  terrainScatterPreset?: TerrainScatterCategory | null
  metadata?: Record<string, unknown> | null
  rewriteReferences?: boolean
}

export interface AssetBundleManifest {
  format: typeof ASSET_BUNDLE_FORMAT
  version: typeof ASSET_BUNDLE_VERSION
  bundleId: string
  createdAt: string
  primaryAsset: AssetBundlePrimaryAsset
  files: AssetBundleFileEntry[]
}

export interface AssetBundleUploadResponse {
  asset: AssetSummary
  importedAssets: AssetSummary[]
  assetIdMap: Record<string, string>
}
