import type { AssetType as SchemaAssetType } from '@harmony/schema/asset-types'

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

export interface AssetTagSummary {
  id: string
  name: string
}

export interface AssetTag extends AssetTagSummary {
  description?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface ManagedAsset {
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
  createdAt: string
  updatedAt: string
}

export interface UploadAssetResponse {
  asset: ManagedAsset
}
