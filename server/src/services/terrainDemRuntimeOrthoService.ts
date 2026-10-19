import { fromArrayBuffer } from 'geotiff'
import {
  encodeTerrainDemRuntimeOrthoFile,
  TERRAIN_DEM_RUNTIME_ORTHO_MAX_SIZE,
  type TerrainDemRuntimeOrthoData,
} from '@harmony/schema/terrainDemRuntimeOrtho'
import type { TerrainDemPackageSidecar } from '@harmony/schema/terrainDemPackage'

export interface TerrainDemRuntimeOrthoBuildResult {
  bytes: Uint8Array
  ortho: TerrainDemRuntimeOrthoData
  sourceWidth: number
  sourceHeight: number
  warnings: string[]
}

function resolveTargetSize(width: number, height: number, maxSize: number): {
  width: number
  height: number
} {
  const scale = Math.min(
    1,
    Math.max(1, maxSize) / Math.max(width, height),
  )
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function downsampleNorthUpRgb(options: {
  raster: ArrayLike<number>
  sourceWidth: number
  sourceHeight: number
  samplesPerPixel: number
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
  const out = new Uint8Array(targetWidth * targetHeight * 3)
  const readChannel = (x: number, y: number, channel: number): number => {
    const sourceChannel = samplesPerPixel === 1 ? 0 : channel
    const value = Number(
      raster[(y * sourceWidth + x) * samplesPerPixel + sourceChannel] ?? 0,
    )
    return Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0
  }

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY0 = Math.floor((targetY * sourceHeight) / targetHeight)
    const sourceY1 = Math.max(
      sourceY0 + 1,
      Math.floor(((targetY + 1) * sourceHeight) / targetHeight),
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
          sums[0] += readChannel(x, y, 0)
          sums[1] += readChannel(x, y, 1)
          sums[2] += readChannel(x, y, 2)
          count += 1
        }
      }
      const offset = (targetY * targetWidth + targetX) * 3
      const divisor = Math.max(1, count)
      out[offset] = Math.round(sums[0]! / divisor)
      out[offset + 1] = Math.round(sums[1]! / divisor)
      out[offset + 2] = Math.round(sums[2]! / divisor)
    }
  }
  return out
}

function flipToSouthUp(
  northUpRgb: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = width * 3
  const out = new Uint8Array(northUpRgb.length)
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - 1 - row) * rowBytes
    out.set(
      northUpRgb.subarray(sourceOffset, sourceOffset + rowBytes),
      row * rowBytes,
    )
  }
  return out
}

/**
 * Converts the pack's north-up RGBA/RGB orthophoto into a compact, GPU-ready
 * texture. The runtime file stores rows south-to-north to match DEM texture UVs.
 */
export async function buildTerrainDemRuntimeOrtho(input: {
  orthoBytes: Uint8Array
  sidecar: TerrainDemPackageSidecar
  maxSize?: number
}): Promise<TerrainDemRuntimeOrthoBuildResult> {
  const sidecarOrtho = input.sidecar.ortho
  if (!sidecarOrtho) {
    throw new Error('DEM sidecar does not declare an orthophoto raster')
  }

  const bytes = new Uint8Array(input.orthoBytes.byteLength)
  bytes.set(input.orthoBytes)
  const tiff = await fromArrayBuffer(bytes.buffer as ArrayBuffer)
  const image = await tiff.getImage()
  const sourceWidth = image.getWidth()
  const sourceHeight = image.getHeight()
  if (
    sourceWidth !== sidecarOrtho.width
    || sourceHeight !== sidecarOrtho.height
  ) {
    throw new Error(
      `正射影像尺寸不一致：${sourceWidth}×${sourceHeight}，dem.json 为 ${sidecarOrtho.width}×${sidecarOrtho.height}。`,
    )
  }

  const samplesPerPixel = image.getSamplesPerPixel()
  if (samplesPerPixel !== 1 && samplesPerPixel !== 3 && samplesPerPixel !== 4) {
    throw new Error(`不支持的正射影像通道数：${samplesPerPixel}。`)
  }

  const transform = input.sidecar.geoTransform
  const origin = image.getOrigin()
  const resolution = image.getResolution()
  const tolerance = Math.max(1e-3, Math.abs(transform[1] ?? 1) * 1e-4)
  if (
    !origin
    || !resolution
    || Math.abs(Number(origin[0]) - transform[0]!) > tolerance
    || Math.abs(Number(origin[1]) - transform[3]!) > tolerance
    || !(Number(resolution[0]) > 0)
    || !(Number(resolution[1]) < 0)
    || Math.abs(Math.abs(transform[1]!) - sidecarOrtho.cellSizeMeters)
      > Math.max(1e-6, sidecarOrtho.cellSizeMeters * 0.005)
    || Math.abs(Math.abs(transform[5]!) - sidecarOrtho.cellSizeMeters)
      > Math.max(1e-6, sidecarOrtho.cellSizeMeters * 0.005)
  ) {
    throw new Error('正射影像必须是北向上、无旋转的栅格，并与 dem.json 地理变换一致。')
  }

  const raster = await image.readRasters({ interleave: true }) as unknown as ArrayLike<number>
  if (raster.length < sourceWidth * sourceHeight * samplesPerPixel) {
    throw new Error('正射影像栅格读取结果不完整。')
  }

  const target = resolveTargetSize(
    sourceWidth,
    sourceHeight,
    input.maxSize ?? TERRAIN_DEM_RUNTIME_ORTHO_MAX_SIZE,
  )
  const northUpRgb = downsampleNorthUpRgb({
    raster,
    sourceWidth,
    sourceHeight,
    samplesPerPixel,
    targetWidth: target.width,
    targetHeight: target.height,
  })
  const rgb = flipToSouthUp(northUpRgb, target.width, target.height)
  const ortho: TerrainDemRuntimeOrthoData = {
    width: target.width,
    height: target.height,
    rgb,
  }
  const warnings: string[] = []
  if (target.width !== sourceWidth || target.height !== sourceHeight) {
    warnings.push(
      `正射影像已从 ${sourceWidth}×${sourceHeight} 降采样到 ${target.width}×${target.height}。`,
    )
  }
  return {
    bytes: encodeTerrainDemRuntimeOrthoFile(ortho),
    ortho,
    sourceWidth,
    sourceHeight,
    warnings,
  }
}
