import { rewriteUrlHostOrOrigin, tryParseUrl } from './urlString'

export interface AssetBlobPayload {
  blob: Blob
  mimeType: string | null
  filename: string | null
  url: string
}

export type AssetBlobDownloader = (
  urlCandidates: string[],
  controller: AbortController,
  onProgress: (value: number) => void,
) => Promise<AssetBlobPayload>

type AssetDownloadRuntimeState = {
  assetDownloadModuleTag: string
  assetDownloadHostMirrors: AssetDownloadHostMirrorMap | null
}

const ASSET_DOWNLOAD_RUNTIME_STATE_KEY = '__harmony_schema_asset_download_runtime_state__'

function getAssetDownloadRuntimeState(): AssetDownloadRuntimeState {
  const globalObject = globalThis as typeof globalThis & {
    [ASSET_DOWNLOAD_RUNTIME_STATE_KEY]?: AssetDownloadRuntimeState
  }
  if (!globalObject[ASSET_DOWNLOAD_RUNTIME_STATE_KEY]) {
    globalObject[ASSET_DOWNLOAD_RUNTIME_STATE_KEY] = {
      assetDownloadModuleTag: Math.random().toString(36).slice(2, 10),
      assetDownloadHostMirrors: null,
    }
  }
  return globalObject[ASSET_DOWNLOAD_RUNTIME_STATE_KEY]!
}

export type AssetDownloadHostMirrorMap = Record<string, string[]>

/**
 * Configure host mirror mapping for asset downloads.
 *
 * This only affects the generated *download URL candidates*.
 * The asset identifier / cache key stays as the original assetId / URL.
 */
export function configureAssetDownloadHostMirrors(mirrors: AssetDownloadHostMirrorMap | null): void {
  getAssetDownloadRuntimeState().assetDownloadHostMirrors = normalizeHostMirrorMap(mirrors)
}

export function configureAssetBlobDownloader(downloader: AssetBlobDownloader | null): void {
  void downloader
}

export class AssetDownloadWorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetDownloadWorkerUnavailableError'
  }
}

export async function fetchAssetBlob(
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  const candidates = createDownloadUrlCandidates(url)
  if (!candidates.length) {
    throw new Error('资源下载失败（无效的下载地址）')
  }
  if (controller.signal.aborted) {
    throw createAbortError()
  }
  return await downloadAssetBlob(candidates, controller, onProgress)
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  ;(error as { name?: string }).name = 'AbortError'
  return error
}

function createDownloadUrlCandidates(url: string): string[] {
  const normalized = typeof url === 'string' ? url.trim() : ''
  if (!normalized) {
    return []
  }

  // Base ordering: prefer https-upgraded form (when applicable), then original.
  const bases: string[] = []
  const upgraded = upgradeHttpUrl(normalized)
  if (upgraded && upgraded !== normalized) {
    bases.push(upgraded)
  }
  bases.push(normalized)

  const out: string[] = []
  const seen = new Set<string>()
  const pushUnique = (value: string) => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed) {
      return
    }
    if (seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    out.push(trimmed)
  }

  for (const base of bases) {
    const mirrors = createMirroredUrlCandidates(base)
    mirrors.forEach((candidate) => pushUnique(candidate))
    pushUnique(base)
  }

  return out
}

function createMirroredUrlCandidates(url: string): string[] {
  const state = getAssetDownloadRuntimeState()
  if (!state.assetDownloadHostMirrors) {
    return []
  }
  const parsed = tryParseUrl(url)
  if (!parsed) {
    return []
  }
  const sourceHost = normalizeHostKey(parsed.host)
  if (!sourceHost) {
    return []
  }
  const mirrors = state.assetDownloadHostMirrors[sourceHost]
  if (!Array.isArray(mirrors) || mirrors.length === 0) {
    return []
  }

  const results: string[] = []
  const seen = new Set<string>()
  for (const mirror of mirrors) {
    const trimmed = typeof mirror === 'string' ? mirror.trim() : ''
    if (!trimmed) {
      continue
    }
    const rewritten = rewriteUrlHostOrOrigin(parsed, trimmed)
    if (!rewritten) {
      continue
    }
    if (!seen.has(rewritten)) {
      seen.add(rewritten)
      results.push(rewritten)
    }
  }
  return results
}

