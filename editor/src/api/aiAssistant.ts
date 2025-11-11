import { buildServerApiUrl } from '@/api/serverApiConfig'
import type { AiAssistantMessageRequest, AiAssistantMessageResponse } from '@/types/ai-assistant'
import { useAuthStore } from '@/stores/authStore'

const ASSISTANT_ENDPOINT = '/assistant/messages'

function buildUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return buildServerApiUrl(normalizedPath)
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const authStore = useAuthStore()
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
  })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }
  const response = await fetch(buildUrl(path), {
    ...init,
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

export async function sendAssistantMessage(payload: AiAssistantMessageRequest): Promise<AiAssistantMessageResponse> {
  return request<AiAssistantMessageResponse>(ASSISTANT_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
