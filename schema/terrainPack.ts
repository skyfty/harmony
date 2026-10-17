import {
  TERRAIN_DEM_PACKAGE_FILES,
  parseTerrainDemPackageSidecar,
} from './terrainDemPackage'

/**
 * Terrain resource pack contract shared by the 3dtiles-viewer exporter, the
 * admin resource upload and the editor/runtime readers.
 *
 * Geometry pack (zip):
 *   scene.glb            merged terrain mesh, geometry only; the mesh node extras
 *                        carry `plTextureBindings`
 *   textures/<id>.<ext>  one file per texture (jpg/png, optional .ktx2 variant)
 *   textures.json        manifest listing id/file/resolution/bytes (+ optional ktx2)
 *
 * DEM upload envelope (zip): see ./terrainDemPackage.ts. The admin extracts it
 * and registers dem.json while keeping rasters as private on-demand files.
 *
 * This module stays free of three/fflate so the Node server, the editor and the
 * runtime can all share the same validation.
 */

export const TERRAIN_GEOMETRY_PACK_GLB = 'scene.glb' as const
export const TERRAIN_GEOMETRY_PACK_TEXTURE_DIR = 'textures' as const
export const TERRAIN_GEOMETRY_PACK_MANIFEST = 'textures.json' as const

export const TERRAIN_PACK_METADATA_VERSION = 1 as const
export const TERRAIN_DEM_STORAGE_LAYOUT = 'extracted-v2' as const

export type TerrainPackKind = 'geometry' | 'dem'

export interface TerrainTextureManifestSlot {
  mesh?: string
  materialIndex?: number
  slot?: string
}

export interface TerrainTextureManifestEntry {
  id?: string
  image?: string
  ktx2?: string
  ktx2Bytes?: number
  width?: number
  height?: number
  bytes?: number
  mimeType?: string
  slots?: TerrainTextureManifestSlot[]
}

export interface TerrainTextureManifest {
  version?: number
  glb?: string
  textures?: TerrainTextureManifestEntry[]
}

export function parseTerrainTextureManifest(json: unknown): TerrainTextureManifest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Terrain texture manifest must be a JSON object')
  }
  const record = json as Record<string, unknown>
  if (record.version !== undefined && record.version !== 1) {
    throw new Error(`Terrain texture manifest version is not supported: ${String(record.version)}`)
  }
  if (record.textures !== undefined && !Array.isArray(record.textures)) {
    throw new Error('Terrain texture manifest "textures" must be an array')
  }
  return json as TerrainTextureManifest
}

export interface TerrainPackEntry {
  /** Relative path inside the archive, using forward slashes. */
  path: string
  bytes: number
}

export interface TerrainPackFileSummary {
  path: string
  bytes: number
}

export interface TerrainPackTextureSummary {
  id: string
  file: string
  ktx2File: string | null
  width: number | null
  height: number | null
  bytes: number | null
  mimeType: string | null
}

export interface TerrainPackSummary {
  kind: TerrainPackKind
  /** Geometry pack: path of `scene.glb`. */
  glbFile: string | null
  /** Geometry pack: path of `textures.json`. */
  manifestFile: string | null
  /** DEM pack: path of `dem.json`. */
  sidecarFile: string | null
  /** DEM pack: path of `dem.tif`. */
  demFile: string | null
  /** DEM pack: path of `ortho.tif` when present. */
  orthoFile: string | null
  textures: TerrainPackTextureSummary[]
  files: TerrainPackFileSummary[]
  totalBytes: number
  warnings: string[]
}

export interface TerrainPackAssetMetadata {
  version: typeof TERRAIN_PACK_METADATA_VERSION
  kind: TerrainPackKind
  /** DEM packs v2 register dem.json and keep rasters as private sibling files. */
  storageLayout?: typeof TERRAIN_DEM_STORAGE_LAYOUT
  /** Storage folder of the extracted pack (`<packKey>/...`). */
  packKey: string
  sourceZipName: string | null
  sourceZipHash: string
  sourceZipHashAlgorithm: 'sha256'
  glbFile?: string | null
  manifestFile?: string | null
  sidecarFile?: string | null
  demFile?: string | null
  orthoFile?: string | null
  demWidth?: number | null
  demHeight?: number | null
  demCellSizeMeters?: number | null
  demMinElevation?: number | null
  demMaxElevation?: number | null
  textures?: TerrainPackTextureSummary[]
  files?: TerrainPackFileSummary[]
  totalBytes?: number
  warnings?: string[]
  anchor?: { latitudeDegrees: number; longitudeDegrees: number; groundElevationMeters: number } | null
  crs?: { epsg: number; zone: number; hemisphere: 'north' | 'south' } | null
  /** DEM packs: compact, client-ready height grid generated during upload. */
  runtimeGridFile?: string | null
  runtimeGridUrl?: string | null
  runtimeGridBytes?: number | null
  runtimeGridFormat?: 'hdem-v1' | null
  runtimeGridCompression?: 'deflate' | null
  runtimeGridFilledRatio?: number | null
}

