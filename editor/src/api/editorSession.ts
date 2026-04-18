import { buildServerApiUrl } from '@/api/serverApiConfig'

export type EditorSessionEventHandlers = {
  onForcedLogout: (reason: 'SESSION_REPLACED') => void
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