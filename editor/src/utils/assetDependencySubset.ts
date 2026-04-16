import {
  isConfigAssetExtension as isSchemaConfigAssetExtension,
  isEditorOnlyConfigAssetExtension,
  normalizeExtension,
  type SceneAssetRegistryEntry,
} from '@schema'
import type { ProjectAsset } from '@/types/project-asset'

export type AssetDependencySubset = {
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
}

type ProjectAssetLike = Pick<ProjectAsset, 'id' | 'type' | 'extension' | 'description' | 'isEditorOnly'>

type RuntimeExportFilterOptions = {
  assetId?: string | null | undefined
  retainedConfigAssetIds?: ReadonlySet<string> | null | undefined
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
  return isSchemaConfigAssetExtension(extension)
}

function inferAssetExtensionFromFilename(filename: string | null | undefined): string {
  const raw = typeof filename === 'string' ? filename.trim() : ''
  if (!raw) {
    return ''
  }
  const dotIndex = raw.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex >= raw.length - 1) {
    return ''
  }
  return normalizeExtension(raw.slice(dotIndex + 1)) ?? ''
}

export function resolveProjectAssetExtension(asset: Pick<ProjectAsset, 'extension' | 'description'> | null | undefined): string {
  const explicitExtension = normalizeExtension(asset?.extension) ?? ''
  if (explicitExtension) {
    return explicitExtension
  }
  return inferAssetExtensionFromFilename(asset?.description)
}

export type ConfigAssetKind = 'prefab' | 'config'

export function resolveProjectAssetConfigKind(asset: ProjectAssetLike | null | undefined): ConfigAssetKind | null {
  if (!asset) {
    return null
  }
  if (asset.type === 'lod') {
    return 'config'
  }
  const extension = resolveProjectAssetExtension(asset)
  if (extension === 'prefab') {
    return 'prefab'
  }
  if (isConfigAssetExtension(extension)) {
    return 'config'
  }
  if (asset.type === 'prefab' && !extension) {
    return 'prefab'
  }
  return null
}

export function isEditorConfigAsset(asset: ProjectAssetLike | null | undefined): boolean {
  const extension = resolveProjectAssetExtension(asset)
  if (extension) {
    return isEditorOnlyConfigAssetExtension(extension)
  }
  return resolveProjectAssetConfigKind(asset) === 'prefab'
}

export function shouldAssetDefaultToEditorOnly(asset: ProjectAssetLike | null | undefined): boolean {
  return isEditorConfigAsset(asset)
}

function shouldRetainConfigAssetForRuntimeExport(
  asset: ProjectAssetLike | null | undefined,
  options: RuntimeExportFilterOptions = {},
): boolean {
  const retainedConfigAssetIds = options.retainedConfigAssetIds
  if (!retainedConfigAssetIds || retainedConfigAssetIds.size === 0) {
    return false
  }
  const normalizedAssetId = typeof options.assetId === 'string' && options.assetId.trim().length
    ? options.assetId.trim()
    : typeof asset?.id === 'string' && asset.id.trim().length
      ? asset.id.trim()
      : ''
  return normalizedAssetId.length > 0 && retainedConfigAssetIds.has(normalizedAssetId)
}

export function shouldExcludeAssetFromRuntimeExport(
  asset: ProjectAssetLike | null | undefined,
  options: RuntimeExportFilterOptions = {},
): boolean {
  if (!asset) {
    return false
  }
  if (shouldRetainConfigAssetForRuntimeExport(asset, options)) {
    return false
  }
  return asset.isEditorOnly === true || isEditorConfigAsset(asset)
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

  // Special handling for .lod files: extract from props.levels[*] and assetRefs[*]
  if (value && typeof value === 'object') {
    // Try to detect LodPresetData shape
    const obj = value as Record<string, any>
    // props.levels[*].modelAssetId / billboardAssetId
    if (obj.props && Array.isArray(obj.props.levels)) {
      for (const level of obj.props.levels) {
        if (level && typeof level === 'object') {
          if (typeof level.modelAssetId === 'string' && level.modelAssetId.trim()) {
            bucket.add(level.modelAssetId.trim())
          }
          if (typeof level.billboardAssetId === 'string' && level.billboardAssetId.trim()) {
            bucket.add(level.billboardAssetId.trim())
          }
        }
      }
    }
    // assetRefs[*].assetId
    if (Array.isArray(obj.assetRefs)) {
      for (const ref of obj.assetRefs) {
        if (ref && typeof ref === 'object' && typeof ref.assetId === 'string' && ref.assetId.trim()) {
          bucket.add(ref.assetId.trim())
        }
      }
    }
  }

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