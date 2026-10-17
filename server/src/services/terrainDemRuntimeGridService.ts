import { fromArrayBuffer } from 'geotiff'
import {
  encodeTerrainDemRuntimeGridFile,
  type TerrainDemRuntimeGridData,
} from '@harmony/schema/terrainDemRuntimeGrid'
import type { TerrainDemPackageSidecar } from '@harmony/schema/terrainDemPackage'
import { latLonToUtm } from '@harmony/schema/utm'

export interface TerrainDemRuntimeGridBuildResult {
  bytes: Uint8Array
  grid: TerrainDemRuntimeGridData
  warnings: string[]
}

function isNoData(value: number, noData: number | null): boolean {
  return !Number.isFinite(value) || (noData != null && Math.abs(value - noData) < 1e-6)
}

function fillNearest(
  values: Float32Array,
  valid: Uint8Array,
  width: number,
  height: number,
): { filled: number } {
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  for (let index = 0; index < values.length; index += 1) {
    if (valid[index]) {
      queue[tail++] = index
    }
  }
  let filled = 0
  while (head < tail) {
    const index = queue[head++]!
    const row = Math.floor(index / width)
    const col = index - row * width
    const neighbors = [
      col > 0 ? index - 1 : -1,
      col + 1 < width ? index + 1 : -1,
      row > 0 ? index - width : -1,
      row + 1 < height ? index + width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || valid[neighbor]) {
        continue
      }
      values[neighbor] = values[index]!
      valid[neighbor] = 1
      filled += 1
      queue[tail++] = neighbor
    }
  }
  return { filled }
}

/**
 * Decode the DEM once during admin upload and write the compact runtime grid
 * consumed by editor/preview/SceneryViewer. The source zip remains untouched.
 */
