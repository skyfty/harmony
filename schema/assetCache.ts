
const NodeBuffer: { from: (data: string, encoding: string) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number } } | undefined =
  typeof globalThis !== 'undefined' && (globalThis as any).Buffer
    ? (globalThis as any).Buffer
    : undefined

export type AssetCacheStatus = 'idle' | 'downloading' | 'cached' | 'error'

export interface AssetCacheEntry {
  assetId: string
  status: AssetCacheStatus
  progress: number
  error: string | null
  blob: Blob | null
  blobUrl: string | null
  size: number
  lastUsedAt: number
  abortController: AbortController | null
  mimeType: string | null
  filename: string | null
  downloadUrl: string | null
}

export interface AssetSource {
  kind: 'arraybuffer' | 'data-url' | 'remote-url' | 'blob'
  data?: ArrayBuffer
  dataUrl?: string
  url?: string
  blob?: Blob
  mimeType?: string | null
  filename?: string | null
}

export interface AssetCacheOptions {
  maxEntries?: number
}

export interface AssetLoadOptions {
  force?: boolean
  onProgress?: (value: number) => void
}

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

export class AssetCache {
  private readonly entries = new Map<string, AssetCacheEntry>()
  private maxEntries: number

  constructor(options: AssetCacheOptions = {}) {
    this.maxEntries = Number.isFinite(options.maxEntries ?? Infinity) ? (options.maxEntries as number) : Infinity
  }

  ensureEntry(assetId: string): AssetCacheEntry {
    let entry = this.entries.get(assetId)
    if (!entry) {
      entry = createEmptyEntry(assetId)
      this.entries.set(assetId, entry)
    }
    return entry
  }

  async getEntry(assetId: string): Promise<AssetCacheEntry | null | undefined> {
    return this.entries.get(assetId) ?? null
  }

  hasCache(assetId: string): boolean {
    return this.entries.get(assetId)?.status === 'cached'
  }

  touch(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (!entry) {
      return
    }
    entry.lastUsedAt = now()
  }

  setMaxEntries(count: number): void {
    this.maxEntries = Math.max(0, count)
    this.evictIfNeeded()
  }

  async storeArrayBuffer(assetId: string, arrayBuffer: ArrayBuffer, payload: {
    mimeType?: string | null
    filename?: string | null
    downloadUrl?: string | null
  } = {}): Promise<AssetCacheEntry> {
    const entry = this.ensureEntry(assetId)
    if (entry.blobUrl) {
      revokeObjectUrl(entry.blobUrl)
      entry.blobUrl = null
    }

    let blob: Blob | null = null
    if (typeof Blob !== 'undefined') {
      blob = new Blob([arrayBuffer], { type: payload.mimeType ?? entry.mimeType ?? 'application/octet-stream' })
      entry.blobUrl = createObjectUrl(blob)
    }

    entry.blob = blob
    entry.mimeType = payload.mimeType ?? blob?.type ?? entry.mimeType ?? null
    entry.filename = payload.filename ?? entry.filename ?? null
    entry.downloadUrl = payload.downloadUrl ?? entry.downloadUrl ?? null
    entry.size = arrayBuffer.byteLength
    finalizeCachedEntry(entry)
    this.evictIfNeeded(assetId)
    return entry
  }

  async storeBlob(assetId: string, blob: Blob, payload: {
    mimeType?: string | null
    filename?: string | null
    downloadUrl?: string | null
  } = {}): Promise<AssetCacheEntry> {
    const entry = this.ensureEntry(assetId)
    if (entry.blobUrl) {
      revokeObjectUrl(entry.blobUrl)
      entry.blobUrl = null
    }

    entry.blob = blob
    entry.mimeType = payload.mimeType ?? blob.type ?? entry.mimeType ?? null
    entry.filename = payload.filename ?? entry.filename ?? (blob instanceof File ? blob.name : null)
    entry.downloadUrl = payload.downloadUrl ?? entry.downloadUrl ?? null
    entry.size = blob.size
    entry.blobUrl = createObjectUrl(blob)
    finalizeCachedEntry(entry)
    this.evictIfNeeded(assetId)
    return entry
  }

