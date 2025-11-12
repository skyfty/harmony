import type { AxiosRequestConfig } from 'axios'
import { apiClient } from '@/api/http'
import type {
  AssetTag,
  ManagedAsset,
  UploadAssetResponse,
  GenerateAssetTagPayload,
  GenerateAssetTagResult,
} from '@/types'

export async function listAssetTags(): Promise<AssetTag[]> {
  const { data } = await apiClient.get<AssetTag[]>('/resources/tags')
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
