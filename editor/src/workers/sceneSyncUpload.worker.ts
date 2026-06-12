import { zipSync } from 'fflate'

type UploadRequestMessage = {
  type: 'upload'
  requestId: number
  bundleUrl: string
  authorization: string
  filename: string
  files: Record<string, Uint8Array>
}

type PingRequestMessage = {
  type: 'ping'
}

type IncomingMessage = UploadRequestMessage | PingRequestMessage

type ReadyMessage = {
  type: 'ready'
}

type PongMessage = {
  type: 'pong'
}

type ResultMessage = {
  type: 'result'
  requestId: number
  bundleEtag: string | null
}

type ErrorMessage = {
  type: 'error'
  requestId: number
  message: string
}

type OutgoingMessage = ReadyMessage | PongMessage | ResultMessage | ErrorMessage

function post(message: OutgoingMessage): void {
  ;(self as unknown as Worker).postMessage(message)
}

try {
  post({ type: 'ready' })
} catch (_error) {
  /* noop */
}

async function readResponseErrorMessage(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null)
    if (payload && typeof payload === 'object') {
      const candidate = payload as { message?: unknown; data?: unknown }
      if (typeof candidate.message === 'string' && candidate.message.trim().length) {
        return candidate.message
      }
    }
    return null
  }

  const text = await response.text().catch(() => '')
  return text.trim().length ? text : null
}

function createZipBlob(files: Record<string, Uint8Array>): Blob {
  const zipBytes = zipSync(files, { level: 6 })
  const zipArrayBuffer = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(zipArrayBuffer).set(zipBytes)
  return new Blob([zipArrayBuffer], { type: 'application/zip' })
}

function extractBundleEtag(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') {
    return null
  }
  const scene = (data as { scene?: unknown }).scene
  if (!scene || typeof scene !== 'object') {
    return null
  }
  const bundle = (scene as { bundle?: unknown }).bundle
  if (!bundle || typeof bundle !== 'object') {
    return null
  }
  const etag = (bundle as { etag?: unknown }).etag
  return typeof etag === 'string' && etag.trim().length ? etag : null
}

async function uploadSceneBundle(message: UploadRequestMessage): Promise<string | null> {
  const bundleBlob = createZipBlob(message.files)
  const form = new FormData()
  form.append('file', bundleBlob, message.filename)

  const headers = new Headers()
  headers.set('Authorization', message.authorization)
  const response = await fetch(message.bundleUrl, {
    method: 'PUT',
    credentials: 'include',
    headers,
    body: form,
  })
  if (!response.ok) {
    const serverMessage = await readResponseErrorMessage(response)
    const detail = serverMessage ? `: ${serverMessage}` : ''
    throw new Error(`Failed to upload scene bundle (${response.status})${detail}`)
  }

  const payload = await response.json().catch(() => null)
  return extractBundleEtag(payload)
}

;(self as unknown as Worker).addEventListener('message', async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data
  if (!message || typeof message !== 'object') {
    return
  }

  if (message.type === 'ping') {
    post({ type: 'pong' })
    return
  }

  if (message.type !== 'upload') {
    return
  }

  try {
    const bundleEtag = await uploadSceneBundle(message)
    post({ type: 'result', requestId: message.requestId, bundleEtag })
  } catch (error) {
    post({
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

export {}