  removeCache(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (!entry) {
      return
    }
    if (entry.abortController) {
      entry.abortController.abort()
      entry.abortController = null
    }
    if (entry.blobUrl) {
      revokeObjectUrl(entry.blobUrl)
    }
    entry.status = 'idle'
    entry.progress = 0
    entry.error = null
    entry.blob = null
    entry.blobUrl = null
    entry.size = 0
    entry.mimeType = null
    entry.filename = null
    entry.downloadUrl = null
    entry.lastUsedAt = now()
  }

  setError(assetId: string, message: string): void {
    const entry = this.ensureEntry(assetId)
    entry.status = 'error'
    entry.error = message
    entry.progress = 0
    entry.abortController = null
    entry.lastUsedAt = now()
  }

  releaseInMemoryBlob(assetId: string): void {
    const entry = this.entries.get(assetId)
    if (!entry) {
      return
    }
    if (entry.blobUrl) {
      revokeObjectUrl(entry.blobUrl)
    }
    entry.blob = null
    entry.blobUrl = null
    entry.status = 'idle'
    entry.progress = 0
    entry.error = null
    entry.size = 0
    entry.abortController = null
    entry.lastUsedAt = now()
  }

  evictIfNeeded(preferredAssetId?: string): void {
    if (!Number.isFinite(this.maxEntries) || this.maxEntries <= 0) {
      return
    }
    const cachedEntries = Array.from(this.entries.values()).filter((item) => item.status === 'cached')
    if (cachedEntries.length <= this.maxEntries) {
      return
    }

    cachedEntries.sort((a, b) => a.lastUsedAt - b.lastUsedAt)

    const removable = cachedEntries.filter((entry) => !preferredAssetId || entry.assetId !== preferredAssetId)
    const totalToRemove = cachedEntries.length - this.maxEntries
    let removed = 0

    for (const entry of removable) {
      if (removed >= totalToRemove) {
        break
      }
      this.removeCache(entry.assetId)
      removed += 1
    }

    if (cachedEntries.length - removed > this.maxEntries && preferredAssetId) {
      this.removeCache(preferredAssetId)
    }
  }

  createFileFromCache(assetId: string): File | null {
    const entry = this.entries.get(assetId)
    if (!entry || entry.status !== 'cached' || !entry.blob) {
      return null
    }
    const filename = entry.filename && entry.filename.trim().length ? entry.filename : `${assetId}`
    const mimeType = entry.mimeType ?? 'application/octet-stream'
    try {
      return new File([entry.blob], filename, { type: mimeType })
    } catch (_error) {
      return null
    }
  }
}

export class AssetLoader {
  private readonly cache: AssetCache
  private readonly pending = new Map<string, Promise<AssetCacheEntry>>()

  constructor(cache: AssetCache) {
    this.cache = cache
  }

  getCache(): AssetCache {
    return this.cache
  }

  async load(assetId: string, source: AssetSource, options: AssetLoadOptions = {}): Promise<AssetCacheEntry> {
    if (!assetId) {
      throw new Error('assetId is required')
    }
    if (!options.force) {
      const cached = await this.cache.getEntry(assetId)
      if (cached?.status === 'cached') {
        this.cache.touch(assetId)
        return cached
      }
    }

    const existing = this.pending.get(assetId)
    if (existing) {
      return existing
    }

    const promise = this.resolveLoad(assetId, source, options)
      .catch((error) => {
        const entry = this.cache.ensureEntry(assetId)
        const message = error instanceof Error ? error.message : String(error)
        entry.status = 'error'
        entry.error = message
        entry.abortController = null
        entry.progress = 0
        throw error
      })
      .finally(() => {
        this.pending.delete(assetId)
      })

    this.pending.set(assetId, promise)
    return promise
  }

