import type { ProjectAsset } from '@/types/project-asset'
import { resolveServerAssetDownloadUrl } from '@schema/core'
import { readServerDownloadBaseUrl } from '@/api/serverApiConfig'
import { ensureExtension, extractExtension } from '@/utils/blob'

/**
 * Minimal surface of the asset cache store required to materialize an asset file.
 * Keeps this module decoupled from the Pinia store implementation.
 */
export interface AssetExportCacheStore {
  createFileFromCache: (assetId: string) => File | null
  restoreAssetEntry: (
    assetId: string,
    options?: { contentHash?: string | null; contentHashAlgorithm?: string | null },
  ) => Promise<unknown>
  downloadAsset: (
    assetId: string,
    downloadUrl: string,
    name: string,
    options?: {
      force?: boolean
      expectedServerUpdatedAt?: string | null
      contentHash?: string | null
      contentHashAlgorithm?: string | null
    },
  ) => Promise<AssetExportCacheEntryLike>
}

export interface AssetExportCacheEntryLike {
  status?: string
  error?: string | null
}

export interface AssetExportResult {
  fileName: string
  byteLength: number
}

export interface AssetExportOptions {
  asset: ProjectAsset
  cacheId: string
  assetCacheStore: AssetExportCacheStore
}

const REMOTE_URL_PATTERN = /^(https?:\/\/|data:|blob:)/i
const HTTP_URL_PATTERN = /^https?:\/\//i
const ILLEGAL_FILENAME_PATTERN = /[\\/:*?"<>|]/g

function normalizeRemoteCandidate(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) {
    return null
  }
  return REMOTE_URL_PATTERN.test(trimmed) ? trimmed : null
}

/**
 * Resolves a browser-fetchable URL for the asset. Pseudo urls such as
 * `material://<id>.material` or bare asset ids are intentionally rejected so
 * callers never issue a bogus request.
 */
export function resolveAssetExportRemoteUrl(asset: ProjectAsset | null | undefined): string | null {
  if (!asset) {
    return null
  }

  const candidates = [normalizeRemoteCandidate(asset.downloadUrl), normalizeRemoteCandidate(asset.description)]
  const httpCandidate = candidates.find((candidate): candidate is string => !!candidate && HTTP_URL_PATTERN.test(candidate))
  if (httpCandidate) {
    return resolveServerAssetDownloadUrl({
      assetBaseUrl: readServerDownloadBaseUrl(),
      fileKey: asset.fileKey ?? null,
      downloadUrl: httpCandidate,
    }) ?? httpCandidate
  }

  const inlineCandidate = candidates.find((candidate): candidate is string => !!candidate)
  if (inlineCandidate) {
    return inlineCandidate
  }

  if (!asset.fileKey) {
    return null
  }

  return resolveServerAssetDownloadUrl({
    assetBaseUrl: readServerDownloadBaseUrl(),
    fileKey: asset.fileKey,
  })
}

export function sanitizeAssetExportFileName(value: string): string {
  const cleaned = value
    .replace(ILLEGAL_FILENAME_PATTERN, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length ? cleaned : 'asset'
}

/**
 * Prefers the original/cached file name, then the asset name, then the asset id.
 */
export function buildAssetExportFileName(asset: ProjectAsset, fileNameHint?: string | null): string {
  const hint = typeof fileNameHint === 'string' ? fileNameHint.trim() : ''
  const assetName = typeof asset.name === 'string' ? asset.name.trim() : ''
  const base = hint || assetName || asset.id
  let fileName = sanitizeAssetExportFileName(base)

  if (!extractExtension(fileName)) {
    const extension = typeof asset.extension === 'string' ? asset.extension.trim().replace(/^\./, '') : ''
    if (extension.length) {
      fileName = ensureExtension(fileName, extension)
    }
  }

  return fileName
}

export function downloadBlobToBrowser(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('当前环境不支持浏览器下载')
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.style.display = 'none'
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  const revoke = () => URL.revokeObjectURL(url)
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(revoke)
  } else {
    setTimeout(revoke, 0)
  }
}

/**
 * Materializes the asset file (local cache first, remote download as fallback)
 * and hands it to the browser download flow.
 */
export async function exportProjectAssetFile(options: AssetExportOptions): Promise<AssetExportResult> {
  const { asset, assetCacheStore } = options
  const cacheId = typeof options.cacheId === 'string' && options.cacheId.trim().length
    ? options.cacheId.trim()
    : asset.id
  const contentHash = asset.contentHash ?? null
  const contentHashAlgorithm = asset.contentHashAlgorithm ?? null

  let file = assetCacheStore.createFileFromCache(cacheId)
  if (!file) {
    await assetCacheStore.restoreAssetEntry(cacheId, { contentHash, contentHashAlgorithm })
    file = assetCacheStore.createFileFromCache(cacheId)
  }

  let downloadErrorMessage: string | null = null
  if (!file) {
    const remoteUrl = resolveAssetExportRemoteUrl(asset)
    if (remoteUrl) {
      const entry = await assetCacheStore.downloadAsset(cacheId, remoteUrl, asset.name, {
        expectedServerUpdatedAt: typeof asset.updatedAt === 'string' ? asset.updatedAt : null,
        contentHash,
        contentHashAlgorithm,
      })
      file = assetCacheStore.createFileFromCache(cacheId)
      if (!file && typeof entry?.error === 'string' && entry.error.trim().length) {
        downloadErrorMessage = entry.error.trim()
      }
    }
  }

  if (!file) {
    throw new Error(downloadErrorMessage ?? `“${asset.name}”的文件不在本地缓存中，无法下载`)
  }

  const fileName = buildAssetExportFileName(asset, file.name)
  downloadBlobToBrowser(file, fileName)
  return { fileName, byteLength: file.size }
}
