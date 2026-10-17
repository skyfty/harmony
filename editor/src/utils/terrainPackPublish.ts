import type { SceneAssetRegistryEntry } from '@schema/core'
import { resolveServerAssetDownloadUrl } from '@schema/core'
import { readTerrainPackAssetMetadata } from '@schema/terrainPack'
import { readServerDownloadBaseUrl } from '@/api/serverApiConfig'
import type { ProjectAsset } from '@/types/project-asset'

/**
 * Geometry terrain packs (`scene.glb` + sibling `textures/*`) must stay
 * URL-sourced at runtime: `terrainTextureStream` resolves texture paths relative
 * to the GLB's download URL, which embedding into the scene package would break
 * (embedded assets move to a hashed `resources/<hash>.glb` path).
 */

export function isTerrainGeometryPackAsset(asset: ProjectAsset | null | undefined): boolean {
  const metadata = readTerrainPackAssetMetadata(asset?.metadata?.terrainPack)
  return metadata?.kind === 'geometry'
}

/** Geometry packs stay server-sourced, so they must never be embedded. */
export function shouldSkipTerrainPackEmbedding(asset: ProjectAsset | null | undefined): boolean {
  const kind = readTerrainPackAssetMetadata(asset?.metadata?.terrainPack)?.kind
  return kind === 'geometry' || kind === 'dem'
}

export function resolveTerrainPackExternalAssetUrl(asset: ProjectAsset | null | undefined): string | null {
  if (!asset) {
    return null
  }
  const candidate = typeof asset.downloadUrl === 'string' && asset.downloadUrl.trim()
    ? asset.downloadUrl.trim()
    : typeof asset.description === 'string' && /^https?:\/\//i.test(asset.description.trim())
      ? asset.description.trim()
      : null
  return resolveServerAssetDownloadUrl({
    assetBaseUrl: readServerDownloadBaseUrl(),
    fileKey: asset.fileKey ?? null,
    downloadUrl: candidate,
  }) ?? candidate
}

export function buildTerrainPackExternalRegistryEntry(
  entry: SceneAssetRegistryEntry | undefined,
  url: string,
): SceneAssetRegistryEntry {
  const assetType = entry?.assetType ?? (entry?.sourceType === 'package' ? entry.assetType : undefined)
  const name = entry?.name ?? (entry?.sourceType === 'package' ? entry.name : undefined)
  return {
    sourceType: 'url',
    url,
    ...(entry?.bytes !== undefined ? { bytes: entry.bytes } : {}),
    ...(assetType ? { assetType } : {}),
    ...(name ? { name } : {}),
  }
}

export type TerrainPackRegistryDocumentLike = {
  assetCatalog?: Record<string, ProjectAsset[]> | null
  assetRegistry?: Record<string, SceneAssetRegistryEntry> | null
}

function findCatalogAsset(
  catalog: Record<string, ProjectAsset[]> | null | undefined,
  assetId: string,
): ProjectAsset | null {
  if (!catalog) {
    return null
  }
  for (const assets of Object.values(catalog)) {
    const found = assets?.find((asset) => asset?.id === assetId)
    if (found) {
      return found
    }
  }
  return null
}

/**
 * Rewrites terrain-pack registry entries of a scene document to their server
 * URL so the published scene keeps resolving `textures/*` next to `scene.glb`.
 */
export function applyTerrainPackExternalRegistryEntries(document: TerrainPackRegistryDocumentLike): number {
  const registry = document.assetRegistry
  if (!registry) {
    return 0
  }
  let patched = 0
  Object.entries(registry).forEach(([assetId, entry]) => {
    const asset = findCatalogAsset(document.assetCatalog, assetId)
    if (!shouldSkipTerrainPackEmbedding(asset)) {
      return
    }
    const url = resolveTerrainPackExternalAssetUrl(asset)
    if (!url) {
      return
    }
    registry[assetId] = buildTerrainPackExternalRegistryEntry(entry, url)
    patched += 1
  })
  return patched
}
