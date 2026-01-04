import { rewriteUrlHostOrOrigin, tryParseUrl } from './urlString'

export interface AssetBlobPayload {
  blob: Blob
  mimeType: string | null
  filename: string | null
  url: string
}

/**
 * Optional: configure a custom downloader implementation.
 *
 * The editor app can inject a worker-based downloader to keep downloads off the main thread.
 * Other runtimes can ignore this.
 */
export type AssetBlobDownloader = (
  urlCandidates: string[],
  controller: AbortController,
  onProgress: (value: number) => void,
) => Promise<AssetBlobPayload>

let assetBlobDownloader: AssetBlobDownloader | null = null

export type AssetDownloadHostMirrorMap = Record<string, string[]>

let assetDownloadHostMirrors: AssetDownloadHostMirrorMap | null = null

/**
 * Configure host mirror mapping for asset downloads.
 *
 * This only affects the generated *download URL candidates*.
 * The asset identifier / cache key stays as the original assetId / URL.
 */
export function configureAssetDownloadHostMirrors(mirrors: AssetDownloadHostMirrorMap | null): void {
  assetDownloadHostMirrors = normalizeHostMirrorMap(mirrors)
}

export function configureAssetBlobDownloader(downloader: AssetBlobDownloader | null): void {
  assetBlobDownloader = downloader
}

export class AssetDownloadWorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetDownloadWorkerUnavailableError'
  }
}

interface UniRequestTask {
  abort?: () => void
  onProgressUpdate?: (callback: (event: { progress: number; totalBytesWritten?: number; totalBytesExpectedToWrite?: number }) => void) => void
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
  const fallbackUrl = candidates[0] ?? url

  if (controller.signal.aborted) {
    throw createAbortError()
  }

  const uniGlobal = typeof uni !== 'undefined' ? uni : undefined
  const streamingFetchSupported = typeof fetch === 'function' && supportsResponseBodyStream()
  const isBrowserEnvironment = typeof window !== 'undefined' && typeof document !== 'undefined'

  const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))

  const tryCandidates = async <T>(
    attempt: (candidate: string) => Promise<T>,
    options: {
      shouldRetry: (error: unknown, candidate: string) => boolean
      onRetryableError?: (error: unknown, candidate: string) => void
      mapNonRetryableError?: (error: unknown, candidate: string) => Error
      finalError?: () => unknown
    },
  ): Promise<T> => {
    let lastError: unknown = null
    for (const candidate of candidates) {
      if (controller.signal.aborted) {
        throw createAbortError()
      }
      try {
        return await attempt(candidate)
      } catch (error) {
        lastError = error
        if (options.shouldRetry(error, candidate)) {
          options.onRetryableError?.(error, candidate)
          continue
        }
        if (options.mapNonRetryableError) {
          throw options.mapNonRetryableError(error, candidate)
        }
        throw toError(error)
      }
    }
    const finalError = options.finalError?.() ?? lastError
    throw toError(finalError ?? new Error('资源下载失败'))
  }

  const fetchAndRead = async (requestUrl: string): Promise<AssetBlobPayload> => {
    const response = await fetch(requestUrl, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`资源下载失败（${response.status}）`)
    }
    return await readBlobWithProgress(response, onProgress, requestUrl)
  }

  if (isBrowserEnvironment && assetBlobDownloader) {
    try {
      return await assetBlobDownloader(candidates, controller, onProgress)
    } catch (error) {
      if (!(error instanceof AssetDownloadWorkerUnavailableError)) {
        throw error instanceof Error ? error : new Error(String(error))
      }
      // Worker path not available; fall back to main-thread implementations.
    }
  }

  if (streamingFetchSupported) {
    let lastNetworkError: unknown = null
    return await tryCandidates(fetchAndRead, {
      shouldRetry: (error, candidate) => error instanceof TypeError && candidate !== url,
      onRetryableError: (error) => {
        lastNetworkError = error
      },
      mapNonRetryableError: (error, candidate) => {
        if (error instanceof TypeError && candidate === url && shouldUpgradeHttpUrlInSecureContext(url)) {
          return new Error('资源下载失败：浏览器已阻止在 HTTPS 页面上访问 HTTP 链接，请尝试改用 HTTPS 地址。')
        }
        return toError(error)
      },
      finalError: () => lastNetworkError,
    })
  }

  if (isBrowserEnvironment && typeof XMLHttpRequest !== 'undefined') {
    return await fetchViaXmlHttp(fallbackUrl, controller, onProgress)
  }

  if (uniGlobal && typeof uniGlobal.request === 'function') {
    return await fetchViaUni(candidates, controller, onProgress)
  }

  if (typeof fetch === 'function') {
    let lastFallbackError: unknown = null
    return await tryCandidates(fetchAndRead, {
      shouldRetry: (error) => {
        lastFallbackError = error
        return true
      },
      finalError: () => lastFallbackError,
    })
  }

  throw new Error('资源下载失败（当前环境不支持下载）')
}

