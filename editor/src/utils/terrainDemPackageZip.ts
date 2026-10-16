import { unzipSync } from 'fflate'
import {
  TERRAIN_DEM_PACKAGE_FILES,
  parseTerrainDemPackageSidecar,
  type TerrainDemPackageSidecar,
} from '@schema/terrainDemPackage'

/**
 * Reader for the "geometry + georeferenced rasters" terrain package produced by
 * the 3dtiles-viewer DEM export (see `schema/terrainDemPackage.ts` for the
 * format). The editor planning flow consumes `dem.tif` through the regular
 * GeoTIFF DEM import and keeps `ortho.tif` as an indexed-DB referenced
 * orthophoto sidecar resource.
 */

export interface TerrainDemPackageRasterFile {
  filename: string
  mimeType: string
  blob: Blob
}

export interface TerrainDemPackageContents {
  sidecar: TerrainDemPackageSidecar
  dem: TerrainDemPackageRasterFile
  ortho: TerrainDemPackageRasterFile | null
}

export function isTerrainDemPackageZip(filename: string, mimeType?: string | null): boolean {
  void mimeType
  return filename.trim().toLowerCase().endsWith('.zip')
}

function findEntry(entries: Record<string, Uint8Array>, targetName: string): Uint8Array | null {
  const target = targetName.toLowerCase()
  for (const [path, bytes] of Object.entries(entries)) {
    const normalized = path.replace(/\\/g, '/').toLowerCase()
    const base = normalized.split('/').pop() ?? ''
    if (normalized === target || base === target) {
      return bytes
    }
  }
  return null
}

export function parseTerrainDemSidecarJson(bytes: Uint8Array): TerrainDemPackageSidecar {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('地形包 dem.json 不是有效的 JSON。')
  }
  return parseTerrainDemPackageSidecar(parsed)
}

export function parseTerrainDemPackageZip(bytes: Uint8Array): TerrainDemPackageContents {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('无法解压地形包：文件不是有效的 zip 压缩包。')
  }

  const sidecarBytes = findEntry(entries, TERRAIN_DEM_PACKAGE_FILES.sidecar)
  if (!sidecarBytes) {
    throw new Error('地形包缺少 dem.json，无法识别该压缩包。')
  }
  const sidecar = parseTerrainDemSidecarJson(sidecarBytes)

  const demBytes = findEntry(entries, TERRAIN_DEM_PACKAGE_FILES.dem)
  if (!demBytes) {
    throw new Error('地形包缺少 dem.tif 高程光栅。')
  }
  const orthoBytes = findEntry(entries, TERRAIN_DEM_PACKAGE_FILES.ortho)

  return {
    sidecar,
    dem: {
      filename: TERRAIN_DEM_PACKAGE_FILES.dem,
      mimeType: 'image/tiff',
      blob: new Blob([toArrayBufferBackedCopy(demBytes)], { type: 'image/tiff' }),
    },
    ortho: orthoBytes
      ? {
          filename: TERRAIN_DEM_PACKAGE_FILES.ortho,
          mimeType: 'image/tiff',
          blob: new Blob([toArrayBufferBackedCopy(orthoBytes)], { type: 'image/tiff' }),
        }
      : null,
  }
}

/** Blob parts must be backed by a plain ArrayBuffer (not SharedArrayBuffer). */
function toArrayBufferBackedCopy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

/**
 * Guards against a corrupted package where the sidecar no longer matches the
 * GeoTIFF that was actually parsed (dimensions or pixel size drift).
 */
export function verifyTerrainDemPackageImport(
  sidecar: TerrainDemPackageSidecar,
  dem: { width: number; height: number; sampleStepMeters: number | null },
): void {
  if (dem.width !== sidecar.dem.width || dem.height !== sidecar.dem.height) {
    throw new Error(
      `地形包不一致：dem.tif 为 ${dem.width}×${dem.height}，dem.json 记录为 ${sidecar.dem.width}×${sidecar.dem.height}。`,
    )
  }
  const step = Number(dem.sampleStepMeters)
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error('地形包不一致：无法从 dem.tif 解析像素间距。')
  }
  const tolerance = sidecar.dem.cellSizeMeters * 0.005
  if (Math.abs(step - sidecar.dem.cellSizeMeters) > tolerance) {
    throw new Error(
      `地形包不一致：dem.tif 像素间距 ${step}m 与 dem.json 记录的 ${sidecar.dem.cellSizeMeters}m 不符。`,
    )
  }
}
