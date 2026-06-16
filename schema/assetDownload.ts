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

type AssetDownloadRuntimeState = {
  assetBlobDownloader: AssetBlobDownloader | null
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
      assetBlobDownloader: null,
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
  const state = getAssetDownloadRuntimeState()
  state.assetBlobDownloader = downloader
  console.info('[harmony-schema][asset-download] configured downloader', {
    moduleTag: state.assetDownloadModuleTag,
    hasDownloader: Boolean(downloader),
  })
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
  const state = getAssetDownloadRuntimeState()
  const candidates = createDownloadUrlCandidates(url)
  if (!candidates.length) {
    throw new Error('资源下载失败（无效的下载地址）')
  }
  const fallbackUrl = candidates[0] ?? url

  if (controller.signal.aborted) {
    throw createAbortError()
  }

  if (!state.assetBlobDownloader) {
    console.warn('[harmony-schema][asset-download] downloader missing on fetch', {
      moduleTag: state.assetDownloadModuleTag,
      candidateCount: candidates.length,
      fallbackUrl,
    })
    throw new AssetDownloadWorkerUnavailableError('资源下载 Worker 未配置')
  }

  console.info('[harmony-schema][asset-download] using worker downloader', {
    moduleTag: state.assetDownloadModuleTag,
    candidateCount: candidates.length,
    fallbackUrl,
  })
  return await state.assetBlobDownloader(candidates, controller, onProgress)
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