async function readBlobWithProgress(
  response: Response,
  onProgress: (value: number) => void,
  requestUrl: string,
): Promise<AssetBlobPayload> {
  if (!response.body) {
    const blob = await response.blob()
    onProgress(100)
    return {
      blob,
      mimeType: response.headers.get('content-type'),
      filename: extractFilenameFromHeaders(response.headers, response.url || requestUrl),
      url: response.url || requestUrl,
    }
  }

  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let received = 0
  const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10)

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value) {
      const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      chunks.push(chunk)
      received += value.length
      if (total > 0) {
        onProgress(Math.min(99, Math.round((received / total) * 100)))
      } else {
        const estimated = Math.min(95, received % 100)
        onProgress(estimated)
      }
    }
  }

  const blob = new Blob(chunks)
  onProgress(100)
  return {
    blob,
    mimeType: response.headers.get('content-type'),
    filename: extractFilenameFromHeaders(response.headers, response.url || requestUrl),
    url: response.url || requestUrl,
  }
}

async function fetchViaUni(
  urlCandidates: string[] | string,
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  const candidates = Array.isArray(urlCandidates) ? urlCandidates : [urlCandidates]
  if (!candidates.length) {
    throw new Error('资源下载失败（无效的下载地址）')
  }
  let lastError: unknown = null
  for (const candidate of candidates) {
    if (controller.signal.aborted) {
      throw createAbortError()
    }
    try {
      onProgress(0)
      return await fetchViaUniOnce(candidate, controller, onProgress)
    } catch (error) {
      if (isAbortError(error)) {
        throw error instanceof Error ? error : new Error(String(error))
      }
      lastError = error
      if (!shouldRetryUniError(error)) {
        throw error instanceof Error ? error : new Error(String(error))
      }
      // Retry by switching to the next candidate (优先切源策略).
      continue
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '资源下载失败'))
}

