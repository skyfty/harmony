import type { MultiuserRuntimeSnapshot } from '#/api'

type MultiuserRuntimeStreamHandlers = {
  onSnapshot: (snapshot: MultiuserRuntimeSnapshot) => void
  onError?: (message: string) => void
}

function parseEventPayload(eventName: string, dataText: string, handlers: MultiuserRuntimeStreamHandlers): void {
  if (!eventName || !dataText) {
    return
  }
  if (eventName === 'snapshot') {
    try {
      const payload = JSON.parse(dataText) as MultiuserRuntimeSnapshot
      handlers.onSnapshot(payload)
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error.message : 'Failed to parse multiuser runtime snapshot')
    }
  }
}

export async function connectMultiuserRuntimeStream(
  token: string,
  handlers: MultiuserRuntimeStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const headers = new Headers({ Accept: 'text/event-stream' })
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch('/api/admin/multiuser/runtime/stream', {
    headers,
    signal,
  })

  if (!response.ok) {
    throw new Error(`Failed to open multiuser runtime stream (${response.status})`)
  }

  if (!response.body) {
    throw new Error('Multiuser runtime stream is not readable')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const flushEvent = (): void => {
    if (!eventName && !dataLines.length) {
      return
    }
    const dataText = dataLines.join('\n')
    parseEventPayload(eventName, dataText, handlers)
    eventName = ''
    dataLines = []
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let lineBreakIndex = buffer.indexOf('\n')
      while (lineBreakIndex >= 0) {
        const rawLine = buffer.slice(0, lineBreakIndex)
        buffer = buffer.slice(lineBreakIndex + 1)
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

        if (!line.length) {
          flushEvent()
        } else if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart())
        }

        lineBreakIndex = buffer.indexOf('\n')
      }
    }
  } finally {
    flushEvent()
    reader.releaseLock()
  }
}