async function downloadAssetBlob(
  urlCandidates: string[],
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  let lastNetworkError: unknown = null

  for (const candidate of urlCandidates) {
    try {
      return await downloadAssetBlobFromCandidate(candidate, controller, onProgress)
    } catch (error) {
      if (isRetryableDownloadError(error) && candidate !== urlCandidates[0]) {
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

async function downloadAssetBlobFromCandidate(
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  if (controller.signal.aborted) {
    throw createAbortError()
  }

  if (typeof fetch === 'function') {
    return await downloadAssetBlobViaFetch(url, controller, onProgress)
  }

  const uniApi = typeof uni !== 'undefined' ? uni : null
  if (uniApi && typeof uniApi.request === 'function') {
    return await downloadAssetBlobViaUniRequest(uniApi, url, controller, onProgress)
  }

  throw new Error('资源下载失败（当前环境不支持 fetch 或 uni.request）')
}

async function downloadAssetBlobViaFetch(
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  const response = await fetch(url, { signal: controller.signal })
  if (!response.ok) {
    throw new Error(`资源下载失败（${response.status}）`)
  }

  const mimeType = response.headers.get('content-type')
  const filename = extractFilenameFromHeaders(response.headers, response.url || url)
  const requestUrl = response.url || url
  const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10)

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onProgress(100)
    return buildAssetBlobPayload(buffer, requestUrl, mimeType, filename)
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
  return buildAssetBlobPayload(joined.buffer, requestUrl, mimeType, filename)
}

async function downloadAssetBlobViaUniRequest(
  uniApi: { request?: (options: {
    url: string
    method?: string
    responseType?: 'arraybuffer'
    success: (payload: { statusCode?: number; data?: unknown; header?: Record<string, string> }) => void
    fail: (error: unknown) => void
  }) => { abort?: () => void } | void },
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  return await new Promise<AssetBlobPayload>((resolve, reject) => {
    const task = uniApi.request?.({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      success: (payload) => {
        const statusCode = payload.statusCode ?? 200
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`资源下载失败（${statusCode}）`))
          return
        }
        const arrayBuffer = toArrayBuffer(payload.data)
        const mimeType = payload.header?.['content-type'] ?? payload.header?.['Content-Type'] ?? null
        const filename = extractFilenameFromResponseHeader(payload.header, url)
        onProgress(100)
        resolve(buildAssetBlobPayload(arrayBuffer, url, mimeType, filename))
      },
      fail: (error) => reject(error),
    })

    const abortListener = () => {
      try {
        task?.abort?.()
      } catch {
        /* noop */
      }
      reject(createAbortError())
    }

    if (controller.signal.aborted) {
      abortListener()
      return
    }

    controller.signal.addEventListener('abort', abortListener, { once: true })
  })
}

function buildAssetBlobPayload(
  arrayBuffer: ArrayBuffer,
  url: string,
  mimeType: string | null,
  filename: string | null,
): AssetBlobPayload {
  return {
    blob: new Blob([arrayBuffer], { type: mimeType ?? 'application/octet-stream' }),
    mimeType,
    filename,
    url,
  }
}

function extractFilenameFromResponseHeader(headers: Record<string, string> | undefined, url: string): string | null {
  if (headers) {
    const contentDisposition = headers['content-disposition'] ?? headers['Content-Disposition']
    if (contentDisposition) {
      const filenameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition)
      if (filenameMatch) {
        const encoded = filenameMatch[1] ?? filenameMatch[2]
        if (encoded) {
          try {
            return decodeURIComponent(encoded)
          } catch {
            return encoded
          }
        }
      }
    }
  }
  return extractFilenameFromUrl(url)
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
        } catch {
          return encoded
        }
      }
    }
  }
  return extractFilenameFromUrl(url)
}

function extractFilenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : null
  } catch {
    return null
  }
}

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.byteLength)
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    return bytes.buffer
  }
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer
  }
  return new ArrayBuffer(0)
}

function isRetryableDownloadError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof Error
}

function normalizeHostKey(value: string): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeHostMirrorMap(map: AssetDownloadHostMirrorMap | null): AssetDownloadHostMirrorMap | null {
  if (!map || typeof map !== 'object') {
    return null
  }
  const normalized: AssetDownloadHostMirrorMap = {}
  Object.keys(map).forEach((key) => {
    const hostKey = normalizeHostKey(key)
    if (!hostKey) {
      return
    }
    const mirrors = map[key]
    if (!Array.isArray(mirrors) || mirrors.length === 0) {
      return
    }
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of mirrors) {
      const trimmed = typeof item === 'string' ? item.trim() : ''
      if (!trimmed) {
        continue
      }
      if (seen.has(trimmed)) {
        continue
      }
      seen.add(trimmed)
      out.push(trimmed)
    }
    if (out.length) {
      normalized[hostKey] = out
    }
  })
  return Object.keys(normalized).length ? normalized : null
}

function upgradeHttpUrl(url: string): string | null {
  if (!/^http:\/\//i.test(url)) {
    return null
  }
  if (!shouldUpgradeHttpUrlInSecureContext(url)) {
    return null
  }
  return url.replace(/^http:/i, 'https:')
}

function shouldUpgradeHttpUrlInSecureContext(url: string): boolean {
  if (!/^http:\/\//i.test(url)) {
    return false
  }
  if (typeof globalThis === 'undefined') {
    return false
  }
  const locationLike = (globalThis as { location?: { protocol?: string } }).location
  return locationLike?.protocol === 'https:'
}

declare const uni:
  | {
      request?: (options: {
        url: string
        method?: string
        responseType?: 'arraybuffer' | 'text'
        success: (payload: { statusCode?: number; data?: unknown }) => void
        fail: (error: unknown) => void
      }) => void
    }
  | undefined