async function fetchViaUniOnce(
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  const uniGlobal = uni
  if (!uniGlobal || typeof uniGlobal.request !== 'function') {
    throw new Error('uni.request 不可用')
  }
  const requestFn = uniGlobal.request.bind(uniGlobal) as typeof uniGlobal.request
  return await new Promise((resolve, reject) => {
    let settled = false
    let requestTask: UniRequestTask | undefined
    const cleanup = (listener: () => void) => {
      controller.signal.removeEventListener('abort', listener)
    }
    const handleAbort = () => {
      if (settled) {
        return
      }
      settled = true
      requestTask?.abort?.()
      cleanup(handleAbort)
      reject(createAbortError())
    }
    controller.signal.addEventListener('abort', handleAbort)
    if (controller.signal.aborted) {
      handleAbort()
      return
    }
    requestTask = requestFn({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      success: (res) => {
        if (settled) {
          return
        }
        if ((res.statusCode === 200 || res.statusCode === undefined) && res.data) {
          settled = true
          cleanup(handleAbort)
          const arrayBuffer = res.data as ArrayBuffer
          onProgress(100)
          const blob = new Blob([arrayBuffer])
          resolve({ blob, mimeType: null, filename: null, url })
          return
        }
        settled = true
        cleanup(handleAbort)
        const statusCode = res.statusCode
        const err = new Error(`资源下载失败（${statusCode ?? 'unknown'}）`) as Error & { statusCode?: number; url?: string }
        if (typeof statusCode === 'number') {
          err.statusCode = statusCode
        }
        err.url = url
        reject(err)
      },
      fail: (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        cleanup(handleAbort)
        const err = error instanceof Error ? error : new Error(String(error))
        ;(err as Error & { url?: string }).url = url
        reject(err)
      },
    }) as unknown as UniRequestTask | undefined

    if (requestTask && typeof requestTask.onProgressUpdate === 'function') {
      requestTask.onProgressUpdate((event: {
        progress?: number | null
        totalBytesExpectedToWrite?: number
        totalBytesWritten?: number
      }) => {
        if (settled) {
          return
        }
        if (event.progress === undefined || event.progress === null) {
          const totalBytesExpected = event.totalBytesExpectedToWrite ?? 0
          const totalBytesWritten = event.totalBytesWritten ?? 0
          event.progress =
            totalBytesExpected > 0 && totalBytesWritten >= 0 ? (totalBytesWritten / totalBytesExpected) * 100 : 0
        }
        const value = Number.isFinite(event.progress) ? event.progress : 0
        const normalized = Math.max(0, Math.min(99, Math.round(value)))
        onProgress(normalized)
      })
    }
  })
}

function isAbortError(error: unknown): boolean {
  if (!error) {
    return false
  }
  const name = (error as { name?: unknown }).name
  return name === 'AbortError'
}

function shouldRetryUniError(error: unknown): boolean {
  if (!error) {
    return true
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode
  if (typeof statusCode === 'number') {
    return statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599)
  }
  // If we don't have a status code, assume it's a network/transport error.
  return true
}

async function fetchViaXmlHttp(
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  return await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', url, true)
    request.responseType = 'arraybuffer'
    request.onprogress = (event: ProgressEvent<EventTarget>) => {
      if (!event.lengthComputable) {
        return
      }
      const progress = Math.min(99, Math.round((event.loaded / event.total) * 100))
      onProgress(progress)
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        const arrayBuffer = request.response as ArrayBuffer
        const blob = new Blob([arrayBuffer])
        resolve({
          blob,
          mimeType: request.getResponseHeader('content-type'),
          filename: extractFilenameFromUrl(request.responseURL || url),
          url: request.responseURL || url,
        })
        return
      }
      reject(new Error(`资源下载失败（${request.status}）`))
    }
    request.onerror = () => reject(new Error('网络错误'))
    request.onabort = () => reject(createAbortError())
    controller.signal.addEventListener('abort', () => {
      request.abort()
    })
    request.send()
  })
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
  return extractFilenameFromUrl(url)
}

function extractFilenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined)
    const segment = parsed.pathname.split('/').filter(Boolean).pop()
    if (segment) {
      return decodeURIComponent(segment)
    }
  } catch (_error) {
    /* noop */
  }
  return null
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  ;(error as { name?: string }).name = 'AbortError'
  return error
}

function supportsResponseBodyStream(): boolean {
  if (typeof Response === 'undefined' || typeof ReadableStream === 'undefined') {
    return false
  }
  try {
    const response = new Response()
    return !!response.body && typeof response.body.getReader === 'function'
  } catch (_error) {
    try {
      const response = new Response(new Blob())
      return !!response.body && typeof response.body.getReader === 'function'
    } catch (_innerError) {
      return false
    }
  }
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
  if (!assetDownloadHostMirrors) {
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
  const mirrors = assetDownloadHostMirrors[sourceHost]
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