export function normalizeTerrainPackPath(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim()
  if (!normalized || normalized.endsWith('/')) {
    return null
  }
  return normalized
}

function baseName(path: string): string {
  const index = path.lastIndexOf('/')
  return (index >= 0 ? path.slice(index + 1) : path).toLowerCase()
}

function listEntries(entries: readonly TerrainPackEntry[]): TerrainPackEntry[] {
  const out: TerrainPackEntry[] = []
  for (const entry of entries) {
    const path = normalizeTerrainPackPath(entry.path)
    if (!path) {
      continue
    }
    const bytes = Number.isFinite(entry.bytes) && entry.bytes > 0 ? Math.trunc(entry.bytes) : 0
    out.push({ path, bytes })
  }
  return out
}

function findEntryPath(entries: readonly TerrainPackEntry[], targetName: string): string | null {
  const target = targetName.toLowerCase()
  for (const entry of entries) {
    if (baseName(entry.path) === target) {
      return entry.path
    }
  }
  return null
}

/** Detects the pack kind from archive entry names; returns null for foreign zips. */
export function detectTerrainPackKind(entryNames: readonly string[]): TerrainPackKind | null {
  const names = entryNames
    .map((name) => normalizeTerrainPackPath(name)?.toLowerCase() ?? '')
    .filter((name) => name.length > 0)
  const hasGeometry = names.some((name) => baseName(name) === TERRAIN_GEOMETRY_PACK_GLB)
    && names.some((name) => baseName(name) === TERRAIN_GEOMETRY_PACK_MANIFEST)
  if (hasGeometry) {
    return 'geometry'
  }
  const hasDem = names.some((name) => baseName(name) === TERRAIN_DEM_PACKAGE_FILES.dem)
    && names.some((name) => baseName(name) === TERRAIN_DEM_PACKAGE_FILES.sidecar)
  if (hasDem) {
    return 'dem'
  }
  return null
}

const TERRAIN_PACK_TEXTURE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'bmp',
  'gif',
  'ktx',
  'ktx2',
  'dds',
  'tga',
])

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function isTextureLikePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  const directories = normalized.split('/').slice(0, -1)
  if (directories.includes(TERRAIN_GEOMETRY_PACK_TEXTURE_DIR.toLowerCase())) {
    return true
  }
  return TERRAIN_PACK_TEXTURE_EXTENSIONS.has(extensionOf(normalized))
}

/**
 * Canonical storage layout of a terrain pack inside the asset storage root.
 *
 * The runtime texture stream resolves `textures/<file>` relative to the GLB's
 * download URL, so whatever directory structure the archive used is flattened
 * to: `scene.glb` + `textures/<file>` (+ `textures.json`) for geometry packs.
 * DEM v2 packs register `dem.json` directly and keep raster files as private
 * siblings, so this geometry-oriented mapper returns null for them.
 */
export function resolveTerrainPackStoredPath(
  kind: TerrainPackKind,
  entryPath: string,
  glbFile: string | null = null,
): string | null {
  const path = normalizeTerrainPackPath(entryPath)
  if (!path) {
    return null
  }
  if (kind === 'dem') {
    return null
  }
  const base = baseName(path)
  if (base === TERRAIN_GEOMETRY_PACK_GLB) {
    return TERRAIN_GEOMETRY_PACK_GLB
  }
  if (base === TERRAIN_GEOMETRY_PACK_MANIFEST) {
    return TERRAIN_GEOMETRY_PACK_MANIFEST
  }
  if (glbFile && path === normalizeTerrainPackPath(glbFile)) {
    return TERRAIN_GEOMETRY_PACK_GLB
  }
  const fileName = path.split('/').pop() ?? path
  return isTextureLikePath(path)
    ? `${TERRAIN_GEOMETRY_PACK_TEXTURE_DIR}/${fileName}`
    : fileName
}

