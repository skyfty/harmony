import {
  ASSET_BUNDLE_FORMAT,
  ASSET_BUNDLE_HASH_ALGORITHM,
  ASSET_BUNDLE_MANIFEST_FILENAME,
  ASSET_BUNDLE_VERSION,
  type AssetBundleFileEntry,
  type AssetBundleManifest,
} from '@schema'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'
import { zipSync, strToU8 } from 'fflate'
import type { ProjectAsset } from '@/types/project-asset'
import { computeBlobHash, ensureExtension, extractExtension } from '@/utils/blob'

export interface AssetBundleDependencyInput {
  asset: ProjectAsset
  file: File
  rewriteTarget?: boolean
}

export interface BuildAssetBundleOptions {
  primaryAsset: ProjectAsset
  primaryFile: File
  thumbnailFile?: File | null
  dependencies?: AssetBundleDependencyInput[]
  name?: string
  description?: string | null
  categoryId?: string | null
  categoryPathSegments?: string[]
  tagIds?: string[]
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  imageWidth?: number | null
  imageHeight?: number | null
  terrainScatterPreset?: TerrainScatterCategory | null
  metadata?: Record<string, unknown> | null
  rewriteReferences?: boolean
  bundleId?: string
}

export interface BuiltAssetBundle {
  manifest: AssetBundleManifest
  file: File
}

function normalizePathSegment(value: string, fallback: string): string {
  const trimmed = value.trim()
  const normalized = trimmed.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ')
  return normalized.length ? normalized : fallback
}

function normalizeFilename(value: string, fallback: string, extension?: string | null): string {
  const base = normalizePathSegment(value, fallback)
  return ensureExtension(base, extension ?? extractExtension(base) ?? null)
}

function createBundleId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `bundle-${Date.now().toString(36)}`
}

async function createFileEntry(options: {
  logicalId: string
  path: string
  filename: string
  role: AssetBundleFileEntry['role']
  file: File
  assetType?: ProjectAsset['type']
  sourceLocalAssetId?: string | null
  rewriteTarget?: boolean
}): Promise<AssetBundleFileEntry> {
  return {
    logicalId: options.logicalId,
    path: options.path,
    filename: options.filename,
    role: options.role,
    assetType: options.assetType === 'behavior' ? 'file' : options.assetType,
    sourceLocalAssetId: options.sourceLocalAssetId ?? null,
    mimeType: options.file.type || null,
    extension: extractExtension(options.filename) ?? null,
    hash: await computeBlobHash(options.file),
    hashAlgorithm: ASSET_BUNDLE_HASH_ALGORITHM,
    size: options.file.size,
    rewriteTarget: options.rewriteTarget ?? false,
  }
}

function buildMetadataSidecar(options: BuildAssetBundleOptions, primaryFileHash: string): File {
  const payload = {
    format: 'harmony-asset-metadata',
    version: 1,
    createdAt: new Date().toISOString(),
    sourceLocalAssetId: options.primaryAsset.id,
    contentHash: primaryFileHash,
    contentHashAlgorithm: ASSET_BUNDLE_HASH_ALGORITHM,
    asset: {
      id: options.primaryAsset.id,
      name: options.name ?? options.primaryAsset.name,
      type: options.primaryAsset.type === 'behavior' ? 'file' : options.primaryAsset.type,
      extension: options.primaryAsset.extension ?? extractExtension(options.primaryFile.name) ?? null,
    },
    metadata: options.metadata ?? null,
  }
  const fileName = normalizeFilename(`${options.name ?? options.primaryAsset.name}.asset.json`, 'asset.asset.json', 'json')
  return new File([JSON.stringify(payload, null, 2)], fileName, { type: 'application/json' })
}

