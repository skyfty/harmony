import { rewriteUrlHostOrOrigin, tryParseUrl } from './urlString'

export interface AssetBlobPayload {
  blob: Blob
  mimeType: string | null
  filename: string | null
  url: string
}

export type AssetBlobDownloadResult =
  | {
      kind: 'not-modified'
      statusCode: 304
      url: string
      headers: Record<string, string>
    }
  | {
      kind: 'downloaded'
      statusCode: number
      url: string
      blob: Blob
      mimeType: string | null
      filename: string | null
      headers: Record<string, string>
    }

export type AssetBlobDownloader = (
  urlCandidates: string[],
  controller: AbortController,
  onProgress: (value: number) => void,
) => Promise<AssetBlobPayload>

export type AssetBlobDownloadOptions = {
  /**
   * Prefer downloading via uni.downloadFile (streams to a temp file and supports
   * onProgressUpdate on mini-program platforms). Falls back to fetch / uni.request
   * when file download is unavailable.
   */
  fileDownload?: boolean
}

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
  options: AssetBlobDownloadOptions = {},
): Promise<AssetBlobPayload> {
  const candidates = createDownloadUrlCandidates(url)
  if (!candidates.length) {
    throw new Error('资源下载失败（无效的下载地址）')
  }
  if (controller.signal.aborted) {
    throw createAbortError()
  }
  return await downloadAssetBlob(candidates, controller, onProgress, options)
}

