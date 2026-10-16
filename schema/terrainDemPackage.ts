/**
 * Terrain DEM package format shared between the `3dtiles-viewer` tool (writer)
 * and the editor planning terrain import (reader).
 *
 * A package is a zip archive with the following layout:
 *   dem.tif    float32 single band UTM GeoTIFF with WGS84 ellipsoid heights
 *   ortho.tif  optional RGB uint8 UTM GeoTIFF rendered top-down from the same terrain
 *   dem.json   this sidecar document describing the rasters and their georeferencing
 *
 * The GeoTIFF rasters are already fully georeferenced (projected CRS, square
 * pixels, north-up). The sidecar is descriptive: it records the capture anchor,
 * the elevation datum and sampling statistics so downstream tools can reason
 * about the data without re-reading the rasters.
 */

export const TERRAIN_DEM_PACKAGE_VERSION = 1

export const TERRAIN_DEM_PACKAGE_FILES = {
  dem: 'dem.tif',
  ortho: 'ortho.tif',
  sidecar: 'dem.json',
} as const

export interface TerrainDemPackageAnchor {
  latitudeDegrees: number
  longitudeDegrees: number
  /** WGS84 ellipsoid height of the capture origin in meters. */
  groundElevationMeters: number
}

export interface TerrainDemPackageCrs {
  type: 'utm'
  /** EPSG code of the projected CRS, e.g. 32646 for UTM 46N. */
  epsg: number
  /** UTM zone number 1..60. */
  zone: number
  hemisphere: 'north' | 'south'
  /** EPSG code of the underlying geographic CRS (always WGS84). */
  geographicEpsg: 4326
}

export interface TerrainDemPackageDemRaster {
  file: string
  width: number
  height: number
  cellSizeMeters: number
  /** Elevation range present in the raster in meters (ellipsoid heights). */
  minElevationMeters: number | null
  maxElevationMeters: number | null
}

export interface TerrainDemPackageOrthoRaster {
  file: string
  width: number
  height: number
  cellSizeMeters: number
  photometric: 'rgb'
}

export interface TerrainDemPackageStats {
  /** Triangles in the merged terrain mesh the DEM was sampled from. */
  sourceTriangleCount: number
  /** Grid cells that were probed against the terrain mesh. */
  sampledCellCount: number
  /** Cells without a terrain hit that were filled from the nearest sample. */
  filledCellCount: number
  /** filledCellCount / sampledCellCount (0..1). */
  filledRatio: number
  warnings: string[]
}

export interface TerrainDemPackageSidecar {
  version: typeof TERRAIN_DEM_PACKAGE_VERSION
  generator: '3dtiles-viewer'
  /** ISO timestamp of the export. */
  createdAt: string
  anchor: TerrainDemPackageAnchor
  crs: TerrainDemPackageCrs
  /** GDAL geotransform [originX, pixelSizeX, 0, originY, 0, -pixelSizeY]. */
  geoTransform: [number, number, number, number, number, number]
  /** Raster values are WGS84 ellipsoid heights above the ellipsoid surface. */
  elevationDatum: 'wgs84-ellipsoid'
  dem: TerrainDemPackageDemRaster
  ortho: TerrainDemPackageOrthoRaster | null
  stats: TerrainDemPackageStats
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validates a parsed `dem.json` document. Shared by the editor reader and the
 * admin resource-pack upload so both reject the same broken packages.
 */
export function parseTerrainDemPackageSidecar(value: unknown): TerrainDemPackageSidecar {
  if (typeof value !== 'object' || value === null) {
    throw new Error('地形包 dem.json 结构无效。')
  }
  const record = value as Record<string, unknown>
  if (record.version !== TERRAIN_DEM_PACKAGE_VERSION) {
    throw new Error(
      `地形包版本不受支持：${String(record.version)}（需要 ${TERRAIN_DEM_PACKAGE_VERSION}）。`,
    )
  }
  const anchor = record.anchor as Record<string, unknown> | undefined
  if (
    !anchor
    || !isFiniteNumber(anchor.latitudeDegrees)
    || !isFiniteNumber(anchor.longitudeDegrees)
    || !isFiniteNumber(anchor.groundElevationMeters)
  ) {
    throw new Error('地形包 dem.json 缺少有效的锚点信息。')
  }
  const crs = record.crs as Record<string, unknown> | undefined
  if (!crs || crs.type !== 'utm' || !isFiniteNumber(crs.epsg) || !isFiniteNumber(crs.zone)) {
    throw new Error('地形包 dem.json 缺少有效的投影信息。')
  }
  const geoTransform = record.geoTransform
  if (
    !Array.isArray(geoTransform)
    || geoTransform.length !== 6
    || !geoTransform.every((item) => isFiniteNumber(item))
  ) {
    throw new Error('地形包 dem.json 缺少有效的 geotransform。')
  }
  const dem = record.dem as Record<string, unknown> | undefined
  if (
    !dem
    || !isFiniteNumber(dem.width)
    || !isFiniteNumber(dem.height)
    || dem.width < 2
    || dem.height < 2
    || !isFiniteNumber(dem.cellSizeMeters)
    || dem.cellSizeMeters <= 0
  ) {
    throw new Error('地形包 dem.json 的 DEM 光栅描述无效。')
  }
  return value as TerrainDemPackageSidecar
}
