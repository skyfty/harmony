import type { AiAssistantMessageRequest, AiAssistantMessageResponse } from '@/types/ai-assistant'

function readRuntimeBaseUrl(): string {
  const runtime = (window as any).__HARMONY_RUNTIME_CONFIG__ as { serverApiBaseUrl?: string } | undefined
  const fromRuntime = runtime?.serverApiBaseUrl?.trim()
  if (fromRuntime) return fromRuntime
  return (import.meta.env?.VITE_SERVER_API_BASE_URL as string | undefined)?.trim() ?? ''
}

const RAW_BASE_URL = readRuntimeBaseUrl()
const API_BASE_URL = RAW_BASE_URL.endsWith('/') ? RAW_BASE_URL.slice(0, -1) : RAW_BASE_URL
const API_PREFIX = '/api/assistant/messages'

function buildUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!API_BASE_URL) {
    return normalizedPath
  }
  return `${API_BASE_URL}${normalizedPath}`
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
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

export async function sendAssistantMessage(payload: AiAssistantMessageRequest): Promise<AiAssistantMessageResponse> {
  return request<AiAssistantMessageResponse>(API_PREFIX, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
