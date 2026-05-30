import { buildServerApiUrl } from '@/api/serverApiConfig'

export type EditorLoginRequest = {
  requestId: string
  username: string
  requestedAt: string
  expiresAt: string
}

export type EditorSessionEventHandlers = {
  onForcedLogout: (reason: 'SESSION_REPLACED') => void
  onLoginRequest?: (request: EditorLoginRequest) => void
}

export interface EditorSessionStreamHandle {
  close: () => void
}

function buildEditorSessionStreamUrl(token: string): string {
  const url = new URL(buildServerApiUrl('/auth/editor-session/stream'))
  url.searchParams.set('token', token)
  return url.toString()
}

export function openEditorSessionStream(token: string, handlers: EditorSessionEventHandlers): EditorSessionStreamHandle {
  const source = new EventSource(buildEditorSessionStreamUrl(token))

  source.addEventListener('forced-logout', (event) => {
    try {
      const detail = JSON.parse((event as MessageEvent<string>).data) as { reason?: string } | null
      if (detail?.reason === 'SESSION_REPLACED') {
        handlers.onForcedLogout('SESSION_REPLACED')
      }
    } catch (_error) {
      handlers.onForcedLogout('SESSION_REPLACED')
    }
    source.close()
  })

  source.addEventListener('login-request', (event) => {
    try {
      const detail = JSON.parse((event as MessageEvent<string>).data) as Partial<EditorLoginRequest> | null
      if (
        detail &&
        typeof detail.requestId === 'string' &&
        typeof detail.username === 'string' &&
        typeof detail.requestedAt === 'string' &&
        typeof detail.expiresAt === 'string'
      ) {
        handlers.onLoginRequest?.({
          requestId: detail.requestId,
          username: detail.username,
          requestedAt: detail.requestedAt,
          expiresAt: detail.expiresAt,
        })
      }
    } catch (_error) {
      // Ignore malformed server-sent events.
    }
  })

  source.addEventListener('error', () => {
    if (source.readyState === EventSource.CLOSED) {
      return
    }
  })

  return {
    close() {
      source.close()
    },
  }
}

export async function respondEditorLoginRequest(token: string, requestId: string, approved: boolean): Promise<boolean> {
  const response = await fetch(buildServerApiUrl(`/auth/editor-session/login-request/${requestId}/respond`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ approved }),
  })

  if (response.status === 404) {
    return false
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || '登录确认响应失败')
  }

  return true
}
