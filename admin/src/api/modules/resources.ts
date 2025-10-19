import { apiClient } from '@/api/http'
import type {
  ManagedAsset,
  PagedRequest,
  PagedResponse,
  ProjectDirectory,
  ResourceCategory,
  UploadAssetResponse,
} from '@/types'

export async function listResourceCategories(): Promise<ResourceCategory[]> {
  const { data } = await apiClient.get<ResourceCategory[]>('/api/resources/categories')
  return data
}

export async function listAssets(params: PagedRequest & { categoryId?: string } = {}): Promise<PagedResponse<ManagedAsset>> {
  const { data } = await apiClient.get<PagedResponse<ManagedAsset>>('/api/resources/assets', { params })
  return data
}

export async function uploadAsset(formData: FormData, options: { categoryId?: string } = {}): Promise<ManagedAsset> {
  const { categoryId } = options
  const query = categoryId ? { categoryId } : undefined
  const { data } = await apiClient.post<UploadAssetResponse>('/api/resources/assets', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params: query,
  })
  return data.asset
}

export async function removeAsset(id: string): Promise<void> {
  await apiClient.delete(`/api/resources/assets/${id}`)
}

export async function getResourceDirectories(): Promise<ProjectDirectory[]> {
  const { data } = await apiClient.get<ProjectDirectory[]>('/api/resources/directories')
  return data
}
