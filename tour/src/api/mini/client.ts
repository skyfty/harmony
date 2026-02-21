import * as HarmonyUtils from '@harmony/utils'
import { getAccessToken } from './token'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS' | 'HEAD'

type HttpRequestOptions = {
  method?: HttpMethod
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  timeoutMs?: number
}

type UtilsHttpModule = {
  getBaseUrl?: () => string
  httpRequest?: <R>(target: string, options?: unknown) => Promise<R>
}

const utilsHttp = HarmonyUtils as unknown as UtilsHttpModule

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
  const base = typeof utilsHttp.getBaseUrl === 'function' ? utilsHttp.getBaseUrl() : ''
  const token = getAccessToken()

  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const request = utilsHttp.httpRequest
  if (typeof request !== 'function') {
    throw new Error('httpRequest is not available from @harmony/utils')
  }

  const payload = await request<MiniApiEnvelope<T> | T>(`${base}${path}`, {
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
