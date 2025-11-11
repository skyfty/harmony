import type { AssetType as SchemaAssetType } from '@harmony/schema/asset-types'

export interface PermissionSummary {
  id: string
  name: string
  code: string
  description?: string
  group?: string
  createdAt?: string
  updatedAt?: string
}

export interface PermissionMutationPayload {
  name: string
  code: string
  description?: string
  group?: string
}

export interface RoleSummary {
  id: string
  name: string
  code: string
  description?: string
  permissions: string[]
  createdAt?: string
  updatedAt?: string
}

export interface RoleMutationPayload {
  name: string
  code: string
  description?: string
  permissionIds: string[]
}

export interface UserSummary {
  id: string
  username: string
  email?: string
  displayName?: string
  status: 'active' | 'disabled'
  createdAt?: string
  updatedAt?: string
  roles: RoleSummary[]
}

export interface UserMutationPayload {
  username: string
  password?: string
  email?: string
  displayName?: string
  roleIds: string[]
  status?: 'active' | 'disabled'
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

export interface DashboardMetrics {
  users: number
  roles: number
  assets: number
  recentActivities: Array<{
    id: string
    type: string
    description: string
    createdAt: string
  }>
}

export interface PagedRequest {
  page?: number
  pageSize?: number
  keyword?: string
  status?: string
}

export interface PagedResponse<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}

export interface ResourceCategory {
  id: string
  name: string
  type: AssetType
  description?: string
}

export interface ProjectAssetSummary {
  id: string
  name: string
  type: AssetType
  downloadUrl: string
  previewColor?: string
  thumbnail?: string | null
  description?: string | null
  gleaned?: boolean
}

export interface ProjectDirectory {
  id: string
  name: string
  children?: ProjectDirectory[]
  assets?: ProjectAssetSummary[]
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
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface UploadAssetResponse {
  asset: ManagedAsset
}

export interface AssetMutationPayload {
  name?: string
  type?: AssetType
  description?: string | null
  tagIds?: string[]
  categoryId?: string | null
}