export type TerrainPackSummarizeOptions = {
  /** Parses `textures.json`; pass a JSON value when the caller already decoded it. */
  manifest?: TerrainTextureManifest | null
  /** Parses `dem.json`; pass a JSON value when the caller already decoded it. */
  sidecar?: unknown
}

function summarizeGeometryPack(
  entries: TerrainPackEntry[],
  options: TerrainPackSummarizeOptions,
): TerrainPackSummary {
  const warnings: string[] = []
  const glbFile = findEntryPath(entries, TERRAIN_GEOMETRY_PACK_GLB)
  const manifestFile = findEntryPath(entries, TERRAIN_GEOMETRY_PACK_MANIFEST)
  if (!glbFile) {
    throw new Error(`资源包缺少 ${TERRAIN_GEOMETRY_PACK_GLB}。`)
  }
  if (!manifestFile) {
    throw new Error(`资源包缺少 ${TERRAIN_GEOMETRY_PACK_MANIFEST}。`)
  }

  const manifest = options.manifest ?? null
  if (!manifest) {
    throw new Error(`资源包 ${TERRAIN_GEOMETRY_PACK_MANIFEST} 尚未解析。`)
  }

  const byRelativePath = new Map<string, TerrainPackEntry>()
  for (const entry of entries) {
    byRelativePath.set(entry.path.toLowerCase(), entry)
  }

  const manifestDir = manifestFile.includes('/')
    ? manifestFile.slice(0, manifestFile.lastIndexOf('/') + 1)
    : ''
  const glbDir = glbFile.includes('/') ? glbFile.slice(0, glbFile.lastIndexOf('/') + 1) : ''
  if (manifestDir !== glbDir) {
    warnings.push(`${TERRAIN_GEOMETRY_PACK_MANIFEST} 与 ${TERRAIN_GEOMETRY_PACK_GLB} 不在同一目录，运行时相对路径解析可能失败。`)
  }

  const textures: TerrainPackTextureSummary[] = []
  const claimedPaths = new Set<string>()
  for (const [index, entry] of (manifest.textures ?? []).entries()) {
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const image = normalizeTerrainPackPath(entry.image ?? null)
    if (!id || !image) {
      warnings.push(`textures.json 第 ${index + 1} 项缺少 id 或 image，已跳过。`)
      continue
    }
    const imagePath = `${glbDir}${image}`
    const imageEntry = byRelativePath.get(imagePath.toLowerCase())
    if (!imageEntry) {
      warnings.push(`清单引用的贴图缺失：${imagePath}`)
    }
    claimedPaths.add(imagePath.toLowerCase())
    const ktx2Relative = normalizeTerrainPackPath(entry.ktx2 ?? null)
    const ktx2Path = ktx2Relative ? `${glbDir}${ktx2Relative}` : null
    if (ktx2Path) {
      claimedPaths.add(ktx2Path.toLowerCase())
      if (!byRelativePath.has(ktx2Path.toLowerCase())) {
        warnings.push(`清单引用的 KTX2 变体缺失：${ktx2Path}`)
      }
    }
    textures.push({
      id,
      file: imagePath,
      ktx2File: ktx2Path,
      width: typeof entry.width === 'number' && Number.isFinite(entry.width) ? entry.width : null,
      height: typeof entry.height === 'number' && Number.isFinite(entry.height) ? entry.height : null,
      bytes: typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) ? entry.bytes : null,
      mimeType: typeof entry.mimeType === 'string' && entry.mimeType.trim() ? entry.mimeType.trim() : null,
    })
  }

  for (const entry of entries) {
    const lower = entry.path.toLowerCase()
    if (lower === glbFile.toLowerCase() || lower === manifestFile.toLowerCase()) {
      continue
    }
    const isTextureDir = entry.path.includes(`${TERRAIN_GEOMETRY_PACK_TEXTURE_DIR}/`)
    if (!isTextureDir) {
      warnings.push(`资源包内存在未归类文件：${entry.path}`)
      continue
    }
    if (!claimedPaths.has(lower)) {
      warnings.push(`存在未被 textures.json 引用的贴图：${entry.path}`)
    }
  }

  return {
    kind: 'geometry',
    glbFile,
    manifestFile,
    sidecarFile: null,
    demFile: null,
    orthoFile: null,
    textures,
    files: entries.map((entry) => ({ path: entry.path, bytes: entry.bytes })),
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    warnings,
  }
}

