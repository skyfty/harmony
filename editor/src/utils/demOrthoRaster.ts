import { fromArrayBuffer } from 'geotiff'
import type { TerrainDemPackageSidecar } from '@schema/terrainDemPackage'

export interface DecodedDemOrthoRaster {
  width: number
  height: number
  rgb: Uint8Array
  sourceWidth: number
  sourceHeight: number
}

export function resolveDemOrthoTargetSize(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  const scale = Math.min(1, Math.max(1, maxSize) / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Converts a north-up GeoTIFF raster into the south-up RGB rows consumed by
 * Procedural Landscape DEM texture UVs. Sampling is area-averaged while
 * downsampling so large source images do not alias into the runtime texture.
 */
export function downsampleNorthUpOrthophotoToSouthUpRgb(options: {
  raster: ArrayLike<number>
  sourceWidth: number
  sourceHeight: number
  samplesPerPixel: number
  bitDepth?: number
  targetWidth: number
  targetHeight: number
}): Uint8Array {
  const {
    raster,
    sourceWidth,
    sourceHeight,
    samplesPerPixel,
    targetWidth,
    targetHeight,
  } = options
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(targetWidth > 0) || !(targetHeight > 0)) {
    throw new Error('正射影像尺寸必须为正数。')
  }
  if (samplesPerPixel !== 1 && samplesPerPixel !== 3 && samplesPerPixel !== 4) {
    throw new Error(`不支持的正射影像通道数：${samplesPerPixel}。`)
  }
  if (raster.length < sourceWidth * sourceHeight * samplesPerPixel) {
    throw new Error('正射影像栅格读取结果不完整。')
  }

  const bitDepth = Number(options.bitDepth)
  const safeBitDepth = Number.isFinite(bitDepth) && bitDepth > 0
    ? Math.min(16, Math.round(bitDepth))
    : 8
  const channelMaximum = safeBitDepth > 8 ? 2 ** safeBitDepth - 1 : 255
  const channelScale = channelMaximum > 0 ? 255 / channelMaximum : 1
  const output = new Uint8Array(targetWidth * targetHeight * 3)
  const readChannel = (x: number, y: number, channel: number): number => {
    const sourceChannel = samplesPerPixel === 1 ? 0 : channel
    const value = Number(raster[(y * sourceWidth + x) * samplesPerPixel + sourceChannel])
    return Number.isFinite(value)
      ? Math.max(0, Math.min(255, Math.round(value * channelScale)))
      : 0
  }

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    // Target row 0 is the southern edge, while GeoTIFF row 0 is northern.
    const sourceY0 = Math.max(
      0,
      sourceHeight - Math.floor(((targetY + 1) * sourceHeight) / targetHeight),
    )
    const sourceY1 = Math.max(
      sourceY0 + 1,
      sourceHeight - Math.floor((targetY * sourceHeight) / targetHeight),
    )
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX0 = Math.floor((targetX * sourceWidth) / targetWidth)
      const sourceX1 = Math.max(
        sourceX0 + 1,
        Math.floor(((targetX + 1) * sourceWidth) / targetWidth),
      )
      const sums = [0, 0, 0]
      let count = 0
      for (let y = sourceY0; y < sourceY1; y += 1) {
        for (let x = sourceX0; x < sourceX1; x += 1) {
          sums[0]! += readChannel(x, y, 0)
          sums[1]! += readChannel(x, y, 1)
          sums[2]! += readChannel(x, y, 2)
          count += 1
        }
      }
      const offset = (targetY * targetWidth + targetX) * 3
      const divisor = Math.max(1, count)
      output[offset] = Math.round(sums[0]! / divisor)
      output[offset + 1] = Math.round(sums[1]! / divisor)
      output[offset + 2] = Math.round(sums[2]! / divisor)
    }
  }
  return output
}

function readFirstBitsPerSample(image: { getBitsPerSample?: () => unknown }): number {
  const raw = image.getBitsPerSample?.() as unknown
  const value = Array.isArray(raw) ? raw[0] : raw
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(16, Math.round(numeric)) : 8
}

export async function decodeDemOrthoGeoTiff(options: {
  buffer: ArrayBuffer
  sidecar: TerrainDemPackageSidecar
  maxSize: number
}): Promise<DecodedDemOrthoRaster> {
  const sidecarOrtho = options.sidecar.ortho
  if (!sidecarOrtho) {
    throw new Error('dem.json 未声明 ortho.tif。')
  }

  const tiff = await fromArrayBuffer(options.buffer)
  const image = await tiff.getImage()
  const sourceWidth = image.getWidth()
  const sourceHeight = image.getHeight()
  if (sourceWidth !== sidecarOrtho.width || sourceHeight !== sidecarOrtho.height) {
    throw new Error(
      `正射影像尺寸不一致：${sourceWidth}×${sourceHeight}，dem.json 为 ${sidecarOrtho.width}×${sidecarOrtho.height}。`,
    )
  }
  const samplesPerPixel = image.getSamplesPerPixel()
  if (samplesPerPixel !== 1 && samplesPerPixel !== 3 && samplesPerPixel !== 4) {
    throw new Error(`不支持的正射影像通道数：${samplesPerPixel}。`)
  }

  const transform = options.sidecar.geoTransform
  const origin = image.getOrigin()
  const resolution = image.getResolution()
  const tolerance = Math.max(1e-3, Math.abs(transform[1]) * 1e-4)
  if (
    !origin
    || !resolution
    || Math.abs(Number(origin[0]) - transform[0]) > tolerance
    || Math.abs(Number(origin[1]) - transform[3]) > tolerance
    || !(Number(resolution[0]) > 0)
    || !(Number(resolution[1]) < 0)
    || Math.abs(Math.abs(transform[1]) - sidecarOrtho.cellSizeMeters)
      > Math.max(1e-6, sidecarOrtho.cellSizeMeters * 0.005)
    || Math.abs(Math.abs(transform[5]) - sidecarOrtho.cellSizeMeters)
      > Math.max(1e-6, sidecarOrtho.cellSizeMeters * 0.005)
  ) {
    throw new Error('正射影像必须是北向上、无旋转的方形像素栅格，并与 dem.json 地理变换一致。')
  }
  const geoKeys = image.getGeoKeys() as Record<string, unknown> | null
  const projectedEpsg = Number(geoKeys?.ProjectedCSTypeGeoKey)
  if (!Number.isFinite(projectedEpsg) || projectedEpsg !== options.sidecar.crs.epsg) {
    throw new Error(
      `正射影像投影与 dem.json 不一致：TIF 为 ${Number.isFinite(projectedEpsg) ? `EPSG:${projectedEpsg}` : '未知'}，dem.json 为 EPSG:${options.sidecar.crs.epsg}。`,
    )
  }

  const raster = await image.readRasters({ interleave: true }) as unknown as ArrayLike<number>
  const target = resolveDemOrthoTargetSize(sourceWidth, sourceHeight, options.maxSize)
  const rgb = downsampleNorthUpOrthophotoToSouthUpRgb({
    raster,
    sourceWidth,
    sourceHeight,
    samplesPerPixel,
    bitDepth: readFirstBitsPerSample(image),
    targetWidth: target.width,
    targetHeight: target.height,
  })
  return {
    width: target.width,
    height: target.height,
    rgb,
    sourceWidth,
    sourceHeight,
  }
}
