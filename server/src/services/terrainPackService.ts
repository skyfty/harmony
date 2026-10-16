import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import type { AssetType } from '@harmony/schema/core'
import {
  TERRAIN_DEM_PACKAGE_FILES,
  parseTerrainDemPackageSidecar,
  type TerrainDemPackageSidecar,
} from '@harmony/schema/terrainDemPackage'
import {
  TERRAIN_GEOMETRY_PACK_MANIFEST,
  TERRAIN_PACK_METADATA_VERSION,
  detectTerrainPackKind,
  normalizeTerrainPackPath,
  parseTerrainTextureManifest,
  summarizeTerrainPack,
  type TerrainPackAssetMetadata,
  type TerrainPackDependencyMetadata,
  type TerrainPackDependencyRole,
  type TerrainPackKind,
  type TerrainPackSummary,
} from '@harmony/schema/terrainPack'

/**
 * Parsing/planning half of the admin terrain-pack upload: turns a pack zip into
 * a validated summary plus the exact file list that should be stored (relative
 * paths preserved so runtime texture streaming keeps resolving `textures/*`
 * next to `scene.glb`).
 */

export interface TerrainPackArchiveEntry {
  /** Normalized relative path (forward slashes). */
  path: string
  bytes: Uint8Array
}

export interface ParsedTerrainPackArchive {
  kind: TerrainPackKind
  summary: TerrainPackSummary
  entries: TerrainPackArchiveEntry[]
  entryByPath: Map<string, Uint8Array>
  sidecar: TerrainDemPackageSidecar | null
  sourceZipName: string | null
  sourceZipHash: string
  sourceZipHashAlgorithm: 'sha256'
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function findEntryPath(entries: ReadonlyArray<{ path: string }>, targetName: string): string | null {
  const target = targetName.toLowerCase()
  for (const entry of entries) {
    const base = entry.path.split('/').pop()?.toLowerCase() ?? ''
    if (base === target) {
      return entry.path
    }
  }
  return null
}

export function parseTerrainPackArchive(
  bytes: Uint8Array,
  options: { sourceZipName?: string | null } = {},
): ParsedTerrainPackArchive {
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(bytes)
  } catch {
    throw new Error('无法解压资源包：文件不是有效的 zip 压缩包。')
  }

  const entries: TerrainPackArchiveEntry[] = []
  const entryByPath = new Map<string, Uint8Array>()
  for (const [rawPath, value] of Object.entries(archive)) {
    const path = normalizeTerrainPackPath(rawPath)
    if (!path || !value || value.byteLength <= 0) {
      continue
    }
    entries.push({ path, bytes: value })
    entryByPath.set(path.toLowerCase(), value)
  }
  if (!entries.length) {
    throw new Error('资源包内没有可用文件。')
  }

  const kind = detectTerrainPackKind(entries.map((entry) => entry.path))
  if (!kind) {
    throw new Error(
      `无法识别的资源包（内容：${entries.slice(0, 4).map((entry) => entry.path).join('、')}${entries.length > 4 ? '…' : ''}）`,
    )
  }

  const decoder = new TextDecoder()
  let summary: TerrainPackSummary
  let sidecar: TerrainDemPackageSidecar | null = null

  if (kind === 'geometry') {
    const manifestPath = findEntryPath(entries, TERRAIN_GEOMETRY_PACK_MANIFEST)
    const manifestBytes = manifestPath ? entryByPath.get(manifestPath.toLowerCase()) : null
    if (!manifestPath || !manifestBytes) {
      throw new Error(`资源包缺少 ${TERRAIN_GEOMETRY_PACK_MANIFEST}。`)
    }
    let manifestJson: unknown
    try {
      manifestJson = JSON.parse(decoder.decode(manifestBytes))
    } catch {
      throw new Error(`${TERRAIN_GEOMETRY_PACK_MANIFEST} 不是有效的 JSON。`)
    }
    summary = summarizeTerrainPack(
      entries.map((entry) => ({ path: entry.path, bytes: entry.bytes.byteLength })),
      { manifest: parseTerrainTextureManifest(manifestJson) },
    )
  } else {
    const sidecarPath = findEntryPath(entries, TERRAIN_DEM_PACKAGE_FILES.sidecar)
    const sidecarBytes = sidecarPath ? entryByPath.get(sidecarPath.toLowerCase()) : null
    if (!sidecarPath || !sidecarBytes) {
      throw new Error(`资源包缺少 ${TERRAIN_DEM_PACKAGE_FILES.sidecar}。`)
    }
    let sidecarJson: unknown
    try {
      sidecarJson = JSON.parse(decoder.decode(sidecarBytes))
    } catch {
      throw new Error(`${TERRAIN_DEM_PACKAGE_FILES.sidecar} 不是有效的 JSON。`)
    }
    sidecar = parseTerrainDemPackageSidecar(sidecarJson)
    summary = summarizeTerrainPack(
      entries.map((entry) => ({ path: entry.path, bytes: entry.bytes.byteLength })),
      { sidecar: sidecarJson },
    )
  }

