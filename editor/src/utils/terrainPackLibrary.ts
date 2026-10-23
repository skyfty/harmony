import {
  TERRAIN_DEM_STORAGE_LAYOUT,
  readTerrainPackAssetMetadata,
} from '@schema/terrainPack'
import type { TerrainDemPackageSidecar } from '@schema/terrainDemPackage'
import type { ProjectAsset } from '@/types/project-asset'
import { parseTerrainDemSidecarJson } from '@/utils/terrainDemPackage'

/**
 * Resource-library side of the terrain pack flow: the admin upload registers
 * dem.json as the DEM metadata asset, and the editor planning dialog resolves
 * private raster files from the sidecar on demand.
 */

export function isTerrainDemPackAsset(asset: ProjectAsset | null | undefined): boolean {
  const metadata = readTerrainPackAssetMetadata(asset?.metadata?.terrainPack)
  return metadata?.kind === 'dem' && metadata.storageLayout === TERRAIN_DEM_STORAGE_LAYOUT
}

export function isLegacyTerrainDemPackAsset(asset: ProjectAsset | null | undefined): boolean {
  const metadata = readTerrainPackAssetMetadata(asset?.metadata?.terrainPack)
  return metadata?.kind === 'dem' && metadata.storageLayout !== TERRAIN_DEM_STORAGE_LAYOUT
}

export function readTerrainDemPackSummary(asset: ProjectAsset | null | undefined): {
  crsLabel: string | null
  filename: string | null
} {
  const metadata = readTerrainPackAssetMetadata(asset?.metadata?.terrainPack)
  if (!metadata || metadata.kind !== 'dem') {
    return { crsLabel: null, filename: null }
  }
  const crs = metadata.crs
  const crsLabel = crs
    ? `EPSG:${crs.epsg} · UTM ${crs.zone}${crs.hemisphere === 'south' ? 'S' : 'N'}`
    : null
  return { crsLabel, filename: metadata.sidecarFile ?? metadata.sourceZipName ?? null }
}

export interface TerrainDemAssetFile {
  filename: string
  mimeType: 'image/tiff'
  file: File
}

export interface TerrainDemAssetContents {
  sidecar: TerrainDemPackageSidecar
  dem: TerrainDemAssetFile
  ortho: TerrainDemAssetFile | null
}

export function resolveTerrainDemRasterUrl(assetUrl: string, relativePath: string): string {
  const base = assetUrl.trim()
  const relative = relativePath.trim().replace(/\\/g, '/')
  if (
    !base
    || !relative
    || relative.startsWith('/')
    || /^[A-Za-z]:/.test(relative)
    || relative.split('/').some((segment) => segment === '' || segment === '..' || segment === '.')
  ) {
    throw new Error(`dem.json 包含无效的栅格路径：${relativePath}`)
  }
  return new URL(relative, base).toString()
}

function basename(path: string): string {
  return path.trim().replace(/\\/g, '/').split('/').pop() ?? path
}

/**
 * Downloads the registered dem.json metadata asset, resolves the referenced
 * private rasters relative to that URL, and caches TIF files on demand.
 */
export async function loadTerrainDemAssetContents(options: {
  asset: ProjectAsset
  ensureAssetFile: (assetId: string, options?: { asset?: ProjectAsset | null }) => Promise<File | null>
  ensureCachedFile: (assetId: string, downloadUrl: string, name: string) => Promise<File | null>
}): Promise<TerrainDemAssetContents> {
  const { asset, ensureCachedFile } = options
  if (!isTerrainDemPackAsset(asset)) {
    throw new Error('所选资产不是 DEM 地形资源包。')
  }
  const sidecarFile = await options.ensureAssetFile(asset.id, { asset })
  if (!sidecarFile) {
    throw new Error('无法下载所选 DEM 元数据 dem.json。')
  }
  const sidecar = parseTerrainDemSidecarJson(new Uint8Array(await sidecarFile.arrayBuffer()))
  const demUrl = resolveTerrainDemRasterUrl(asset.downloadUrl, sidecar.dem.file)
  const demFile = await ensureCachedFile(
    `terrain-dem:${asset.id}:dem`,
    demUrl,
    basename(sidecar.dem.file),
  )
  if (!demFile) {
    throw new Error(`无法下载 DEM 栅格：${sidecar.dem.file}`)
  }
  let ortho: TerrainDemAssetFile | null = null
  if (sidecar.ortho) {
    const orthoUrl = resolveTerrainDemRasterUrl(asset.downloadUrl, sidecar.ortho.file)
    const orthoFile = await ensureCachedFile(
      `terrain-dem:${asset.id}:ortho`,
      orthoUrl,
      basename(sidecar.ortho.file),
    )
    if (!orthoFile) {
      throw new Error(`无法下载 DEM 正射影像：${sidecar.ortho.file}`)
    }
    ortho = {
      filename: basename(sidecar.ortho.file),
      mimeType: 'image/tiff',
      file: orthoFile,
    }
  }
  return {
    sidecar,
    dem: {
      filename: basename(sidecar.dem.file),
      mimeType: 'image/tiff',
      file: demFile,
    },
    ortho,
  }
}
