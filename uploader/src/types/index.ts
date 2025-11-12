import type { AssetType as SchemaAssetType } from '@harmony/schema/asset-types'

export type AssetType = SchemaAssetType

export interface UserSummary {
  id: string
  username: string
  email?: string | null
  displayName?: string | null
  roles?: Array<{ id: string; name: string }>
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  user: UserSummary
  permissions?: string[]
}

export interface AuthProfileResponse {
  user: UserSummary
  permissions?: string[]
}

export interface AssetTag {
  id: string
  name: string
  description?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AssetTagSummary {
  id: string
  name: string
}

export interface ManagedAsset {
  id: string
  name: string
  type: AssetType
  url: string
  downloadUrl: string
  size: number
  createdAt: string
  updatedAt: string
  description?: string | null
  tagIds: string[]
  tags: AssetTagSummary[]
  thumbnailUrl?: string | null
  previewUrl?: string | null
  originalFilename?: string | null
  mimeType?: string | null
}

export interface UploadAssetResponse {
  asset: ManagedAsset
}

export interface UploadAssetPayload {
  file: File
  name?: string
  type: AssetType
  description?: string | null
  tagIds: string[]
  categoryId?: string | null
}
