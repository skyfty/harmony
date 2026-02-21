import { getBaseUrl, httpRequest } from '@harmony/utils'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS' | 'HEAD'

type HttpRequestOptions = {
  method?: HttpMethod
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  timeoutMs?: number
}

const resolveBaseUrl = getBaseUrl as () => string
const requestMiniApi = httpRequest as <R>(target: string, options?: HttpRequestOptions) => Promise<R>

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
  const base = resolveBaseUrl()

  const payload = await requestMiniApi<MiniApiEnvelope<T> | T>(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
    },
  })

  if (!isMiniApiEnvelope<T>(payload)) {
    return payload as T
  }

  if (payload.code !== 0) {
    throw new Error(payload.message || 'API request failed')
  }

  return payload.data
}
