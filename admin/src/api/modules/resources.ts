import { apiClient } from '@/api/http'
import type {
  AssetTag,
  AssetType,
  ManagedAsset,
  PagedRequest,
  PagedResponse,
  ProjectDirectory,
  ResourceCategory,
  UploadAssetResponse,
} from '@/types'

export interface AssetListParams extends PagedRequest {
  categoryId?: string
  categoryPath?: string[]
  includeDescendants?: boolean
  types?: AssetType[] | AssetType
  tagIds?: string[]
}

export async function listResourceCategories(): Promise<ResourceCategory[]> {
  const { data } = await apiClient.get<ResourceCategory[]>('/api/resources/categories')
  return data
}

export async function searchResourceCategories(keyword: string, limit = 20): Promise<ResourceCategory[]> {
  const trimmed = keyword.trim()
  if (!trimmed.length) {
    return []
  }
  const { data } = await apiClient.get<ResourceCategory[]>(
    '/api/resources/categories/search',
    {
      params: { keyword: trimmed, limit },
    },
  )
  return data
}

export interface CreateCategoryPayload {
  path?: string[]
  segments?: string[]
  names?: string[]
  name?: string
  parentId?: string | null
  description?: string | null
}

export async function createResourceCategory(payload: CreateCategoryPayload): Promise<ResourceCategory> {
  const body: Record<string, unknown> = {}
  if (Array.isArray(payload.path)) {
    body.path = payload.path
  } else if (Array.isArray(payload.segments)) {
    body.path = payload.segments
  } else if (Array.isArray(payload.names)) {
    body.path = payload.names
  }
  if (typeof payload.name === 'string') {
    body.name = payload.name
  }
  if (payload.parentId === null) {
    body.parentId = null
  } else if (typeof payload.parentId === 'string') {
    body.parentId = payload.parentId
  }
  if (typeof payload.description === 'string') {
    body.description = payload.description
  }
  const { data } = await apiClient.post<ResourceCategory>('/api/resources/categories', body)
  return data
}

export async function getCategoryPath(categoryId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await apiClient.get<{ id: string; name: string }[]>(`/api/resources/categories/${categoryId}/path`)
  return data
}

export async function listCategoryChildren(categoryId: string | null): Promise<ResourceCategory[]> {
  const id = categoryId ?? 'root'
  const { data } = await apiClient.get<ResourceCategory[]>(`/api/resources/categories/${id}/children`)
  return data
}

export async function listAssets(params: AssetListParams = {}): Promise<PagedResponse<ManagedAsset>> {
  const normalizedParams: Record<string, unknown> = { ...params }
  if (Array.isArray(params.types)) {
    normalizedParams.types = params.types
  }
  if (typeof params.types === 'string') {
    normalizedParams.types = [params.types]
  }
  if (params.tagIds) {
    normalizedParams.tagIds = params.tagIds
  }
  if (Array.isArray(params.categoryPath)) {
    normalizedParams.categoryPath = params.categoryPath
  }
  if (typeof params.includeDescendants === 'boolean') {
    normalizedParams.includeDescendants = params.includeDescendants
  }
  const { data } = await apiClient.get<PagedResponse<ManagedAsset>>('/api/resources/assets', {
    params: normalizedParams,
  })
  return data
}

export async function createAsset(formData: FormData): Promise<ManagedAsset> {
  const { data } = await apiClient.post<UploadAssetResponse>('/api/resources/assets', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data.asset
}

export async function updateAsset(id: string, formData: FormData): Promise<ManagedAsset> {
  const { data } = await apiClient.put<ManagedAsset>(`/api/resources/assets/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function removeAsset(id: string): Promise<void> {
  await apiClient.delete(`/api/resources/assets/${id}`)
}

export async function getAsset(id: string): Promise<ManagedAsset> {
  const { data } = await apiClient.get<ManagedAsset>(`/api/resources/assets/${id}`)
  return data
}

export async function listAssetTags(): Promise<AssetTag[]> {
  const { data } = await apiClient.get<AssetTag[]>('/api/resources/tags')
  return data
}

export async function createAssetTag(payload: { name?: string; names?: string[]; description?: string | null }): Promise<AssetTag[]> {
  const names = new Set<string>()
  if (Array.isArray(payload.names)) {
    payload.names
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0)
      .forEach((value) => names.add(value))
  }
  if (typeof payload.name === 'string') {
    const trimmed = payload.name.trim()
    if (trimmed.length > 0) {
      names.add(trimmed)
    }
  }
  if (!names.size) {
    throw new Error('标签名称不能为空')
  }
  const { data } = await apiClient.post<{ tags: AssetTag[] }>('/api/resources/tags', {
    names: Array.from(names),
    description: payload.description ?? null,
  })
  if (!data.tags?.length) {
    throw new Error('服务器返回的标签数据无效')
  }
  return data.tags
}

export async function updateAssetTag(id: string, payload: { name: string; description?: string | null }): Promise<AssetTag> {
  const { data } = await apiClient.put<AssetTag>(`/api/resources/tags/${id}`, payload)
  return data
}

export async function deleteAssetTag(id: string): Promise<void> {
  await apiClient.delete(`/api/resources/tags/${id}`)
}

export async function refreshAssetManifest(): Promise<void> {
  await apiClient.post('/api/resources/assets/manifest/refresh')
}

export async function getResourceDirectories(): Promise<ProjectDirectory[]> {
  const { data } = await apiClient.get<ProjectDirectory[]>('/api/resources/directories')
  return data
}
