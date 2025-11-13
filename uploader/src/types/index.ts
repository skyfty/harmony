import type { AssetType as SchemaAssetType } from '@harmony/schema/asset-types'
import type {
  AssetCategory as SchemaAssetCategory,
  AssetCategoryPathItem as SchemaAssetCategoryPathItem,
  AssetSummary as SchemaAssetSummary,
  AssetUploadResponse as SchemaAssetUploadResponse,
  AssetTagSummary as SchemaAssetTagSummary,
  AssetSeries as SchemaAssetSeries,
} from '@harmony/schema/asset-api'

export interface RoleSummary {
  id: string
  name: string
  code: string
  description?: string
}

export interface UserSummary {
  id: string
  username: string
  displayName?: string
  email?: string
  status: 'active' | 'disabled'
  roles: RoleSummary[]
  createdAt?: string
  updatedAt?: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  user: UserSummary
  permissions: string[]
}

export interface AuthProfileResponse {
  user: UserSummary
  permissions: string[]
}

export type AssetType = SchemaAssetType

export type AssetCategoryPathItem = SchemaAssetCategoryPathItem

export type ResourceCategory = SchemaAssetCategory

export type AssetTagSummary = SchemaAssetTagSummary

export type AssetSeries = SchemaAssetSeries

export interface AssetTag extends AssetTagSummary {
  description?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface GenerateAssetTagPayload {
  name?: string
  description?: string
  assetType?: AssetType
  extraHints?: string[]
}

export interface GenerateAssetTagResult {
  tags: string[]
  transcript?: string | null
  imagePrompt?: string | null
  modelTraceId?: string
}

export type ManagedAsset = SchemaAssetSummary

export type UploadAssetResponse = SchemaAssetUploadResponse
