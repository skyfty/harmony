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
  TERRAIN_DEM_STORAGE_LAYOUT,
  TERRAIN_PACK_METADATA_VERSION,
  detectTerrainPackKind,
  normalizeTerrainPackPath,
  parseTerrainTextureManifest,
  resolveTerrainPackStoredPath,
  summarizeTerrainPack,
  type TerrainPackAssetMetadata,
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

function normalizeDemRasterReference(value: string, label: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').some((segment) => segment === '' || segment === '..' || segment === '.')
  ) {
    throw new Error(`dem.json 的 ${label} 必须是资源包内的相对路径。`)
  }
  return normalized
}

function resolveDemRasterArchivePath(sidecarPath: string, rasterPath: string): string {
  const directory = sidecarPath.includes('/')
    ? sidecarPath.slice(0, sidecarPath.lastIndexOf('/') + 1)
    : ''
  return normalizeTerrainPackPath(`${directory}${rasterPath}`) ?? ''
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
    const demReference = normalizeDemRasterReference(sidecar.dem.file, 'dem.file')
    const expectedDemPath = resolveDemRasterArchivePath(sidecarPath, demReference)
    if (!expectedDemPath || !entryByPath.has(expectedDemPath.toLowerCase())) {
      throw new Error(`dem.json 引用的 DEM 栅格不存在：${sidecar.dem.file}。`)
    }
    const expectedOrthoPath = sidecar.ortho
      ? resolveDemRasterArchivePath(
          sidecarPath,
          normalizeDemRasterReference(sidecar.ortho.file, 'ortho.file'),
        )
      : null
    if (expectedOrthoPath && !entryByPath.has(expectedOrthoPath.toLowerCase())) {
      throw new Error(`dem.json 引用的正射栅格不存在：${sidecar.ortho!.file}。`)
    }
    summary = summarizeTerrainPack(
      entries.map((entry) => ({ path: entry.path, bytes: entry.bytes.byteLength })),
      { sidecar: sidecarJson },
    )
    summary.demFile = expectedDemPath
    summary.orthoFile = expectedOrthoPath
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

export function resolveTerrainPackPrimaryAssetType(kind: TerrainPackKind): AssetType {
  return kind === 'geometry' ? 'model' : 'file'
}

export function buildTerrainPackAssetMetadata(input: {
  archive: ParsedTerrainPackArchive
  packKey: string
  runtimeGrid?: {
    file: string
    url: string
    bytes: number
    format: 'hdem-v1'
    compression: 'deflate'
    filledRatio: number
  } | null
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
    metadata.storageLayout = TERRAIN_DEM_STORAGE_LAYOUT
    metadata.sidecarFile = TERRAIN_DEM_PACKAGE_FILES.sidecar
    metadata.demFile = archive.sidecar?.dem.file ?? null
    metadata.orthoFile = archive.sidecar?.ortho?.file ?? null
    metadata.demWidth = archive.sidecar?.dem.width ?? null
    metadata.demHeight = archive.sidecar?.dem.height ?? null
    metadata.demCellSizeMeters = archive.sidecar?.dem.cellSizeMeters ?? null
    metadata.demMinElevation = archive.sidecar?.dem.minElevationMeters ?? null
    metadata.demMaxElevation = archive.sidecar?.dem.maxElevationMeters ?? null
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
      if (input.runtimeGrid) {
        metadata.runtimeGridFile = input.runtimeGrid.file
        metadata.runtimeGridUrl = input.runtimeGrid.url
        metadata.runtimeGridBytes = input.runtimeGrid.bytes
        metadata.runtimeGridFormat = input.runtimeGrid.format
        metadata.runtimeGridCompression = input.runtimeGrid.compression
        metadata.runtimeGridFilledRatio = input.runtimeGrid.filledRatio
      }
    }
  }
  return metadata
}

export interface TerrainPackStorageEntry {
  /** Relative path inside the archive. */
  sourcePath: string
  /** Canonical path inside the pack folder (`<packKey>/…`). */
  storedPath: string
  bytes: Uint8Array
}