  return {
    kind,
    summary,
    entries,
    entryByPath,
    sidecar,
    sourceZipName: typeof options.sourceZipName === 'string' && options.sourceZipName.trim()
      ? options.sourceZipName.trim()
      : null,
    sourceZipHash: sha256Hex(bytes),
    sourceZipHashAlgorithm: 'sha256',
  }
}

/** Sanitizes the uploaded zip filename for use as a stored file name. */
export function sanitizeTerrainPackZipName(rawName: string | null | undefined, fallback: string): string {
  const trimmed = typeof rawName === 'string' ? rawName.trim() : ''
  const base = trimmed.split(/[\\/]/).pop() ?? ''
  const normalized = base
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.\.+/g, '.')
    .trim()
  if (!normalized) {
    return fallback
  }
  return normalized.toLowerCase().endsWith('.zip') ? normalized : `${normalized}.zip`
}

export function resolveTerrainPackPrimaryAssetType(kind: TerrainPackKind): AssetType {
  return kind === 'geometry' ? 'model' : 'file'
}

export function resolveTerrainPackDependencyRole(
  archive: ParsedTerrainPackArchive,
  path: string,
): { role: TerrainPackDependencyRole; textureId?: string } {
  const lower = path.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  if (archive.kind === 'dem') {
    if (base === TERRAIN_DEM_PACKAGE_FILES.sidecar.toLowerCase()) {
      return { role: 'sidecar' }
    }
    if (base === TERRAIN_DEM_PACKAGE_FILES.dem.toLowerCase() || base === TERRAIN_DEM_PACKAGE_FILES.ortho.toLowerCase()) {
      return { role: 'raster' }
    }
    return { role: 'config' }
  }
  if (base === TERRAIN_GEOMETRY_PACK_MANIFEST.toLowerCase()) {
    return { role: 'config' }
  }
  const texture = archive.summary.textures.find((entry) => {
    return entry.file.toLowerCase() === lower || entry.ktx2File?.toLowerCase() === lower
  })
  if (texture) {
    return base.endsWith('.ktx2')
      ? { role: 'ktx2', textureId: texture.id }
      : { role: 'texture', textureId: texture.id }
  }
  return { role: 'config' }
}

export function resolveTerrainPackDependencyAssetType(path: string, role: TerrainPackDependencyRole): AssetType {
  if (role === 'texture' || role === 'ktx2') {
    return path.toLowerCase().endsWith('.ktx2') ? 'texture' : 'image'
  }
  return 'file'
}

export function buildTerrainPackAssetMetadata(input: {
  archive: ParsedTerrainPackArchive
  packKey: string
}): TerrainPackAssetMetadata {
  const { archive, packKey } = input
  const metadata: TerrainPackAssetMetadata = {
    version: TERRAIN_PACK_METADATA_VERSION,
    kind: archive.kind,
    packKey,
    sourceZipName: archive.sourceZipName,
    sourceZipHash: archive.sourceZipHash,
    sourceZipHashAlgorithm: archive.sourceZipHashAlgorithm,
    files: archive.summary.files,
    totalBytes: archive.summary.totalBytes,
    warnings: archive.summary.warnings,
  }
  if (archive.kind === 'geometry') {
    metadata.glbFile = archive.summary.glbFile
    metadata.manifestFile = archive.summary.manifestFile
    metadata.textures = archive.summary.textures
  } else {
    metadata.sidecarFile = archive.summary.sidecarFile
    metadata.demFile = archive.summary.demFile
    metadata.orthoFile = archive.summary.orthoFile
    if (archive.sidecar) {
      metadata.anchor = {
        latitudeDegrees: archive.sidecar.anchor.latitudeDegrees,
        longitudeDegrees: archive.sidecar.anchor.longitudeDegrees,
        groundElevationMeters: archive.sidecar.anchor.groundElevationMeters,
      }
      metadata.crs = {
        epsg: archive.sidecar.crs.epsg,
        zone: archive.sidecar.crs.zone,
        hemisphere: archive.sidecar.crs.hemisphere,
      }
    }
  }
  return metadata
}

export function buildTerrainPackDependencyMetadata(input: {
  relativePath: string
  role: TerrainPackDependencyRole
  textureId?: string
}): TerrainPackDependencyMetadata {
  const metadata: TerrainPackDependencyMetadata = {
    version: TERRAIN_PACK_METADATA_VERSION,
    relativePath: input.relativePath,
    role: input.role,
  }
  if (input.textureId) {
    metadata.textureId = input.textureId
  }
  return metadata
}
