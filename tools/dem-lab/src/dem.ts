import { fromArrayBuffer } from 'geotiff'

export type DemBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type DemImportResult = {
  filename: string
  mimeType: string | null
  width: number
  height: number
  rasterData: Float32Array
  minElevation: number | null
  maxElevation: number | null
  geographicBounds: DemBounds | null
  worldBounds: {
    minX: number
    minZ: number
    maxX: number
    maxZ: number
  } | null
  previewDataUrl: string | null
}

export type DemSampleOptions = {
  filename?: string
  width?: number
  height?: number
  geographicBounds?: DemBounds
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeBounds(raw: unknown): DemBounds | null {
  if (!Array.isArray(raw) || raw.length < 4) {
    return null
  }
  const [west, south, east, north] = raw
  if (!isFiniteNumber(west) || !isFiniteNumber(south) || !isFiniteNumber(east) || !isFiniteNumber(north)) {
    return null
  }
  return { west, south, east, north }
}

function computeMinMax(values: ArrayLike<number>): { min: number | null; max: number | null } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index])
    if (!Number.isFinite(value)) {
      continue
    }
    if (value < min) min = value
    if (value > max) max = value
  }
  if (min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY) {
    return { min: null, max: null }
  }
  return { min, max }
}

function buildPreviewImage(values: ArrayLike<number>, width: number, height: number, minValue: number, maxValue: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const previewScale = Math.min(1, 512 / Math.max(width, height))
  const previewWidth = Math.max(1, Math.round(width * previewScale))
  const previewHeight = Math.max(1, Math.round(height * previewScale))
  const canvas = document.createElement('canvas')
  canvas.width = previewWidth
  canvas.height = previewHeight
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  const imageData = context.createImageData(previewWidth, previewHeight)
  const output = imageData.data
  const range = Math.max(1e-6, maxValue - minValue)

  for (let py = 0; py < previewHeight; py += 1) {
    const sourceY = Math.min(height - 1, Math.floor((py / previewHeight) * height))
    for (let px = 0; px < previewWidth; px += 1) {
      const sourceX = Math.min(width - 1, Math.floor((px / previewWidth) * width))
      const sourceIndex = sourceY * width + sourceX
      const value = Number(values[sourceIndex])
      const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, (value - minValue) / range)) : 0
      const shade = Math.round(normalized * 255)
      const target = (py * previewWidth + px) * 4
      output[target] = shade
      output[target + 1] = shade
      output[target + 2] = shade
      output[target + 3] = 255
    }
  }

  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export function buildPreviewDataUrl(values: ArrayLike<number>, width: number, height: number): string | null {
  const { min, max } = computeMinMax(values)
  if (min === null || max === null) {
    return null
  }
  return buildPreviewImage(values, width, height, min, max)
}

export function createBuiltInSampleDem(options: DemSampleOptions = {}): DemImportResult {
  const width = Math.max(2, Math.floor(options.width ?? 160))
  const height = Math.max(2, Math.floor(options.height ?? 128))
  const filename = options.filename ?? 'built-in-sample-dem.tif'
  const geographicBounds = options.geographicBounds ?? {
    west: 0,
    south: 0,
    east: 480,
    north: 384,
  }
  const rasterData = new Float32Array(width * height)

  let minElevation = Number.POSITIVE_INFINITY
  let maxElevation = Number.NEGATIVE_INFINITY
  for (let row = 0; row < height; row += 1) {
    const v = height <= 1 ? 0 : row / (height - 1)
    for (let column = 0; column < width; column += 1) {
      const u = width <= 1 ? 0 : column / (width - 1)
      const wave = Math.sin(u * Math.PI * 3.2) * 14 + Math.cos(v * Math.PI * 2.4) * 10
      const mound = Math.exp(-((u - 0.34) ** 2 + (v - 0.62) ** 2) * 18) * 42
      const ridge = Math.exp(-((u - 0.72) ** 2) * 30) * Math.sin(v * Math.PI * 5.5) * 9
      const basin = -Math.exp(-((u - 0.58) ** 2 + (v - 0.28) ** 2) * 26) * 18
      const heightValue = 120 + wave + mound + ridge + basin + (u - 0.5) * 8
      const index = row * width + column
      rasterData[index] = heightValue
      if (heightValue < minElevation) minElevation = heightValue
      if (heightValue > maxElevation) maxElevation = heightValue
    }
  }

  return {
    filename,
    mimeType: 'application/x-dem-sample',
    width,
    height,
    rasterData,
    minElevation,
    maxElevation,
    geographicBounds,
    worldBounds: {
      minX: geographicBounds.west,
      minZ: geographicBounds.south,
      maxX: geographicBounds.east,
      maxZ: geographicBounds.north,
    },
    previewDataUrl: buildPreviewImage(rasterData, width, height, minElevation, maxElevation),
  }
}

async function readFirstBandRasters(image: any): Promise<ArrayLike<number>> {
  const rasters = await image.readRasters({ interleave: true })
  if (Array.isArray(rasters)) {
    return rasters[0] as ArrayLike<number>
  }
  return rasters as ArrayLike<number>
}

export async function parseDemFile(file: File): Promise<DemImportResult> {
  const buffer = await file.arrayBuffer()
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const raster = await readFirstBandRasters(image)
  const rasterData = raster instanceof Float32Array ? raster : new Float32Array(raster.length)

  if (rasterData !== raster) {
    for (let index = 0; index < raster.length; index += 1) {
      rasterData[index] = Number(raster[index])
    }
  }

  const { min, max } = computeMinMax(rasterData)
  const geographicBounds = normalizeBounds(typeof image.getBoundingBox === 'function' ? image.getBoundingBox() : null)

  return {
    filename: file.name,
    mimeType: file.type || null,
    width,
    height,
    rasterData,
    minElevation: min,
    maxElevation: max,
    geographicBounds,
    worldBounds: geographicBounds
      ? {
        minX: geographicBounds.west,
        minZ: geographicBounds.south,
        maxX: geographicBounds.east,
        maxZ: geographicBounds.north,
      }
      : null,
    previewDataUrl: min !== null && max !== null ? buildPreviewImage(rasterData, width, height, min, max) : null,
  }
}