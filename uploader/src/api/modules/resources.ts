import type { AxiosProgressEvent } from 'axios'
import { apiClient } from '@/api/http'
import type { AssetTag, UploadAssetPayload, UploadAssetResponse } from '@/types'

export async function listAssetTags(): Promise<AssetTag[]> {
  const response = await apiClient.get<AssetTag[]>('/resources/tags')
  return response.data
}

export async function createAssetTag(name: string, description?: string): Promise<AssetTag> {
  const response = await apiClient.post<{ tags: AssetTag[] }>('/resources/tags', {
    name,
    description,
  })
  const [tag] = response.data.tags
  if (!tag) {
    throw new Error('未能创建标签')
  }
  return tag
}

export async function uploadAsset(payload: UploadAssetPayload, options?: {
  signal?: AbortSignal
  onProgress?: (progress: number, event: AxiosProgressEvent) => void
}): Promise<UploadAssetResponse> {
  const formData = new FormData()
  formData.append('file', payload.file)
  if (payload.name?.trim().length) {
    formData.append('name', payload.name.trim())
  }
  if (payload.type) {
    formData.append('type', payload.type)
  }
  if (payload.description?.trim().length) {
    formData.append('description', payload.description.trim())
  }
  payload.tagIds.forEach((tagId: string) => {
    if (tagId.trim().length) {
      formData.append('tagIds', tagId)
    }
  })
  if (payload.categoryId?.trim().length) {
    formData.append('categoryId', payload.categoryId.trim())
  }

  const response = await apiClient.post<UploadAssetResponse>('/resources/assets', formData, {
    signal: options?.signal,
  onUploadProgress: (event: AxiosProgressEvent) => {
      if (typeof options?.onProgress === 'function') {
        const total = event.total ?? payload.file.size
        const loaded = event.loaded ?? 0
        const progress = total > 0 ? Math.min(1, loaded / total) : 0
        options.onProgress(progress, event)
      }
    },
  })

  return response.data
}