function summarizeDemPack(
  entries: TerrainPackEntry[],
  options: TerrainPackSummarizeOptions,
): TerrainPackSummary {
  const warnings: string[] = []
  const sidecarFile = findEntryPath(entries, TERRAIN_DEM_PACKAGE_FILES.sidecar)
  const demFile = findEntryPath(entries, TERRAIN_DEM_PACKAGE_FILES.dem)
  if (!sidecarFile) {
    throw new Error(`资源包缺少 ${TERRAIN_DEM_PACKAGE_FILES.sidecar}。`)
  }
  if (!demFile) {
    throw new Error(`资源包缺少 ${TERRAIN_DEM_PACKAGE_FILES.dem}。`)
  }
  if (options.sidecar === undefined || options.sidecar === null) {
    throw new Error(`资源包 ${TERRAIN_DEM_PACKAGE_FILES.sidecar} 尚未解析。`)
  }
  const sidecar = parseTerrainDemPackageSidecar(options.sidecar)
  const orthoFile = findEntryPath(entries, TERRAIN_DEM_PACKAGE_FILES.ortho)
  if (sidecar.ortho && !orthoFile) {
    warnings.push(`dem.json 记录了正射影像，但包内缺少 ${TERRAIN_DEM_PACKAGE_FILES.ortho}。`)
  }
  if (!sidecar.ortho && orthoFile) {
    warnings.push(`包内存在 ${TERRAIN_DEM_PACKAGE_FILES.ortho}，但 dem.json 未记录正射影像。`)
  }
  const sourceFilledRatio = Number(sidecar.stats?.filledRatio)
  if (Number.isFinite(sourceFilledRatio) && sourceFilledRatio > 0) {
    warnings.push(
      `DEM 原始栅格有 ${(sourceFilledRatio * 100).toFixed(1)}% 采样空洞（已在上游用最近有效值填充）。`,
    )
  }
  for (const warning of sidecar.stats?.warnings ?? []) {
    const text = typeof warning === 'string' ? warning.trim() : ''
    if (text && !warnings.includes(text)) {
      warnings.push(text)
    }
  }
  const knownFiles = new Set(
    [sidecarFile, demFile, orthoFile].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()),
  )
  for (const entry of entries) {
    if (!knownFiles.has(entry.path.toLowerCase())) {
      warnings.push(`资源包内存在未归类文件：${entry.path}`)
    }
  }

  return {
    kind: 'dem',
    glbFile: null,
    manifestFile: null,
    sidecarFile,
    demFile,
    orthoFile,
    textures: [],
    files: entries.map((entry) => ({ path: entry.path, bytes: entry.bytes })),
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    warnings,
  }
}

/**
 * Validates a terrain pack from its archive entries. Throws with a readable
 * message for foreign or broken zips; returns warnings (never throws) for
 * recoverable mismatches.
 */
export function summarizeTerrainPack(
  inputEntries: readonly TerrainPackEntry[],
  options: TerrainPackSummarizeOptions = {},
): TerrainPackSummary {
  const entries = listEntries(inputEntries)
  const kind = detectTerrainPackKind(entries.map((entry) => entry.path))
  if (!kind) {
    throw new Error(
      `无法识别的资源包：既不是几何+贴图包（${TERRAIN_GEOMETRY_PACK_GLB} + ${TERRAIN_GEOMETRY_PACK_MANIFEST}），也不是 DEM 包（${TERRAIN_DEM_PACKAGE_FILES.dem} + ${TERRAIN_DEM_PACKAGE_FILES.sidecar}）。`,
    )
  }
  return kind === 'geometry'
    ? summarizeGeometryPack(entries, options)
    : summarizeDemPack(entries, options)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readTerrainPackAssetMetadata(value: unknown): TerrainPackAssetMetadata | null {
  if (!isRecord(value)) {
    return null
  }
  const kind = value.kind
  if (value.version !== TERRAIN_PACK_METADATA_VERSION || (kind !== 'geometry' && kind !== 'dem')) {
    return null
  }
  if (typeof value.packKey !== 'string' || !value.packKey.trim()) {
    return null
  }
  return value as unknown as TerrainPackAssetMetadata
}

export function isTerrainGeometryPackAssetMetadata(value: unknown): boolean {
  return readTerrainPackAssetMetadata(value)?.kind === 'geometry'
}

export function isTerrainDemPackAssetMetadata(value: unknown): boolean {
  return readTerrainPackAssetMetadata(value)?.kind === 'dem'
}
