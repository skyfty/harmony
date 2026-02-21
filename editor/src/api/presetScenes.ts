import type { PresetSceneDetail, PresetSceneSummary } from '@/types/preset-scene'
import { useAuthStore } from '@/stores/authStore'
import { buildServerApiUrl } from './serverApiConfig'

const API_PREFIX = '/api/preset-scenes'

function buildUrl(path: string): string {
  return buildServerApiUrl(path)
}

async function request<T>(path: string): Promise<T> {
  const authStore = useAuthStore()
  const headers = new Headers({
    Accept: 'application/json',
  })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }
  const response = await fetch(buildUrl(path), {
    method: 'GET',
    headers,
    credentials: 'include',
  })

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const body = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    const message = body && typeof body.message === 'string'
      ? body.message
      : `请求失败 (${response.status})`
    throw new Error(message)
  }

  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data
  }

  return (body as T) ?? (null as T)
}

export async function fetchPresetSceneSummaries(): Promise<PresetSceneSummary[]> {
  return request<PresetSceneSummary[]>(API_PREFIX)
}

export async function fetchPresetSceneDetail(id: string): Promise<PresetSceneDetail> {
  const encodedId = encodeURIComponent(id)
  return request<PresetSceneDetail>(`${API_PREFIX}/${encodedId}`)
}
