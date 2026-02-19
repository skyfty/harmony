import { httpRequest, type HttpRequestOptions } from '@/api/http'
import { getMiniApiBaseUrl } from './config'
import { getAccessToken } from './token'

type MiniApiEnvelope<T> = {
  code: number
  data: T
  message: string
}

function isMiniApiEnvelope<T>(value: unknown): value is MiniApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string'
}

export async function miniRequest<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
  const base = getMiniApiBaseUrl()
  const token = getAccessToken()

  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const payload = await httpRequest<MiniApiEnvelope<T> | T>(`${base}${path}`, {
    ...options,
    headers,
  })

  if (!isMiniApiEnvelope<T>(payload)) {
    return payload as T
  }

  if (payload.code !== 0) {
    throw new Error(payload.message || 'API request failed')
  }

  return payload.data
}