export async function buildAssetBundle(options: BuildAssetBundleOptions): Promise<BuiltAssetBundle> {
  const bundleId = options.bundleId?.trim().length ? options.bundleId.trim() : createBundleId()
  const primaryName = options.name?.trim().length ? options.name.trim() : options.primaryAsset.name
  const primaryFilename = normalizeFilename(
    options.primaryFile.name || primaryName,
    primaryName || 'asset',
    options.primaryAsset.extension ?? extractExtension(options.primaryFile.name) ?? null,
  )
  const primaryLogicalId = 'primary'
  const primaryPath = `assets/primary/${primaryFilename}`
  const primaryHash = await computeBlobHash(options.primaryFile)
  const files: Record<string, Uint8Array> = {
    [primaryPath]: new Uint8Array(await options.primaryFile.arrayBuffer()),
  }

  const fileEntries: AssetBundleFileEntry[] = [
    {
      logicalId: primaryLogicalId,
      path: primaryPath,
      filename: primaryFilename,
      role: 'primary',
      assetType: options.primaryAsset.type === 'behavior' ? 'file' : options.primaryAsset.type,
      sourceLocalAssetId: options.primaryAsset.id,
      mimeType: options.primaryFile.type || null,
      extension: extractExtension(primaryFilename) ?? null,
      hash: primaryHash,
      hashAlgorithm: ASSET_BUNDLE_HASH_ALGORITHM,
      size: options.primaryFile.size,
      rewriteTarget: options.rewriteReferences ?? false,
    },
  ]

  let thumbnailLogicalId: string | null = null
  if (options.thumbnailFile) {
    const thumbnailFilename = normalizeFilename(options.thumbnailFile.name || `${primaryName}-thumbnail.png`, `${primaryName}-thumbnail`, extractExtension(options.thumbnailFile.name) ?? 'png')
    const thumbnailPath = `assets/thumbnail/${thumbnailFilename}`
    thumbnailLogicalId = 'thumbnail'
    files[thumbnailPath] = new Uint8Array(await options.thumbnailFile.arrayBuffer())
    fileEntries.push(await createFileEntry({
      logicalId: thumbnailLogicalId,
      path: thumbnailPath,
      filename: thumbnailFilename,
      role: 'thumbnail',
      file: options.thumbnailFile,
      sourceLocalAssetId: options.primaryAsset.id,
    }))
  }

  const metadataFile = buildMetadataSidecar(options, primaryHash)
  const metadataLogicalId = 'metadata'
  const metadataPath = `assets/metadata/${metadataFile.name}`
  files[metadataPath] = new Uint8Array(await metadataFile.arrayBuffer())
  fileEntries.push(await createFileEntry({
    logicalId: metadataLogicalId,
    path: metadataPath,
    filename: metadataFile.name,
    role: 'metadata',
    file: metadataFile,
    sourceLocalAssetId: options.primaryAsset.id,
  }))

  const dependencyLogicalIds: string[] = []
  const seenDependencyIds = new Set<string>()
  for (const [index, dependency] of (options.dependencies ?? []).entries()) {
    const dependencyAssetId = dependency.asset.id.trim()
    if (!dependencyAssetId.length || seenDependencyIds.has(dependencyAssetId)) {
      continue
    }
    seenDependencyIds.add(dependencyAssetId)
    const logicalId = `dependency-${index + 1}`
    const dependencyFilename = normalizeFilename(
      dependency.file.name || dependency.asset.name,
      dependency.asset.name || dependencyAssetId,
      dependency.asset.extension ?? extractExtension(dependency.file.name) ?? null,
    )
    const dependencyPath = `assets/dependencies/${dependencyAssetId}-${dependencyFilename}`
    files[dependencyPath] = new Uint8Array(await dependency.file.arrayBuffer())
    fileEntries.push(await createFileEntry({
      logicalId,
      path: dependencyPath,
      filename: dependencyFilename,
      role: 'dependency',
      file: dependency.file,
      assetType: dependency.asset.type,
      sourceLocalAssetId: dependencyAssetId,
      rewriteTarget: dependency.rewriteTarget ?? false,
    }))
    dependencyLogicalIds.push(logicalId)
  }

  const manifest: AssetBundleManifest = {
    format: ASSET_BUNDLE_FORMAT,
    version: ASSET_BUNDLE_VERSION,
    bundleId,
    createdAt: new Date().toISOString(),
    primaryAsset: {
      logicalId: primaryLogicalId,
      sourceLocalAssetId: options.primaryAsset.id,
      name: primaryName,
      type: options.primaryAsset.type === 'behavior' ? 'file' : options.primaryAsset.type,
      extension: options.primaryAsset.extension ?? extractExtension(primaryFilename) ?? null,
      description: options.description ?? null,
      thumbnailLogicalId,
      metadataLogicalId,
      dependencyLogicalIds,
      categoryId: options.categoryId ?? null,
      categoryPathSegments: (options.categoryPathSegments ?? []).filter((segment) => typeof segment === 'string' && segment.trim().length > 0),
      tagIds: (options.tagIds ?? []).filter((tagId) => typeof tagId === 'string' && tagId.trim().length > 0),
      color: options.color ?? null,
      dimensionLength: options.dimensionLength ?? null,
      dimensionWidth: options.dimensionWidth ?? null,
      dimensionHeight: options.dimensionHeight ?? null,
      imageWidth: options.imageWidth ?? null,
      imageHeight: options.imageHeight ?? null,
      terrainScatterPreset: options.terrainScatterPreset ?? null,
      metadata: options.metadata ?? null,
      rewriteReferences: options.rewriteReferences ?? false,
    },
    files: fileEntries,
  }

  files[ASSET_BUNDLE_MANIFEST_FILENAME] = strToU8(JSON.stringify(manifest, null, 2))
  const archive = zipSync(files, { level: 6 })
  const bundleFileName = normalizeFilename(`${primaryName || 'asset'}-${bundleId}.zip`, `asset-${bundleId}`, 'zip')
  const archiveBuffer = new ArrayBuffer(archive.byteLength)
  new Uint8Array(archiveBuffer).set(archive)

  return {
    manifest,
    file: new File([archiveBuffer], bundleFileName, { type: 'application/zip' }),
  }
}
