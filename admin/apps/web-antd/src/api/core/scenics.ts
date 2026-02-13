import { requestClient } from '#/api/request'

interface ServerPageResult<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}

interface GridPageResult<T> {
  items: T[]
  total: number
}

export interface ScenicItem {
  id: string
  name: string
  location?: string | null
  intro?: string | null
  url?: string | null
  fileKey?: string
  fileUrl?: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ListScenicsParams {
  keyword?: string
  page?: number
  pageSize?: number
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  }
}

export async function listScenicsApi(params: ListScenicsParams) {
  const response = await requestClient.get<ServerPageResult<ScenicItem>>('/admin/scenics', {
    params,
  })
  return normalizeGridPage(response)
}

export async function getScenicApi(id: string) {
  return requestClient.get<ScenicItem>(`/admin/scenics/${id}`)
}

export async function createScenicApi(payload: FormData) {
  return requestClient.post<ScenicItem>('/admin/scenics', payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export async function updateScenicApi(id: string, payload: FormData) {
  return requestClient.put<ScenicItem>(`/admin/scenics/${id}`, payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export async function deleteScenicApi(id: string) {
  return requestClient.delete(`/admin/scenics/${id}`)
}

export function buildScenicDownloadUrl(id: string) {
  return `/api/scenes/${id}/download`
}
