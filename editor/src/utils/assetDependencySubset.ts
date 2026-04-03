import type { SceneAssetRegistryEntry } from '@schema'

export type AssetDependencySubset = {
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneRegistryEntry(entry: SceneAssetRegistryEntry): SceneAssetRegistryEntry {
  if (entry.sourceType === 'package') {
    return {
      sourceType: 'package',
      zipPath: entry.zipPath,
      inline: entry.inline,
      bytes: entry.bytes,
      assetType: entry.assetType,
      name: entry.name,
    }
  }
  if (entry.sourceType === 'url') {
    return {
      sourceType: 'url',
      url: entry.url,
      bytes: entry.bytes,
      assetType: entry.assetType,
      name: entry.name,
    }
  }
  return {
    sourceType: 'server',
    serverAssetId: entry.serverAssetId,
    fileKey: entry.fileKey,
    resolvedUrl: entry.resolvedUrl,
    bytes: entry.bytes,
    assetType: entry.assetType,
    name: entry.name,
  }
}

function sanitizeSceneAssetRegistryEntry(value: unknown): SceneAssetRegistryEntry | null {
  if (!isPlainObject(value)) {
    return null
  }

  const sourceType = typeof value.sourceType === 'string' ? value.sourceType.trim() : ''
  const bytes = typeof value.bytes === 'number' && Number.isFinite(value.bytes) ? value.bytes : undefined
  const assetType = typeof value.assetType === 'string' && value.assetType.trim().length ? value.assetType.trim() : undefined
  const name = typeof value.name === 'string' && value.name.trim().length ? value.name.trim() : undefined

  if (sourceType === 'package') {
    const zipPath = typeof value.zipPath === 'string' ? value.zipPath.trim() : ''
    if (!zipPath) {
      return null
    }
    const inline = typeof value.inline === 'string' && value.inline.length ? value.inline : undefined
    return {
      sourceType: 'package',
      zipPath,
      inline,
      bytes,
      assetType: assetType as SceneAssetRegistryEntry['assetType'],
      name,
    }
  }

  if (sourceType === 'url') {
    const url = typeof value.url === 'string' ? value.url.trim() : ''
    if (!url) {
      return null
    }
    return {
      sourceType: 'url',
      url,
      bytes,
      assetType: assetType as SceneAssetRegistryEntry['assetType'],
      name,
    }
  }

  if (sourceType === 'server') {
    const serverAssetId = typeof value.serverAssetId === 'string' && value.serverAssetId.trim().length
      ? value.serverAssetId.trim()
      : undefined
    const fileKey = typeof value.fileKey === 'string'
      ? value.fileKey.trim() || null
      : value.fileKey === null
        ? null
        : undefined
    const resolvedUrl = typeof value.resolvedUrl === 'string'
      ? value.resolvedUrl.trim() || null
      : value.resolvedUrl === null
        ? null
        : undefined
    return {
      sourceType: 'server',
      serverAssetId,
      fileKey,
      resolvedUrl,
      bytes,
      assetType: assetType as SceneAssetRegistryEntry['assetType'],
      name,
    }
  }

  return null
}

export function sanitizeSceneAssetRegistry(value: unknown): Record<string, SceneAssetRegistryEntry> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const result: Record<string, SceneAssetRegistryEntry> = {}
  Object.entries(value).forEach(([assetId, entry]) => {
    const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalizedAssetId) {
      return
    }
    const sanitizedEntry = sanitizeSceneAssetRegistryEntry(entry)
    if (!sanitizedEntry) {
      return
    }
    result[normalizedAssetId] = sanitizedEntry
  })
  return Object.keys(result).length ? result : undefined
}

export function isSceneAssetRegistry(value: unknown): value is Record<string, SceneAssetRegistryEntry> {
  return sanitizeSceneAssetRegistry(value) !== undefined
}

export function cloneSceneAssetRegistrySubset(
  source: Record<string, SceneAssetRegistryEntry>,
): Record<string, SceneAssetRegistryEntry> {
  const clone: Record<string, SceneAssetRegistryEntry> = {}
  Object.entries(source).forEach(([assetId, entry]) => {
    const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalizedAssetId || !entry) {
      return
    }
    clone[normalizedAssetId] = cloneRegistryEntry(entry)
  })
  return clone
}

