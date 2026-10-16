import { readTerrainPackAssetMetadata } from '@schema/terrainPack'
import type { ProjectAsset } from '@/types/project-asset'

/**
 * Resource-library side of the terrain pack flow: the admin upload registers
 * DEM packs as hidden-dependency masters, and the editor planning dialog picks
 * them by their `terrainPack` metadata.
 */

export function isTerrainDemPackAsset(asset: ProjectAsset | null | undefined): boolean {
  return readTerrainPackAssetMetadata(asset?.metadata?.terrainPack)?.kind === 'dem'
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

/**
 * Downloads the DEM pack zip through the asset cache (mirror candidates, worker
 * downloader and wx.downloadFile fallbacks included) and returns the File the
 * existing `terrainDemPackageZip` reader consumes.
 */
export async function loadTerrainDemPackFileFromAsset(options: {
  asset: ProjectAsset
  ensureAssetFile: (assetId: string, options?: { asset?: ProjectAsset | null }) => Promise<File | null>
}): Promise<File> {
  const { asset, ensureAssetFile } = options
  if (!isTerrainDemPackAsset(asset)) {
    throw new Error('所选资产不是 DEM 地形资源包。')
  }
  const file = await ensureAssetFile(asset.id, { asset })
  if (!file) {
    throw new Error('无法下载所选 DEM 资源包。')
  }
  return file
}
