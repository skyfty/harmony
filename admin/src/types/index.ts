export interface RoleSummary {
  id: string
  name: string
  code: string
  description?: string
  permissions: string[]
}

export interface RoleMutationPayload {
  name: string
  code: string
  description?: string
  permissionIds: string[]
}

export interface PermissionSummary {
  id: string
  name: string
  code: string
  description?: string
  group?: string
}

export interface PermissionMutationPayload {
  name: string
  code: string
  description?: string
  group?: string
}

export interface UserSummary {
  id: string
  username: string
  email?: string
  displayName?: string
  roles: RoleSummary[]
  status: 'active' | 'disabled'
  createdAt?: string
  updatedAt?: string
}

export interface UserMutationPayload {
  username: string
  password?: string
  email?: string
  displayName?: string
  roleIds: string[]
  status?: 'active' | 'disabled'
}

export interface MenuItem {
  id: string
  name: string
  icon?: string
  routeName?: string
  order?: number
  permission?: string
  children?: MenuItem[]
}

export interface MenuMutationPayload {
  name: string
  icon?: string
  routeName?: string
  order?: number
  permission?: string
  parentId?: string | null
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  user: UserSummary
  permissions: string[]
  menus: MenuItem[]
}

export interface AuthProfileResponse {
  user: UserSummary
  permissions: string[]
  menus: MenuItem[]
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
  type: 'model' | 'image' | 'texture' | 'file'
  description?: string
}

export interface ProjectAssetSummary {
  id: string
  name: string
  type: 'model' | 'image' | 'texture' | 'file'
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

export interface ContentEntry {
  id: string
  slug: string
  title: string
  summary?: string
  body?: string
  status: 'draft' | 'published'
  createdAt: string
  updatedAt: string
}

export interface ContentMutationPayload {
  slug: string
  title: string
  summary?: string
  body?: string
  status?: 'draft' | 'published'
}

export interface ManagedAsset {
  id: string
  name: string
  categoryId: string
  type: 'model' | 'image' | 'texture' | 'file'
  size: number
  url: string
  previewUrl?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface UploadAssetResponse {
  asset: ManagedAsset
}
