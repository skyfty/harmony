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
  types?: AssetType[] | AssetType
  tagIds?: string[]
}

export async function listResourceCategories(): Promise<ResourceCategory[]> {
  const { data } = await apiClient.get<ResourceCategory[]>('/api/resources/categories')
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

export async function createAssetTag(payload: { name: string; description?: string | null }): Promise<AssetTag> {
  const { data } = await apiClient.post<AssetTag>('/api/resources/tags', payload)
  return data
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
