import type { AxiosRequestConfig } from 'axios'
import { apiClient } from '@/api/http'
import type {
  AssetTag,
  ManagedAsset,
  UploadAssetResponse,
  GenerateAssetTagPayload,
  GenerateAssetTagResult,
  ResourceCategory,
  AssetSeries,
} from '@/types'

export async function listAssetTags(): Promise<AssetTag[]> {
  const { data } = await apiClient.get<AssetTag[]>('/resources/tags')
  return data
}

export async function listResourceCategories(): Promise<ResourceCategory[]> {
  const { data } = await apiClient.get<ResourceCategory[]>('/resources/categories')
  return data
}

export async function searchResourceCategories(keyword: string, limit = 20): Promise<ResourceCategory[]> {
  const trimmed = keyword.trim()
  if (!trimmed.length) {
    return []
  }
  const { data } = await apiClient.get<ResourceCategory[]>('/resources/categories/search', {
    params: { keyword: trimmed, limit },
  })
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
  const { data } = await apiClient.post<ResourceCategory>('/resources/categories', body)
  return data
}

export async function createAssetTags(names: string[], description?: string | null): Promise<AssetTag[]> {
  const normalized = Array.from(
    new Set(
      names
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter((name) => name.length > 0),
    ),
  )
  if (!normalized.length) {
    return []
  }
  const { data } = await apiClient.post<{ tags: AssetTag[] }>('/resources/tags', {
    names: normalized,
    description: description ?? null,
  })
  return data.tags ?? []
}

export interface UploadAssetOptions {
  signal?: AbortSignal
  onUploadProgress?: AxiosRequestConfig['onUploadProgress']
}

export async function uploadAsset(formData: FormData, options: UploadAssetOptions = {}): Promise<ManagedAsset> {
  const { data } = await apiClient.post<UploadAssetResponse>('/resources/assets', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal: options.signal,
    onUploadProgress: options.onUploadProgress,
  })
  return data.asset
}

export async function generateAssetTagSuggestions(
  payload: GenerateAssetTagPayload,
): Promise<GenerateAssetTagResult> {
  const { data } = await apiClient.post<{ data: GenerateAssetTagResult }>('/ai/tags/suggest', payload)
  if (!data?.data || !Array.isArray(data.data.tags)) {
    throw new Error('AI 标签响应格式无效')
  }
  return data.data
}

export async function listAssetSeries(): Promise<AssetSeries[]> {
  const { data } = await apiClient.get<AssetSeries[]>('/resources/series')
  return data
}

export interface CreateSeriesPayload {
  name: string
  description?: string | null
}

export async function createAssetSeries(payload: CreateSeriesPayload): Promise<AssetSeries> {
  const body: Record<string, unknown> = {
    name: payload.name,
  }
  if (payload.description !== undefined) {
    body.description = payload.description ?? null
  }
  const { data } = await apiClient.post<AssetSeries>('/resources/series', body)
  return data
}
