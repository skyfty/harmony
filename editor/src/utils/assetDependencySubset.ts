import type { AssetIndexEntry, SceneAssetRegistryEntry } from '@schema'

type AssetLike = {
  type?: string | null
  name?: string | null
  downloadUrl?: string | null
}

export type AssetDependencySubset = {
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
  assetIndex?: Record<string, AssetIndexEntry>
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
    const resolvedUrl = typeof value.resolvedUrl === 'string'
      ? value.resolvedUrl.trim() || null
      : value.resolvedUrl === null
        ? null
        : undefined
    return {
      sourceType: 'server',
      serverAssetId,
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

export function extractAssetIdFromPackageMapKey(key: string): string | null {
  if (!key) {
    return null
  }
  if (key.startsWith('local::')) {
    const embeddedId = key.slice('local::'.length).trim()
    return embeddedId || null
  }
  if (key.startsWith('url::')) {
    const remoteId = key.slice('url::'.length).trim()
    return remoteId || null
  }
  const separatorIndex = key.indexOf('::')
  if (separatorIndex >= 0 && separatorIndex < key.length - 2) {
    const suffix = key.slice(separatorIndex + 2).trim()
    return suffix || null
  }
  return null
}

export function isConfigAssetExtension(extension: string | null | undefined): boolean {
  const normalized = typeof extension === 'string' ? extension.trim().toLowerCase() : ''
  return ['json', 'prefab', 'wall', 'floor', 'material'].includes(normalized)
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
    if (parentKey === 'assetIndex' || parentKey === 'assetRegistry') {
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

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }
  if (/^(?:https?:|data:|blob:)/i.test(trimmed)) {
    return trimmed
  }
  return null
}

function cloneAssetIndexSubset(source: Record<string, AssetIndexEntry>): Record<string, AssetIndexEntry> | undefined {
  const subset: Record<string, AssetIndexEntry> = {}
  Object.entries(source).forEach(([assetId, entry]) => {
    const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
    if (!normalizedAssetId || !entry || typeof entry.categoryId !== 'string' || !entry.categoryId.trim().length) {
      return
    }
    subset[normalizedAssetId] = {
      categoryId: entry.categoryId,
      source: entry.source ? { ...entry.source } : undefined,
      internal: entry.internal,
      isEditorOnly: entry.isEditorOnly,
    }
  })
  return Object.keys(subset).length ? subset : undefined
}

function buildAssetRegistryEntryFromLegacy(
  assetId: string,
  indexEntry: AssetIndexEntry | undefined,
  asset: AssetLike | null | undefined,
): SceneAssetRegistryEntry | null {
  if (indexEntry?.source?.type === 'local') {
    return null
  }

  if (indexEntry?.source?.type === 'url') {
    const resolvedUrl = normalizeHttpUrl(asset?.downloadUrl)
    if (!resolvedUrl) {
      return null
    }
    return {
      sourceType: 'url',
      url: resolvedUrl,
      assetType: (asset?.type ?? undefined) as SceneAssetRegistryEntry['assetType'],
      name: asset?.name ?? undefined,
    }
  }

  return {
    sourceType: 'server',
    serverAssetId:
      indexEntry?.source?.type === 'package' && typeof indexEntry.source.originalAssetId === 'string' && indexEntry.source.originalAssetId.trim().length
        ? indexEntry.source.originalAssetId.trim()
        : assetId,
    resolvedUrl: normalizeHttpUrl(asset?.downloadUrl),
    assetType: (asset?.type ?? undefined) as SceneAssetRegistryEntry['assetType'],
    name: asset?.name ?? undefined,
  }
}

function buildAssetIndexSubsetForIds(
  source: Record<string, AssetIndexEntry>,
  assetIds: string[],
): Record<string, AssetIndexEntry> | undefined {
  const subset: Record<string, AssetIndexEntry> = {}
  assetIds.forEach((assetId) => {
    const entry = source[assetId]
    if (!entry) {
      return
    }
    subset[assetId] = {
      categoryId: entry.categoryId,
      source: entry.source ? { ...entry.source } : undefined,
      internal: entry.internal,
      isEditorOnly: entry.isEditorOnly,
    }
  })
  return Object.keys(subset).length ? subset : undefined
}

export function buildAssetDependencySubset(payload: {
  assetIds: Iterable<string>
  assetRegistry?: Record<string, SceneAssetRegistryEntry> | null
  assetIndex?: Record<string, AssetIndexEntry> | null
  resolveAsset?: (assetId: string) => AssetLike | null | undefined
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
  const assetIndexSource = payload.assetIndex ?? {}
  const assetRegistry: Record<string, SceneAssetRegistryEntry> = {}

  normalizedAssetIds.forEach((assetId) => {
    const existingRegistryEntry = assetRegistrySource[assetId]
    if (existingRegistryEntry) {
      assetRegistry[assetId] = cloneRegistryEntry(existingRegistryEntry)
      return
    }
    const registryEntry = buildAssetRegistryEntryFromLegacy(
      assetId,
      assetIndexSource[assetId],
      payload.resolveAsset?.(assetId) ?? null,
    )
    if (registryEntry) {
      assetRegistry[assetId] = registryEntry
    }
  })

  return {
    assetRegistry: Object.keys(assetRegistry).length ? assetRegistry : undefined,
    assetIndex: buildAssetIndexSubsetForIds(assetIndexSource, normalizedAssetIds),
  }
}

export function cloneAssetDependencySubset(subset: AssetDependencySubset): AssetDependencySubset {
  return {
    assetRegistry: subset.assetRegistry ? cloneSceneAssetRegistrySubset(subset.assetRegistry) : undefined,
    assetIndex: subset.assetIndex ? cloneAssetIndexSubset(subset.assetIndex) : undefined,
  }
}