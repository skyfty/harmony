type DownloadRequestMessage = {
  type: 'download'
  requestId: number
  urlCandidates: string[]
}

type AbortRequestMessage = {
  type: 'abort'
  requestId: number
}

type PingRequestMessage = {
  type: 'ping'
}

type IncomingMessage = DownloadRequestMessage | AbortRequestMessage | PingRequestMessage

type ProgressMessage = {
  type: 'progress'
  requestId: number
  value: number
}

type ResultMessage = {
  type: 'result'
  requestId: number
  url: string
  mimeType: string | null
  filename: string | null
  buffer: ArrayBuffer
}

type ErrorMessage = {
  type: 'error'
  requestId: number
  message: string
}

type ReadyMessage = {
  type: 'ready'
}

type PongMessage = {
  type: 'pong'
}

type OutgoingMessage = ProgressMessage | ResultMessage | ErrorMessage | ReadyMessage | PongMessage

const inFlight = new Map<number, AbortController>()

function debugEnabled(): boolean {
  return (globalThis as unknown as { __HARMONY_ASSET_DOWNLOAD_DEBUG__?: boolean }).__HARMONY_ASSET_DOWNLOAD_DEBUG__ === true
}

function debugLog(message: string, extra?: unknown): void {
  if (!debugEnabled()) {
    return
  }
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.debug(`[asset-download-worker] ${message}`, extra)
    return
  }
  // eslint-disable-next-line no-console
  console.debug(`[asset-download-worker] ${message}`)
}

function post(message: OutgoingMessage, transfer?: Transferable[]) {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

// Handshake: if you never see this, the worker script likely failed to load.
try {
  post({ type: 'ready' })
} catch (_error) {
  /* noop */
}

function extractFilenameFromHeaders(headers: Headers, url: string): string | null {
  const contentDisposition = headers.get('content-disposition')
  if (contentDisposition) {
    const filenameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition)
    if (filenameMatch) {
      const encoded = filenameMatch[1] ?? filenameMatch[2]
      if (encoded) {
        try {
          return decodeURIComponent(encoded)
        } catch (_error) {
          return encoded
        }
      }
    }
  }
  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : null
  } catch (_error) {
    return null
  }
}

async function downloadViaFetch(
  urlCandidates: string[],
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<{
  url: string
  mimeType: string | null
  filename: string | null
  buffer: ArrayBuffer
}> {
  let lastNetworkError: unknown = null

  for (const candidate of urlCandidates) {
    try {
      const response = await fetch(candidate, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`资源下载失败（${response.status}）`)
      }

      const mimeType = response.headers.get('content-type')
      const filename = extractFilenameFromHeaders(response.headers, response.url || candidate)
      const requestUrl = response.url || candidate

      const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
      if (!response.body) {
        const buffer = await response.arrayBuffer()
        onProgress(100)
        return { url: requestUrl, mimeType, filename, buffer }
      }

      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        if (value && value.byteLength) {
          chunks.push(value)
          received += value.byteLength
          if (total > 0) {
            onProgress(Math.min(99, Math.round((received / total) * 100)))
          } else {
            onProgress(Math.min(95, received % 100))
          }
        }
      }

      const joined = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        joined.set(chunk, offset)
        offset += chunk.byteLength
      }

      onProgress(100)
      return { url: requestUrl, mimeType, filename, buffer: joined.buffer }
    } catch (error) {
      if (error instanceof TypeError && candidate !== urlCandidates[0]) {
        lastNetworkError = error
        continue
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  if (lastNetworkError) {
    throw lastNetworkError instanceof Error ? lastNetworkError : new Error(String(lastNetworkError))
  }
  throw new Error('资源下载失败（网络错误）')
}

;(self as unknown as Worker).addEventListener('message', async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data
  if (!message || typeof message !== 'object') {
    return
  }

  debugLog('received message', message)

  if (message.type === 'ping') {
    post({ type: 'pong' })
    return
  }

  if (message.type === 'abort') {
    const controller = inFlight.get(message.requestId)
    if (controller) {
      debugLog('abort', { requestId: message.requestId })
      controller.abort()
      inFlight.delete(message.requestId)
    }
    return
  }

  if (message.type !== 'download') {
    return
  }

  const requestId = message.requestId
  const urlCandidates = Array.isArray(message.urlCandidates) ? message.urlCandidates : []
  if (!urlCandidates.length) {
    post({ type: 'error', requestId, message: '资源下载失败（无效的下载地址）' })
    return
  }

  const controller = new AbortController()
  inFlight.set(requestId, controller)

  try {
    debugLog('start download', { requestId, urlCandidates })
    const result = await downloadViaFetch(urlCandidates, controller, (value) => {
      post({ type: 'progress', requestId, value })
    })

    inFlight.delete(requestId)

    debugLog('download done', { requestId, url: result.url, bytes: result.buffer.byteLength })

    post(
      {
        type: 'result',
        requestId,
        url: result.url,
        mimeType: result.mimeType,
        filename: result.filename,
        buffer: result.buffer,
      },
      [result.buffer],
    )
  } catch (error) {
    inFlight.delete(requestId)

    const messageText = controller.signal.aborted ? 'Aborted' : error instanceof Error ? error.message : String(error)

    debugLog('download error', { requestId, message: messageText })

    post({ type: 'error', requestId, message: messageText })
  }
})
