import type { AssetType } from './asset-types'

export interface AssetTagSummary {
  id: string
  name: string
}

export interface AssetTag extends AssetTagSummary {
  description?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AssetCategory {
  id: string
  name: string
  type: AssetType
  description?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AssetSummary {
  id: string
  name: string
  categoryId: string
  type: AssetType
  tags: AssetTagSummary[]
  tagIds: string[]
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
  tags: AssetTagSummary[]
  tagIds: string[]
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
