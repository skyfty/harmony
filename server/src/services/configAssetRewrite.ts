import {
  CONFIG_ASSET_EXTENSION_SET,
  type AssetBundleFileEntry,
  type AssetType,
} from '@harmony/schema'

export type PersistedBundleAssetReference = {
  serverAssetId: string
  fileKey: string | null
  resolvedUrl: string | null
  bytes?: number
  assetType?: AssetType
  name?: string
}

export type ConfigAssetRewriteContext = {
  assetIdMap: Map<string, string>
  persistedBundleAssets: Map<string, PersistedBundleAssetReference>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractFilenameExtension(filename: string): string {
  const trimmed = filename.trim()
  if (!trimmed.length) {
    return ''
  }
  const dotIndex = trimmed.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex >= trimmed.length - 1) {
    return ''
  }
  return trimmed.slice(dotIndex + 1).toLowerCase()
}

function rewriteAssetReferenceString(value: string, assetIdMap: Map<string, string>): string {
  const direct = assetIdMap.get(value)
  if (direct) {
    return direct
  }

  const prefixedMatch = /^(asset:\/\/|local::|url::)(.+)$/.exec(value)
  if (prefixedMatch) {
    const mapped = assetIdMap.get(prefixedMatch[2] ?? '')
    return mapped ?? value
  }

  return value
}

function rewriteAssetRegistryEntries(
  assetRegistry: Record<string, unknown>,
  persistedBundleAssets: Map<string, PersistedBundleAssetReference>,
): Record<string, unknown> {
  const nextAssetRegistry: Record<string, unknown> = {}
  for (const [assetId, entryValue] of Object.entries(assetRegistry)) {
    const normalizedAssetId = sanitizeString(assetId)
    const persistedAsset = normalizedAssetId ? persistedBundleAssets.get(normalizedAssetId) : undefined
    if (!persistedAsset) {
      nextAssetRegistry[assetId] = entryValue
      continue
    }

    const existingBytes = typeof entryValue === 'object' && entryValue !== null && typeof (entryValue as Record<string, unknown>).bytes === 'number'
      && Number.isFinite((entryValue as Record<string, unknown>).bytes)
      ? (entryValue as Record<string, unknown>).bytes as number
      : undefined
    const existingAssetType = typeof entryValue === 'object' && entryValue !== null
      ? sanitizeString((entryValue as Record<string, unknown>).assetType)
      : ''
    const existingName = typeof entryValue === 'object' && entryValue !== null
      ? sanitizeString((entryValue as Record<string, unknown>).name)
      : ''

    const nextEntry: Record<string, unknown> = {
      sourceType: 'server',
      serverAssetId: persistedAsset.serverAssetId,
      fileKey: persistedAsset.fileKey ?? null,
      resolvedUrl: persistedAsset.resolvedUrl ?? null,
    }

    if (typeof existingBytes === 'number') {
      nextEntry.bytes = existingBytes
    } else if (typeof persistedAsset.bytes === 'number') {
      nextEntry.bytes = persistedAsset.bytes
    }
    if (existingAssetType) {
      nextEntry.assetType = existingAssetType
    } else if (persistedAsset.assetType) {
      nextEntry.assetType = persistedAsset.assetType
    }
    if (existingName) {
      nextEntry.name = existingName
    } else if (persistedAsset.name) {
      nextEntry.name = persistedAsset.name
    }

    nextAssetRegistry[assetId] = nextEntry
  }
  return nextAssetRegistry
}

function rewriteLodPresetFields(value: unknown, assetIdMap: Map<string, string>): unknown {
  if (!isObjectRecord(value)) {
    return value
  }

  const next: Record<string, unknown> = { ...value }
  const props = value.props
  if (isObjectRecord(props) && Array.isArray(props.levels)) {
    const nextProps = { ...props }
    nextProps.levels = props.levels.map((level) => {
      if (!isObjectRecord(level)) {
        return level
      }
      const nextLevel = { ...level }
      if (typeof level.modelAssetId === 'string') {
        nextLevel.modelAssetId = rewriteAssetReferenceString(level.modelAssetId, assetIdMap)
      }
      if (typeof level.billboardAssetId === 'string') {
        nextLevel.billboardAssetId = rewriteAssetReferenceString(level.billboardAssetId, assetIdMap)
      }
      return nextLevel
    })
    next.props = nextProps
  }

  if (Array.isArray(value.assetRefs)) {
    next.assetRefs = value.assetRefs.map((ref) => {
      if (!isObjectRecord(ref)) {
        return ref
      }
      const nextRef = { ...ref }
      if (typeof ref.assetId === 'string') {
        nextRef.assetId = rewriteAssetReferenceString(ref.assetId, assetIdMap)
      }
      return nextRef
    })
  }

  return next
}

function rewriteConfigAssetJson(
  value: unknown,
  context: ConfigAssetRewriteContext,
  extension: string,
): unknown {
  if (typeof value === 'string') {
    return rewriteAssetReferenceString(value, context.assetIdMap)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewriteConfigAssetJson(entry, context, extension))
  }

  if (!isObjectRecord(value)) {
    return value
  }

  const next: Record<string, unknown> = {}
  for (const [key, entryValue] of Object.entries(value)) {
    if (key === 'assetRegistry' && isObjectRecord(entryValue)) {
      next[key] = rewriteAssetRegistryEntries(entryValue, context.persistedBundleAssets)
      continue
    }
    next[key] = rewriteConfigAssetJson(entryValue, context, extension)
  }

  if (extension === 'lod') {
    return rewriteLodPresetFields(next, context.assetIdMap)
  }

  return next
}

export function rewriteConfigAssetBundleBytes(
  entry: AssetBundleFileEntry,
  bytes: Uint8Array,
  context: ConfigAssetRewriteContext,
): Uint8Array {
  const extension = sanitizeString(entry.extension).toLowerCase() || extractFilenameExtension(entry.filename)
  if (!CONFIG_ASSET_EXTENSION_SET.has(extension) || (!context.assetIdMap.size && !context.persistedBundleAssets.size)) {
    return bytes
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return bytes
  }

  const rewritten = rewriteConfigAssetJson(parsed, context, extension)
  return new TextEncoder().encode(JSON.stringify(rewritten, null, 2))
}

export function rewriteConfigAssetBundleValue<T>(value: T, context: ConfigAssetRewriteContext, extension: string): T {
  return rewriteConfigAssetJson(value, context, extension) as T
}