export async function buildTerrainDemRuntimeGrid(input: {
  demBytes: Uint8Array
  sidecar: TerrainDemPackageSidecar
}): Promise<TerrainDemRuntimeGridBuildResult> {
  const { sidecar } = input
  const transform = sidecar.geoTransform
  const cellX = Math.abs(transform[1]!)
  const cellY = Math.abs(transform[5]!)
  if (
    !(cellX > 0) ||
    !(cellY > 0) ||
    Math.abs(cellX - cellY) > Math.max(1e-6, cellX * 0.005) ||
    !Number.isFinite(transform[0]!) ||
    !Number.isFinite(transform[3]!) ||
    Math.abs(transform[2]!) > 1e-9 ||
    Math.abs(transform[4]!) > 1e-9
  ) {
    throw new Error('DEM GeoTIFF 必须是北向上、方形像素、无旋转的投影栅格。')
  }
  if (sidecar.crs.type !== 'utm' || !Number.isFinite(sidecar.crs.epsg)) {
    throw new Error('DEM 资源包必须包含有效的 UTM CRS。')
  }

  const demCopy = new Uint8Array(input.demBytes.byteLength)
  demCopy.set(input.demBytes)
  const tiff = await fromArrayBuffer(demCopy.buffer as ArrayBuffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  if (width !== sidecar.dem.width || height !== sidecar.dem.height) {
    throw new Error(
      `DEM 尺寸不一致：${width}×${height}，dem.json 为 ${sidecar.dem.width}×${sidecar.dem.height}。`,
    )
  }
  const origin = image.getOrigin()
  const resolution = image.getResolution()
  const geoKeys = image.getGeoKeys() as Record<string, unknown> | null
  const projectedEpsg = Number(geoKeys?.ProjectedCSTypeGeoKey)
  if (
    !Number.isFinite(projectedEpsg)
    || projectedEpsg !== sidecar.crs.epsg
  ) {
    throw new Error(
      `DEM GeoTIFF 投影与 dem.json 不一致：TIF 为 ${Number.isFinite(projectedEpsg) ? `EPSG:${projectedEpsg}` : '未知'}，dem.json 为 EPSG:${sidecar.crs.epsg}。`,
    )
  }
  const originTolerance = Math.max(1e-3, cellX * 1e-4)
  if (
    !origin
    || !resolution
    || Math.abs(Number(origin[0]) - transform[0]!) > originTolerance
    || Math.abs(Number(origin[1]) - transform[3]!) > originTolerance
    || !(Number(resolution[0]) > 0)
    || !(Number(resolution[1]) < 0)
    || Math.abs(Math.abs(Number(resolution[0])) - cellX) > Math.max(1e-6, cellX * 0.005)
    || Math.abs(Math.abs(Number(resolution[1])) - cellY) > Math.max(1e-6, cellY * 0.005)
  ) {
    throw new Error('DEM GeoTIFF 的地理变换与 dem.json 不一致（要求北向上、方形像素、无旋转）。')
  }
  const rasterWidth = width
  const rasterHeight = height
  const raster = await image.readRasters({ interleave: true }) as unknown as ArrayLike<number>
  if (raster.length < rasterWidth * rasterHeight) {
    throw new Error('DEM 栅格读取结果不完整。')
  }
  const noDataValue = typeof image.getGDALNoData === 'function'
    ? Number(image.getGDALNoData())
    : null
  const noData = Number.isFinite(noDataValue) ? noDataValue : null

  const heights = new Float32Array(rasterWidth * rasterHeight)
  const valid = new Uint8Array(rasterWidth * rasterHeight)
  let sourceMin = Number.POSITIVE_INFINITY
  let sourceMax = Number.NEGATIVE_INFINITY
  let invalidCount = 0
  for (let outRow = 0; outRow < rasterHeight; outRow += 1) {
    const sourceRow = rasterHeight - 1 - outRow
    for (let col = 0; col < rasterWidth; col += 1) {
      const value = Number(raster[sourceRow * rasterWidth + col])
      const index = outRow * rasterWidth + col
      if (isNoData(value, noData)) {
        invalidCount += 1
        continue
      }
      heights[index] = value
      valid[index] = 1
      sourceMin = Math.min(sourceMin, value)
      sourceMax = Math.max(sourceMax, value)
    }
  }
  if (!Number.isFinite(sourceMin) || !Number.isFinite(sourceMax)) {
    throw new Error('DEM 没有有效高程采样。')
  }
  const fill = fillNearest(heights, valid, rasterWidth, rasterHeight)
  const datum = sourceMin
  let maxLocal = 0
  for (let index = 0; index < heights.length; index += 1) {
    heights[index] = Math.max(0, heights[index]! - datum)
    if (heights[index]! > maxLocal) {
      maxLocal = heights[index]!
    }
  }

  const anchorUtm = latLonToUtm(
    sidecar.anchor.latitudeDegrees,
    sidecar.anchor.longitudeDegrees,
    sidecar.crs.zone,
  )
  const minX = transform[0]! + 0.5 * cellX - anchorUtm.easting
  const maxX = transform[0]! + (rasterWidth - 0.5) * cellX - anchorUtm.easting
  const minZ = transform[3]! - (rasterHeight - 0.5) * cellY - anchorUtm.northing
  const maxZ = transform[3]! - 0.5 * cellY - anchorUtm.northing
  const filledRatio = rasterWidth * rasterHeight > 0 ? invalidCount / (rasterWidth * rasterHeight) : 0
  const grid: TerrainDemRuntimeGridData = {
    width: rasterWidth,
    height: rasterHeight,
    cellSizeX: cellX,
    cellSizeZ: cellY,
    minX,
    minZ,
    maxX,
    maxZ,
    minElevation: datum,
    maxElevation: datum + maxLocal,
    sourceMinElevation: sidecar.dem.minElevationMeters ?? sourceMin,
    sourceMaxElevation: sidecar.dem.maxElevationMeters ?? sourceMax,
    anchor: {
      latitudeDegrees: sidecar.anchor.latitudeDegrees,
      longitudeDegrees: sidecar.anchor.longitudeDegrees,
      groundElevationMeters: sidecar.anchor.groundElevationMeters,
    },
    crs: {
      epsg: sidecar.crs.epsg,
      zone: sidecar.crs.zone,
      hemisphere: sidecar.crs.hemisphere,
    },
    filledRatio,
    heights,
  }
  const warnings: string[] = []
  if (fill.filled > 0) {
    warnings.push(
      `DEM 空洞已用最近有效值填充：${fill.filled}/${rasterWidth * rasterHeight} (${(filledRatio * 100).toFixed(1)}%)。`,
    )
  }
  return {
    bytes: encodeTerrainDemRuntimeGridFile(grid),
    grid,
    warnings,
  }
}