export interface TerrainPackStoragePlan {
  kind: TerrainPackKind
  /** Canonical path of the primary file, relative to the pack folder. */
  primaryStoredPath: string
  /** Path of the registered primary file inside the archive. */
  primarySourcePath: string | null
  /** Everything that gets written besides the primary file. */
  entries: TerrainPackStorageEntry[]
  warnings: string[]
}

function withSuffix(path: string, suffix: number): string {
  const dot = path.lastIndexOf('.')
  if (dot <= 0) {
    return `${path}-${suffix}`
  }
  return `${path.slice(0, dot)}-${suffix}${path.slice(dot)}`
}

/**
 * Canonical storage plan of a pack: geometry packs always end up as
 * `scene.glb` + `textures/*` (+ `textures.json`) so the runtime texture stream
 * can resolve `textures/*` relative to the GLB URL; DEM packs register dem.json
 * and keep referenced rasters as private sibling files. Name clashes created
 * by flattening get a numeric suffix.
 */
export function planTerrainPackStorage(archive: ParsedTerrainPackArchive): TerrainPackStoragePlan {
  const warnings: string[] = []
  if (archive.kind === 'dem') {
    const sidecar = archive.sidecar
    const sidecarPath = archive.summary.sidecarFile
    const demPath = archive.summary.demFile
    if (!sidecar || !sidecarPath || !demPath) {
      throw new Error('DEM 资源包缺少 dem.json 或 dem.tif，无法生成存储计划。')
    }
    const demBytes = archive.entryByPath.get(demPath.toLowerCase())
    if (!demBytes) {
      throw new Error(`资源包缺少主栅格 ${demPath}。`)
    }
    const entries: TerrainPackStorageEntry[] = [{
      sourcePath: demPath,
      storedPath: normalizeDemRasterReference(sidecar.dem.file, 'dem.file'),
      bytes: demBytes,
    }]
    if (sidecar.ortho) {
      const orthoPath = archive.summary.orthoFile
      const orthoBytes = orthoPath ? archive.entryByPath.get(orthoPath.toLowerCase()) : null
      if (!orthoPath || !orthoBytes) {
        throw new Error(`资源包缺少正射栅格 ${sidecar.ortho.file}。`)
      }
      entries.push({
        sourcePath: orthoPath,
        storedPath: normalizeDemRasterReference(sidecar.ortho.file, 'ortho.file'),
        bytes: orthoBytes,
      })
    }
    const storedPaths = new Set([TERRAIN_DEM_PACKAGE_FILES.sidecar.toLowerCase()])
    for (const entry of entries) {
      const key = entry.storedPath.toLowerCase()
      if (storedPaths.has(key)) {
        throw new Error(`dem.json 引用了重复的栅格路径：${entry.storedPath}。`)
      }
      storedPaths.add(key)
    }
    return {
      kind: 'dem',
      primaryStoredPath: TERRAIN_DEM_PACKAGE_FILES.sidecar,
      primarySourcePath: sidecarPath,
      entries,
      warnings,
    }
  }

  const glbFile = archive.summary.glbFile
  const primaryStoredPath = resolveTerrainPackStoredPath('geometry', glbFile ?? 'scene.glb', glbFile) ?? 'scene.glb'
  const entries: TerrainPackStorageEntry[] = []
  const taken = new Set<string>([primaryStoredPath.toLowerCase()])

  for (const entry of archive.entries) {
    if (glbFile && entry.path.toLowerCase() === glbFile.toLowerCase()) {
      continue
    }
    const preferred = resolveTerrainPackStoredPath('geometry', entry.path, glbFile) ?? entry.path
    let storedPath = preferred
    if (taken.has(storedPath.toLowerCase())) {
      let suffix = 2
      while (taken.has(withSuffix(preferred, suffix).toLowerCase())) {
        suffix += 1
      }
      storedPath = withSuffix(preferred, suffix)
      warnings.push(`归位后文件重名：${entry.path} 已重命名为 ${storedPath}`)
    }
    taken.add(storedPath.toLowerCase())
    entries.push({ sourcePath: entry.path, storedPath, bytes: entry.bytes })
  }

  return {
    kind: 'geometry',
    primaryStoredPath,
    primarySourcePath: glbFile,
    entries,
    warnings,
  }
}
