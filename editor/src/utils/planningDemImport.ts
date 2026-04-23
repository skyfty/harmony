import { fromArrayBuffer } from 'geotiff'
import type {
  PlanningTerrainDemData,
  PlanningTerrainGeographicBounds,
  PlanningTerrainOrthophotoData,
  PlanningTerrainWorldBounds,
} from '@/types/planning-scene-data'
import { computeSha256Hex } from '@/utils/planningDemStorage'

export interface PlanningDemPreviewResult {
  dataUrl: string
  width: number
  height: number
}

export interface PlanningDemImportResult {
  sourceFileHash: string
  filename: string
  mimeType: string | null
  width: number
  height: number
  rasterData?: ArrayLike<number>
  minElevation: number | null
  maxElevation: number | null
  sampleStepMeters: number | null
  geographicBounds: PlanningTerrainGeographicBounds | null
  worldBounds: PlanningTerrainWorldBounds | null
  preview: PlanningDemPreviewResult | null
  orthophoto?: PlanningTerrainOrthophotoData | null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeBounds(raw: unknown): PlanningTerrainGeographicBounds | null {
  if (!Array.isArray(raw) || raw.length < 4) {
    return null
  }
  const [west, south, east, north] = raw
  if (!isFiniteNumber(west) || !isFiniteNumber(south) || !isFiniteNumber(east) || !isFiniteNumber(north)) {
    return null
  }
  return { west, south, east, north, crs: null }
}

function normalizeWorldBounds(raw: PlanningTerrainGeographicBounds | null): PlanningTerrainWorldBounds | null {
  if (!raw) {
    return null
  }
  return {
    minX: raw.west,
    minY: raw.south,
    maxX: raw.east,
    maxY: raw.north,
  }
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

function sampleRasterToPreview(values: ArrayLike<number>, width: number, height: number, minValue: number, maxValue: number): PlanningDemPreviewResult | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const maxPreviewSize = 512
  const previewScale = Math.min(1, maxPreviewSize / Math.max(width, height))
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
    const srcY = Math.min(height - 1, Math.floor((py / previewHeight) * height))
    for (let px = 0; px < previewWidth; px += 1) {
      const srcX = Math.min(width - 1, Math.floor((px / previewWidth) * width))
      const srcIndex = srcY * width + srcX
      const value = Number(values[srcIndex])
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
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: previewWidth,
    height: previewHeight,
  }
}

async function readFirstBandRasters(image: any): Promise<ArrayLike<number>> {
  const rasters = await image.readRasters({ interleave: true })
  if (Array.isArray(rasters)) {
    return rasters[0] as ArrayLike<number>
  }
  return rasters as ArrayLike<number>
}

async function parsePlanningDemBuffer(buffer: ArrayBuffer, filename: string, mimeType: string | null): Promise<PlanningDemImportResult> {
  const sourceFileHash = await computeSha256Hex(buffer)
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const rasters = await readFirstBandRasters(image)
  const { min, max } = computeMinMax(rasters)
  const bbox = normalizeBounds(typeof image.getBoundingBox === 'function' ? image.getBoundingBox() : null)
  const preview = min !== null && max !== null ? sampleRasterToPreview(rasters, width, height, min, max) : null
  const sampleStepMeters = bbox
    ? Math.max((bbox.east - bbox.west) / Math.max(1, width), (bbox.north - bbox.south) / Math.max(1, height))
    : null

  return {
    sourceFileHash,
    filename,
    mimeType,
    width,
    height,
    rasterData: rasters,
    minElevation: min,
    maxElevation: max,
    sampleStepMeters,
    geographicBounds: bbox,
    worldBounds: normalizeWorldBounds(bbox),
    preview,
    orthophoto: null,
  }
}

export async function parsePlanningDemFile(file: File): Promise<PlanningDemImportResult> {
  const buffer = await file.arrayBuffer()
  return parsePlanningDemBuffer(buffer, file.name, file.type || null)
}

export async function parsePlanningDemBlob(blob: Blob, filename = 'DEM', mimeType: string | null = blob.type || null): Promise<PlanningDemImportResult> {
  const buffer = await blob.arrayBuffer()
  return parsePlanningDemBuffer(buffer, filename, mimeType)
}

export function demImportResultToTerrainData(result: PlanningDemImportResult): PlanningTerrainDemData {
  return {
    version: 1,
    sourceFileHash: result.sourceFileHash,
    filename: result.filename,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    minElevation: result.minElevation,
    maxElevation: result.maxElevation,
    sampleStepMeters: result.sampleStepMeters,
    geographicBounds: result.geographicBounds,
    worldBounds: result.worldBounds,
    previewHash: result.preview ? result.sourceFileHash : null,
    previewSize: result.preview ? { width: result.preview.width, height: result.preview.height } : null,
    orthophoto: result.orthophoto ?? null,
  }
}