export function isConfigAssetExtension(extension: string | null | undefined): boolean {
  const normalized = typeof extension === 'string' ? extension.trim().toLowerCase() : ''
  return ['json', 'prefab', 'lod', 'wall', 'floor', 'material'].includes(normalized)
}

export function normalizeAssetReferenceCandidate(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.length || trimmed.length > 512) {
    return null
  }
  if (/^(https?:|data:|blob:)/i.test(trimmed)) {
    return null
  }
  if (trimmed.startsWith('asset://')) {
    const id = trimmed.slice('asset://'.length).trim()
    return id.length ? id : null
  }
  if (trimmed.startsWith('local::')) {
    const id = trimmed.slice('local::'.length).trim()
    return id.length ? id : null
  }
  if (trimmed.startsWith('url::')) {
    const id = trimmed.slice('url::'.length).trim()
    return id.length ? id : null
  }
  return trimmed
}

function collectAssetReferencesFromConfigValue(value: unknown, bucket: Set<string>, parentKey = ''): void {
  if (typeof value === 'string') {
    const normalized = normalizeAssetReferenceCandidate(value)
    if (!normalized) {
      return
    }
    if (/assetid|asset_id|asset$/i.test(parentKey) || parentKey === 'id') {
      bucket.add(normalized)
      return
    }
    if (/^[a-z0-9_-]{8,}$/i.test(normalized)) {
      bucket.add(normalized)
    }
    return
  }
  if (!value || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssetReferencesFromConfigValue(entry, bucket, parentKey))
    return
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (parentKey === 'assetRegistry') {
      const normalized = normalizeAssetReferenceCandidate(key)
      if (normalized) {
        bucket.add(normalized)
      }
    }
    collectAssetReferencesFromConfigValue(entry, bucket, key)
  })
}

export function collectConfigAssetDependencyIds(value: unknown): string[] {
  const bucket = new Set<string>()
  collectAssetReferencesFromConfigValue(value, bucket)
  return Array.from(bucket)
}

export function resolveConfigAssetReferenceId(
  reference: string,
  options: {
    assetRegistry?: Record<string, SceneAssetRegistryEntry> | null
    hasAssetId?: (assetId: string) => boolean
  } = {},
): string | null {
  const normalizedReference = typeof reference === 'string' ? reference.trim() : ''
  if (!normalizedReference.length) {
    return null
  }

  const normalizedCandidate = normalizeAssetReferenceCandidate(normalizedReference)
  const candidates = [normalizedReference, normalizedCandidate]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  if (options.hasAssetId) {
    for (const candidate of candidates) {
      if (options.hasAssetId(candidate)) {
        return candidate
      }
    }
  } else if (candidates.length) {
    return candidates[0] ?? null
  }

  const assetRegistry = options.assetRegistry && typeof options.assetRegistry === 'object'
    ? options.assetRegistry
    : null
  if (assetRegistry) {
    for (const candidate of candidates) {
      if (candidate in assetRegistry) {
        return candidate
      }
    }
  }

  return null
}

export function buildAssetDependencySubset(payload: {
  assetIds: Iterable<string>
  assetRegistry?: Record<string, SceneAssetRegistryEntry> | null
}): AssetDependencySubset {
  const normalizedAssetIds = Array.from(
    new Set(
      Array.from(payload.assetIds)
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value): value is string => value.length > 0),
    ),
  )

  if (!normalizedAssetIds.length) {
    return {}
  }

  const assetRegistrySource = payload.assetRegistry ?? {}
  const assetRegistry: Record<string, SceneAssetRegistryEntry> = {}

  normalizedAssetIds.forEach((assetId) => {
    const existingRegistryEntry = assetRegistrySource[assetId]
    if (existingRegistryEntry) {
      assetRegistry[assetId] = cloneRegistryEntry(existingRegistryEntry)
    }
  })

  return {
    assetRegistry: Object.keys(assetRegistry).length ? assetRegistry : undefined,
  }
}

export function cloneAssetDependencySubset(subset: AssetDependencySubset): AssetDependencySubset {
  return {
    assetRegistry: subset.assetRegistry ? cloneSceneAssetRegistrySubset(subset.assetRegistry) : undefined,
  }
}