  async cancel(assetId: string): Promise<void> {
    const entry = await this.cache.getEntry(assetId)
    if (!entry || entry.status !== 'downloading') {
      return
    }
    entry.abortController?.abort()
    entry.abortController = null
    entry.status = 'idle'
    entry.progress = 0
    entry.error = '下载已取消'
  }

  private async resolveLoad(assetId: string, source: AssetSource, options: AssetLoadOptions): Promise<AssetCacheEntry> {
    switch (source.kind) {
      case 'arraybuffer':
        if (!(source.data instanceof ArrayBuffer) || source.data.byteLength === 0) {
          throw new Error('资源数据为空')
        }
        return this.cache.storeArrayBuffer(assetId, source.data, {
          mimeType: source.mimeType ?? null,
          filename: source.filename ?? null,
          downloadUrl: source.url ?? null,
        })
      case 'data-url': {
        const arrayBuffer = decodeDataUrl(source.dataUrl ?? '')
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          throw new Error('资源数据为空')
        }
        return this.cache.storeArrayBuffer(assetId, arrayBuffer, {
          mimeType: source.mimeType ?? null,
          filename: source.filename ?? null,
          downloadUrl: source.url ?? null,
        })
      }
      case 'blob': {
        const entry = await this.cache.storeBlob(assetId, source.blob ?? new Blob([]), {
          mimeType: source.mimeType ?? null,
          filename: source.filename ?? null,
          downloadUrl: source.url ?? null,
        })
        return entry
      }
      case 'remote-url':
      default:
        return this.loadRemote(assetId, source, options)
    }
  }

  private async loadRemote(assetId: string, source: AssetSource, options: AssetLoadOptions): Promise<AssetCacheEntry> {
    if (!source.url) {
      throw new Error('该资源没有可用的下载地址')
    }
    const entry = this.cache.ensureEntry(assetId)
    const controller = new AbortController()
    entry.abortController = controller
    entry.status = 'downloading'
    entry.progress = 0
    entry.error = null
    entry.lastUsedAt = now()

    const { blob, mimeType, filename, url: resolvedUrl } = await fetchAssetBlob(source.url, controller, (progress) => {
      entry.progress = progress
      options.onProgress?.(progress)
    })

    return this.cache.storeBlob(assetId, blob, {
      mimeType: source.mimeType ?? mimeType ?? null,
      filename: source.filename ?? filename ?? null,
      downloadUrl: resolvedUrl ?? source.url,
    })
  }
}

function createEmptyEntry(assetId: string): AssetCacheEntry {
  return {
    assetId,
    status: 'idle',
    progress: 0,
    error: null,
    blob: null,
    blobUrl: null,
    size: 0,
    lastUsedAt: now(),
    abortController: null,
    mimeType: null,
    filename: null,
    downloadUrl: null,
  }
}

function finalizeCachedEntry(entry: AssetCacheEntry): void {
  entry.status = 'cached'
  entry.progress = 100
  entry.error = null
  entry.abortController = null
  entry.lastUsedAt = now()
}

function now(): number {
  return Date.now()
}

function createObjectUrl(blob: Blob | null): string | null {
  if (!blob) {
    return null
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null
  }
  try {
    return URL.createObjectURL(blob)
  } catch (_error) {
    return null
  }
}

function revokeObjectUrl(url: string): void {
  if (!url) {
    return
  }
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return
  }
  try {
    URL.revokeObjectURL(url)
  } catch (_error) {
    /* noop */
  }
}

