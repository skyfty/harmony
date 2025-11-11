import type { PresetSceneDetail, PresetSceneSummary } from '@/types/preset-scene'
import { useAuthStore } from '@/stores/authStore'

const RAW_BASE_URL = (import.meta.env?.VITE_SERVER_API_BASE_URL as string | undefined)?.trim() ?? ''
const API_BASE_URL = RAW_BASE_URL.endsWith('/') ? RAW_BASE_URL.slice(0, -1) : RAW_BASE_URL
const API_PREFIX = '/api/preset-scenes'

function buildUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!API_BASE_URL) {
    return normalizedPath
  }
  return `${API_BASE_URL}${normalizedPath}`
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