export async function fetchAssetBlobWithResponse(
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
  requestHeaders?: Record<string, string>,
  options: AssetBlobDownloadOptions = {},
): Promise<AssetBlobDownloadResult> {
  const candidates = createDownloadUrlCandidates(url)
  if (!candidates.length) {
    throw new Error('资源下载失败（无效的下载地址）')
  }
  if (controller.signal.aborted) {
    throw createAbortError()
  }
  return await downloadAssetBlobWithResponse(candidates, controller, onProgress, requestHeaders, options)
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
  options: AssetBlobDownloadOptions,
): Promise<AssetBlobPayload> {
  let lastNetworkError: unknown = null

  for (const candidate of urlCandidates) {
    try {
      return await downloadAssetBlobFromCandidate(candidate, controller, onProgress, options)
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

async function downloadAssetBlobWithResponse(
  urlCandidates: string[],
  controller: AbortController,
  onProgress: (value: number) => void,
  requestHeaders?: Record<string, string>,
  options: AssetBlobDownloadOptions = {},
): Promise<AssetBlobDownloadResult> {
  let lastNetworkError: unknown = null

  for (const candidate of urlCandidates) {
    try {
      return await downloadAssetBlobFromCandidateWithResponse(candidate, controller, onProgress, requestHeaders, options)
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
  options: AssetBlobDownloadOptions = {},
): Promise<AssetBlobPayload> {
  if (controller.signal.aborted) {
    throw createAbortError()
  }

  if (options.fileDownload) {
    const fileDownloadApi = resolveUniDownloadFileApi()
    if (fileDownloadApi) {
      return await downloadAssetBlobViaUniDownloadFile(fileDownloadApi, url, controller, onProgress)
    }
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

async function downloadAssetBlobFromCandidateWithResponse(
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
  requestHeaders?: Record<string, string>,
  options: AssetBlobDownloadOptions = {},
): Promise<AssetBlobDownloadResult> {
  if (controller.signal.aborted) {
    throw createAbortError()
  }

  if (options.fileDownload) {
    const fileDownloadApi = resolveUniDownloadFileApi()
    if (fileDownloadApi) {
      return await downloadAssetBlobViaUniDownloadFileWithResponse(fileDownloadApi, url, controller, onProgress, requestHeaders)
    }
  }

  if (typeof fetch === 'function') {
    return await downloadAssetBlobViaFetchWithResponse(url, controller, onProgress, requestHeaders)
  }

  const uniApi = typeof uni !== 'undefined' ? uni : null
  if (uniApi && typeof uniApi.request === 'function') {
    return await downloadAssetBlobViaUniRequestWithResponse(uniApi, url, controller, onProgress, requestHeaders)
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
  const normalizedContentType = mimeType?.toLowerCase() ?? ''
  if (normalizedContentType.includes('text/html') || normalizedContentType.includes('application/xhtml+xml')) {
    const body = await response.text().catch(() => '')
    const snippet = body.trimStart().slice(0, 80)
    const location = response.url && response.url !== url ? `${url} -> ${response.url}` : url
    const htmlHint = /^<!doctype\s+html/i.test(snippet) || /^<html[\s>]/i.test(snippet)
      ? 'HTML 页面'
      : '网页内容'
    throw new Error(`资源下载失败：${location} 返回了${htmlHint}，请检查下载地址或登录态是否有效`)
  }
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

async function downloadAssetBlobViaFetchWithResponse(
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
  requestHeaders?: Record<string, string>,
): Promise<AssetBlobDownloadResult> {
  const response = await fetch(url, {
    signal: controller.signal,
    headers: normalizeRequestHeaders(requestHeaders),
    cache: 'no-store',
  })
  const responseHeaders = headersToRecord(response.headers)
  if (response.status === 304) {
    return {
      kind: 'not-modified',
      statusCode: 304,
      url: response.url || url,
      headers: responseHeaders,
    }
  }
  if (!response.ok) {
    throw new Error(`资源下载失败（${response.status}）`)
  }

  const mimeType = response.headers.get('content-type')
  const normalizedContentType = mimeType?.toLowerCase() ?? ''
  if (normalizedContentType.includes('text/html') || normalizedContentType.includes('application/xhtml+xml')) {
    const body = await response.text().catch(() => '')
    const snippet = body.trimStart().slice(0, 80)
    const location = response.url && response.url !== url ? `${url} -> ${response.url}` : url
    const htmlHint = /^<!doctype\s+html/i.test(snippet) || /^<html[\s>]/i.test(snippet)
      ? 'HTML 页面'
      : '网页内容'
    throw new Error(`资源下载失败：${location} 返回了${htmlHint}，请检查下载地址或登录态是否有效`)
  }
  const filename = extractFilenameFromHeaders(response.headers, response.url || url)
  const requestUrl = response.url || url
  const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10)

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onProgress(100)
    return {
      kind: 'downloaded',
      statusCode: response.status,
      url: requestUrl,
      blob: new Blob([buffer], { type: mimeType ?? 'application/octet-stream' }),
      mimeType,
      filename,
      headers: responseHeaders,
    }
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
  return {
    kind: 'downloaded',
    statusCode: response.status,
    url: requestUrl,
    blob: new Blob([joined.buffer], { type: mimeType ?? 'application/octet-stream' }),
    mimeType,
    filename,
    headers: responseHeaders,
  }
}

type UniDownloadFilePayload = {
  statusCode?: number
  tempFilePath?: string
  header?: Record<string, string> | null
}

type UniDownloadFileProgressPayload = {
  progress?: number
}

type UniDownloadFileHeaderPayload = {
  header?: Record<string, string> | null
}

type UniDownloadFileTask = {
  abort?: () => void
  onProgressUpdate?: (listener: (payload: UniDownloadFileProgressPayload) => void) => void
  onHeadersReceived?: (listener: (payload: UniDownloadFileHeaderPayload) => void) => void
}

type UniReadFileFs = {
  readFile?: (options: {
    filePath: string
    success: (result: { data?: unknown }) => void
    fail: (error: unknown) => void
  }) => void
}

type UniDownloadFileApi = {
  downloadFile: (options: {
    url: string
    header?: Record<string, string>
    success: (payload: UniDownloadFilePayload) => void
    fail: (error: unknown) => void
  }) => UniDownloadFileTask | undefined
  readFileAsArrayBuffer: (filePath: string) => Promise<ArrayBuffer>
}

function resolveUniDownloadFileApi(): UniDownloadFileApi | null {
  const uniApi = typeof uni !== 'undefined' ? uni : null
  if (!uniApi || typeof uniApi.downloadFile !== 'function') {
    return null
  }

  let platform = ''
  try {
    const systemInfo = typeof uniApi.getSystemInfoSync === 'function' ? uniApi.getSystemInfoSync() : null
    platform = systemInfo && typeof systemInfo.uniPlatform === 'string' ? systemInfo.uniPlatform : ''
  } catch {
    /* noop */
  }
  if (platform === 'web') {
    return null
  }

  const wxAny = typeof wx !== 'undefined' ? wx : null
  const isWeChatRuntime = Boolean(wxAny && typeof wxAny.getFileSystemManager === 'function')
  if (!isWeChatRuntime && !platform.startsWith('mp-')) {
    return null
  }

  const fs =
    (typeof uniApi.getFileSystemManager === 'function' ? uniApi.getFileSystemManager() : null) ??
    (wxAny && typeof wxAny.getFileSystemManager === 'function' ? wxAny.getFileSystemManager() : null)
  if (!fs || typeof fs.readFile !== 'function') {
    return null
  }

  return {
    downloadFile: (options) => uniApi.downloadFile?.(options) ?? undefined,
    readFileAsArrayBuffer: (filePath) => readFileAsArrayBufferByUniFs(fs, filePath),
  }
}

function readFileAsArrayBufferByUniFs(fs: UniReadFileFs, filePath: string): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const readFile = fs.readFile
    if (typeof readFile !== 'function') {
      reject(new Error('资源下载失败（当前环境不支持读取临时文件）'))
      return
    }
    readFile({
      filePath,
      success: (result) => {
        const data = result.data
        if (data instanceof ArrayBuffer) {
          resolve(data)
          return
        }
        if (ArrayBuffer.isView(data)) {
          const bytes = new Uint8Array(data.byteLength)
          bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
          resolve(bytes.buffer)
          return
        }
        if (typeof data === 'string') {
          let binary = true
          for (let index = 0; index < data.length; index += 1) {
            if (data.charCodeAt(index) > 0xff) {
              binary = false
              break
            }
          }
          if (!binary) {
            reject(new Error('资源下载失败（临时文件读取结果不是二进制数据）'))
            return
          }
          const bytes = new Uint8Array(data.length)
          for (let index = 0; index < data.length; index += 1) {
            bytes[index] = data.charCodeAt(index)
          }
          resolve(bytes.buffer)
          return
        }
        reject(new Error('资源下载失败（临时文件读取结果不是二进制数据）'))
      },
      fail: (error) => reject(error instanceof Error ? error : new Error(String(error))),
    })
  })
}

async function downloadAssetBlobViaUniDownloadFile(
  api: UniDownloadFileApi,
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
): Promise<AssetBlobPayload> {
  const result = await downloadAssetBlobViaUniDownloadFileWithResponse(api, url, controller, onProgress)
  if (result.kind === 'not-modified') {
    throw new Error('资源下载失败（服务器返回未修改状态）')
  }
  return {
    blob: result.blob,
    mimeType: result.mimeType,
    filename: result.filename,
    url: result.url,
  }
}

async function downloadAssetBlobViaUniDownloadFileWithResponse(
  api: UniDownloadFileApi,
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
  requestHeaders?: Record<string, string>,
): Promise<AssetBlobDownloadResult> {
  return await new Promise<AssetBlobDownloadResult>((resolve, reject) => {
    let settled = false
    let task: UniDownloadFileTask | null = null
    let responseHeaders: Record<string, string> | null = null

    const abortListener = () => {
      if (settled) {
        return
      }
      settled = true
      controller.signal.removeEventListener('abort', abortListener)
      try {
        task?.abort?.()
      } catch {
        /* noop */
      }
      reject(createAbortError())
    }

    const settleFailure = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      controller.signal.removeEventListener('abort', abortListener)
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const settleDownloaded = (arrayBuffer: ArrayBuffer, statusCode: number, headers: Record<string, string>) => {
      if (settled) {
        return
      }
      settled = true
      controller.signal.removeEventListener('abort', abortListener)
      const mimeType = headers['content-type'] ?? null
      const filename = extractFilenameFromResponseHeader(headers, url)
      onProgress(100)
      resolve({
        kind: 'downloaded',
        statusCode,
        url,
        blob: new Blob([arrayBuffer], { type: mimeType ?? 'application/octet-stream' }),
        mimeType,
        filename,
        headers,
      })
    }

    const normalizedRequestHeaders = normalizeRequestHeaders(requestHeaders)
    task = api.downloadFile({
      url,
      ...(normalizedRequestHeaders ? { header: normalizedRequestHeaders } : {}),
      success: (payload) => {
        const statusCode = payload.statusCode ?? 200
        const headers = normalizeResponseHeaders(responseHeaders ?? payload.header)
        if (statusCode === 304) {
          if (settled) {
            return
          }
          settled = true
          controller.signal.removeEventListener('abort', abortListener)
          resolve({
            kind: 'not-modified',
            statusCode: 304,
            url,
            headers,
          })
          return
        }
        if (statusCode < 200 || statusCode >= 300) {
          settleFailure(new Error(`资源下载失败（${statusCode}）`))
          return
        }
        const tempFilePath = typeof payload.tempFilePath === 'string' ? payload.tempFilePath.trim() : ''
        if (!tempFilePath) {
          settleFailure(new Error('资源下载失败（未返回临时文件路径）'))
          return
        }
        api.readFileAsArrayBuffer(tempFilePath).then(
          (arrayBuffer) => settleDownloaded(arrayBuffer, statusCode, headers),
          (error) => settleFailure(error),
        )
      },
      fail: (error) => settleFailure(error),
    }) ?? null

    task?.onProgressUpdate?.((info) => {
      if (settled) {
        return
      }
      const progress = typeof info?.progress === 'number' && Number.isFinite(info.progress) ? info.progress : 0
      if (progress >= 0) {
        onProgress(Math.min(99, Math.max(0, Math.round(progress))))
      }
    })
    task?.onHeadersReceived?.((info) => {
      if (settled) {
        return
      }
      if (info?.header && typeof info.header === 'object') {
        responseHeaders = info.header
      }
    })

    if (controller.signal.aborted) {
      abortListener()
      return
    }

    controller.signal.addEventListener('abort', abortListener, { once: true })
  })
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

async function downloadAssetBlobViaUniRequestWithResponse(
  uniApi: { request?: (options: {
    url: string
    method?: string
    header?: Record<string, string>
    responseType?: 'arraybuffer'
    success: (payload: { statusCode?: number; data?: unknown; header?: Record<string, string> }) => void
    fail: (error: unknown) => void
  }) => { abort?: () => void } | void },
  url: string,
  controller: AbortController,
  onProgress: (value: number) => void,
  requestHeaders?: Record<string, string>,
): Promise<AssetBlobDownloadResult> {
  return await new Promise<AssetBlobDownloadResult>((resolve, reject) => {
    const task = uniApi.request?.({
      url,
      method: 'GET',
      header: normalizeRequestHeaders(requestHeaders),
      responseType: 'arraybuffer',
      success: (payload) => {
        const statusCode = payload.statusCode ?? 200
        const responseHeaders = normalizeResponseHeaders(payload.header)
        if (statusCode === 304) {
          resolve({
            kind: 'not-modified',
            statusCode: 304,
            url,
            headers: responseHeaders,
          })
          return
        }
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`资源下载失败（${statusCode}）`))
          return
        }
        const mimeType = responseHeaders['content-type'] ?? null
        const filename = extractFilenameFromResponseHeader(responseHeaders, url)
        const arrayBuffer = toArrayBuffer(payload.data)
        onProgress(100)
        resolve({
          kind: 'downloaded',
          statusCode,
          url,
          blob: new Blob([arrayBuffer], { type: mimeType ?? 'application/octet-stream' }),
          mimeType,
          filename,
          headers: responseHeaders,
        })
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

function normalizeRequestHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined
  }
  const normalized: Record<string, string> = {}
  Object.entries(headers).forEach(([key, value]) => {
    const normalizedKey = typeof key === 'string' ? key.trim() : ''
    const normalizedValue = typeof value === 'string' ? value.trim() : ''
    if (!normalizedKey || !normalizedValue) {
      return
    }
    normalized[normalizedKey] = normalizedValue
  })
  return Object.keys(normalized).length ? normalized : undefined
}

function normalizeResponseHeaders(headers?: Record<string, string> | null): Record<string, string> {
  const normalized: Record<string, string> = {}
  if (!headers || typeof headers !== 'object') {
    return normalized
  }
  Object.entries(headers).forEach(([key, value]) => {
    const normalizedKey = typeof key === 'string' ? key.trim().toLowerCase() : ''
    const normalizedValue = typeof value === 'string' ? value.trim() : ''
    if (!normalizedKey || !normalizedValue) {
      return
    }
    normalized[normalizedKey] = normalizedValue
  })
  return normalized
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalizedKey = key.trim().toLowerCase()
    const normalizedValue = value.trim()
    if (!normalizedKey || !normalizedValue) {
      return
    }
    out[normalizedKey] = normalizedValue
  })
  return out
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
      downloadFile?: (options: {
        url: string
        header?: Record<string, string>
        success: (payload: UniDownloadFilePayload) => void
        fail: (error: unknown) => void
      }) => UniDownloadFileTask | void
      getSystemInfoSync?: () => { uniPlatform?: string }
      getFileSystemManager?: () => UniReadFileFs | null | undefined
    }
  | undefined

declare const wx:
  | {
      getFileSystemManager?: () => UniReadFileFs | null | undefined
    }
  | undefined
