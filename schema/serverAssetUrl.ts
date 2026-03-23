import { tryParseUrl } from './urlString'

export type ResolveServerAssetDownloadUrlOptions = {
  assetBaseUrl?: string | null
  fileKey?: string | null
  resolvedUrl?: string | null
  downloadUrl?: string | null
  url?: string | null
}

function normalizeAbsoluteUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return null
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const normalized = normalizeAbsoluteUrl(value)
  if (!normalized) {
    return null
  }
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function normalizeFileKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim().replace(/\\+/g, '/').replace(/^\/+/, '')
  return trimmed.length ? trimmed : null
}

function splitPathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function findLastSubsequenceIndex(haystack: string[], needle: string[]): number {
  if (!needle.length || haystack.length < needle.length) {
    return -1
  }
  for (let index = haystack.length - needle.length; index >= 0; index -= 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) {
      return index
    }
  }
  return -1
}

function extractRelativeAssetPathFromPath(pathname: string, basePathname: string): string | null {
  const candidateSegments = splitPathSegments(pathname)
  if (!candidateSegments.length) {
    return null
  }

  const baseSegments = splitPathSegments(basePathname)
  if (baseSegments.length) {
    const exactIndex = findLastSubsequenceIndex(candidateSegments, baseSegments)
    if (exactIndex >= 0) {
      const relativeSegments = candidateSegments.slice(exactIndex + baseSegments.length)
      return relativeSegments.length ? relativeSegments.join('/') : null
    }

    const baseLeaf = baseSegments[baseSegments.length - 1]
    if (baseLeaf) {
      const leafIndex = candidateSegments.lastIndexOf(baseLeaf)
      if (leafIndex >= 0 && leafIndex < candidateSegments.length - 1) {
        return candidateSegments.slice(leafIndex + 1).join('/')
      }
    }
  }

  const uploadsIndex = candidateSegments.lastIndexOf('uploads')
  if (uploadsIndex >= 0 && uploadsIndex < candidateSegments.length - 1) {
    return candidateSegments.slice(uploadsIndex + 1).join('/')
  }

  return null
}

export function buildAssetFileUrl(assetBaseUrl: string | null | undefined, fileKey: string | null | undefined): string | null {
  const normalizedBase = normalizeBaseUrl(assetBaseUrl)
  const normalizedFileKey = normalizeFileKey(fileKey)
  if (!normalizedBase || !normalizedFileKey) {
    return null
  }
  return `${normalizedBase}/${normalizedFileKey}`
}

export function rewriteServerAssetUrlToBase(url: string | null | undefined, assetBaseUrl: string | null | undefined): string | null {
  const normalizedBase = normalizeBaseUrl(assetBaseUrl)
  const normalizedUrl = normalizeAbsoluteUrl(url)
  if (!normalizedBase || !normalizedUrl) {
    return normalizedUrl
  }

  const parsedBase = tryParseUrl(normalizedBase)
  const parsedUrl = tryParseUrl(normalizedUrl)
  if (!parsedBase || !parsedUrl) {
    return normalizedUrl
  }

  const relativePath = extractRelativeAssetPathFromPath(parsedUrl.pathname, parsedBase.pathname)
  if (!relativePath) {
    return normalizedUrl
  }

  return buildAssetFileUrl(normalizedBase, relativePath) ?? normalizedUrl
}

export function resolveServerAssetDownloadUrl(options: ResolveServerAssetDownloadUrlOptions): string | null {
  const normalizedBase = normalizeBaseUrl(options.assetBaseUrl)
  const directUrl = [options.resolvedUrl, options.downloadUrl, options.url]
    .map((candidate) => rewriteServerAssetUrlToBase(candidate, normalizedBase))
    .find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? null

  if (directUrl) {
    return directUrl
  }

  const fromFileKey = buildAssetFileUrl(normalizedBase, options.fileKey)
  if (fromFileKey) {
    return fromFileKey
  }

  return null
}