function decodeDataUrl(dataUrl: string): ArrayBuffer | null {
  if (typeof dataUrl !== 'string') {
    return null
  }
  const [, base64] = dataUrl.split(',')
  const clean = (base64 ?? '').replace(/\s/g, '')
  if (!clean) {
    return new ArrayBuffer(0)
  }
  if (typeof atob === 'function') {
    try {
      const binary = atob(clean)
      const length = binary.length
      const buffer = new Uint8Array(length)
      for (let index = 0; index < length; index += 1) {
        buffer[index] = binary.charCodeAt(index)
      }
      return buffer.buffer
    } catch (_error) {
      /* noop */
    }
  }
  if (NodeBuffer) {
    try {
      const buf = NodeBuffer.from(clean, 'base64')
      const array = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      return array
    } catch (_error) {
      /* noop */
    }
  }
  return null
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
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`资源下载失败（${response.status}）`)
        }
        return await readBlobWithProgress(response, onProgress, candidate)
      } catch (error) {
        if (error instanceof TypeError && candidate !== url) {
          lastNetworkError = error
          continue
        }
        if (error instanceof TypeError && candidate === url && shouldUpgradeHttpUrlInSecureContext(url)) {
          throw new Error('资源下载失败：浏览器已阻止在 HTTPS 页面上访问 HTTP 链接，请尝试改用 HTTPS 地址。')
        }
        throw error instanceof Error ? error : new Error(String(error))
      }
    }
    if (lastNetworkError) {
      throw lastNetworkError instanceof Error ? lastNetworkError : new Error(String(lastNetworkError))
    }
  }
  
  if (isBrowserEnvironment && typeof XMLHttpRequest !== 'undefined') {
    return await fetchViaXmlHttp(fallbackUrl, controller, onProgress)
  }

  
  if (uniGlobal && typeof uniGlobal.request === 'function') {
      return await fetchViaUni(candidates, controller, onProgress)
  }

  if (typeof fetch === 'function') {
    let lastFallbackError: unknown = null
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`资源下载失败（${response.status}）`)
        }
        return await readBlobWithProgress(response, onProgress, candidate)
      } catch (error) {
        lastFallbackError = error
        continue
      }
    }
    if (lastFallbackError) {
      throw lastFallbackError instanceof Error ? lastFallbackError : new Error(String(lastFallbackError))
    }
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
          event.progress = totalBytesExpected > 0 && totalBytesWritten >= 0
            ? (totalBytesWritten / totalBytesExpected) * 100
            : 0
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

function rewriteUrlHostOrOrigin(source: URL, mirrorHostOrOrigin: string): string | null {
  try {
    const value = mirrorHostOrOrigin.trim()
    if (!value) {
      return null
    }

    // If mirror is an origin (has scheme), use its protocol/host.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      const mirror = new URL(value)
      const rewritten = new URL(source.toString())
      rewritten.protocol = mirror.protocol
      rewritten.username = mirror.username
      rewritten.password = mirror.password
      rewritten.host = mirror.host
      return rewritten.toString()
    }

    // If mirror is scheme-relative (e.g. //cdn.example.com), treat as https.
    if (/^\/\//.test(value)) {
      const mirror = new URL(`https:${value}`)
      const rewritten = new URL(source.toString())
      rewritten.protocol = mirror.protocol
      rewritten.host = mirror.host
      return rewritten.toString()
    }

    // Otherwise treat as host[:port], preserve protocol and other URL parts.
    const rewritten = new URL(source.toString())
    rewritten.host = value
    return rewritten.toString()
  } catch (_error) {
    return null
  }
}

function tryParseUrl(url: string): URL | null {
  try {
    // Support scheme-relative URLs.
    if (/^\/\//.test(url)) {
      return new URL(`https:${url}`)
    }
    return new URL(url)
  } catch (_error) {
    return null
  }
}

function normalizeHostKey(value: string): string {
  return (typeof value === 'string' ? value.trim().toLowerCase() : '')
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

declare const uni: {
  request?: (options: {
    url: string
    method?: string
    responseType?: 'arraybuffer' | 'text'
    success: (payload: { statusCode?: number; data?: unknown }) => void
    fail: (error: unknown) => void
  }) => void
} | undefined
