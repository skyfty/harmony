import { apiClient } from '@/api/http'
import type { PagedResponse, SceneDetail, SceneListParams, SceneSummary } from '@/types'

type ResponseWrapper<T> = { data: T }

function buildParams(params: SceneListParams): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  if (typeof params.page === 'number') {
    normalized.page = params.page
  }
  if (typeof params.pageSize === 'number') {
    normalized.pageSize = params.pageSize
  }
  if (typeof params.keyword === 'string' && params.keyword.trim().length) {
    normalized.keyword = params.keyword.trim()
  }
  if (typeof params.createdFrom === 'string' && params.createdFrom.trim().length) {
    normalized.createdFrom = params.createdFrom
  }
  if (typeof params.createdTo === 'string' && params.createdTo.trim().length) {
    normalized.createdTo = params.createdTo
  }
  return normalized
}

export function listScenes(params: SceneListParams = {}): Promise<PagedResponse<SceneSummary>> {
  return apiClient
    .get<PagedResponse<SceneSummary>>('/api/scenes', {
      params: buildParams(params),
    })
    .then((response: ResponseWrapper<PagedResponse<SceneSummary>>) => response.data)
}

export function getSceneDetail(id: string): Promise<SceneDetail> {
  return apiClient
    .get<{ data: SceneDetail }>(`/api/scenes/${id}`)
    .then((response: ResponseWrapper<{ data: SceneDetail }>) => response.data.data)
}

export function createSceneEntry(formData: FormData): Promise<SceneDetail> {
  return apiClient
    .post<{ data: SceneDetail }>(
      '/api/scenes',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      },
    )
    .then((response: ResponseWrapper<{ data: SceneDetail }>) => response.data.data)
}

export function updateSceneEntry(id: string, formData: FormData): Promise<SceneDetail> {
  return apiClient
    .put<{ data: SceneDetail }>(
      `/api/scenes/${id}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      },
    )
    .then((response: ResponseWrapper<{ data: SceneDetail }>) => response.data.data)
}

export function deleteSceneEntry(id: string): Promise<void> {
  return apiClient.delete(`/api/scenes/${id}`).then(() => undefined)
}

export function getSceneDownloadUrl(id: string): string {
  return `/api/scenes/${id}/download`
}
