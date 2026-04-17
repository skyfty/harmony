import type { SceneAssetRegistryEntry } from '@schema'

function normalizeOptionalAssetId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : null
}

function parsePackageOriginalAssetId(zipPath: string | null | undefined): string | null {
  const normalizedZipPath = normalizeOptionalAssetId(zipPath)
  if (!normalizedZipPath) {
    return null
  }
  const separator = normalizedZipPath.indexOf('::')
  if (separator <= 0 || separator >= normalizedZipPath.length - 2) {
    return null
  }
  return normalizeOptionalAssetId(normalizedZipPath.slice(separator + 2))
}

export function buildAssetRegistryAliasMap(
  assetRegistry: Record<string, SceneAssetRegistryEntry> | Record<string, unknown> | null | undefined,
): Map<string, string> {
  const aliases = new Map<string, string>()
  if (!assetRegistry || typeof assetRegistry !== 'object') {
    return aliases
  }

  Object.entries(assetRegistry).forEach(([registryKey, rawEntry]) => {
    const normalizedRegistryKey = normalizeOptionalAssetId(registryKey)
    if (!normalizedRegistryKey || !rawEntry || typeof rawEntry !== 'object') {
      return
    }
    aliases.set(normalizedRegistryKey, normalizedRegistryKey)

    const entry = rawEntry as Partial<SceneAssetRegistryEntry> & Record<string, unknown>
    const serverAssetId = normalizeOptionalAssetId(entry.sourceType === 'server' ? entry.serverAssetId : null)
    if (serverAssetId) {
      aliases.set(serverAssetId, normalizedRegistryKey)
    }

    const originalPackageAssetId = parsePackageOriginalAssetId(entry.sourceType === 'package' ? entry.zipPath : null)
    if (originalPackageAssetId) {
      aliases.set(originalPackageAssetId, normalizedRegistryKey)
    }
  })

  return aliases
}

export function normalizeAssetIdWithRegistry(
  assetId: unknown,
  assetRegistry: Record<string, SceneAssetRegistryEntry> | Record<string, unknown> | null | undefined,
): string | null {
  const normalizedAssetId = normalizeOptionalAssetId(assetId)
  if (!normalizedAssetId) {
    return null
  }
  const aliases = buildAssetRegistryAliasMap(assetRegistry)
  return aliases.get(normalizedAssetId) ?? normalizedAssetId
}

export function normalizeAssetIdsWithRegistry(
  assetIds: Iterable<unknown>,
  assetRegistry: Record<string, SceneAssetRegistryEntry> | Record<string, unknown> | null | undefined,
): string[] {
  const aliases = buildAssetRegistryAliasMap(assetRegistry)
  return Array.from(
    new Set(
      Array.from(assetIds)
        .map((assetId) => {
          const normalizedAssetId = normalizeOptionalAssetId(assetId)
          if (!normalizedAssetId) {
            return null
          }
          return aliases.get(normalizedAssetId) ?? normalizedAssetId
        })
        .filter((assetId): assetId is string => Boolean(assetId)),
    ),
  )
}

export function normalizeMaterialLikeTextureAssetIds<T>(
  value: T,
  assetRegistry: Record<string, SceneAssetRegistryEntry> | Record<string, unknown> | null | undefined,
): T {
  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  const texturesRaw = record.textures
  if (!texturesRaw || typeof texturesRaw !== 'object') {
    return value
  }

  const aliases = buildAssetRegistryAliasMap(assetRegistry)
  let changed = false
  const nextTextures: Record<string, unknown> = { ...(texturesRaw as Record<string, unknown>) }

  Object.entries(texturesRaw as Record<string, unknown>).forEach(([slot, textureRef]) => {
    if (!textureRef || typeof textureRef !== 'object') {
      return
    }
    const refRecord = textureRef as Record<string, unknown>
    const normalizedAssetId = normalizeOptionalAssetId(refRecord.assetId)
    if (!normalizedAssetId) {
      return
    }
    const canonicalAssetId = aliases.get(normalizedAssetId) ?? normalizedAssetId
    if (canonicalAssetId === normalizedAssetId) {
      return
    }
    nextTextures[slot] = {
      ...refRecord,
      assetId: canonicalAssetId,
    }
    changed = true
  })

  if (!changed) {
    return value
  }

  return {
    ...record,
    textures: nextTextures,
  } as T
}