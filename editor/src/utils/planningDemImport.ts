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

export interface PlanningDemImportOptions {
  minElevation?: number | null
  maxElevation?: number | null
  metersPerPixel?: number | null
  worldBoundsOverride?: PlanningTerrainWorldBounds | null
}

export interface PlanningDemWindowedGeoTiffSource {
  width: number
  height: number
  geographicBounds: PlanningTerrainGeographicBounds | null
  worldBounds: PlanningTerrainWorldBounds | null
  sampleStepMeters: number | null
  readWindow(options: {
    window: [number, number, number, number]
    width?: number
    height?: number
  }): Promise<ArrayLike<number>>
}

type PlanningDemResolution = {
  x: number
  y: number
}

export const PLANNING_PNG_HEIGHTMAP_CONTRACT = {
  seaLevelGray: 32,
  metersPerGray: 20,
  minElevation: -640,
  maxElevation: 4460,
} as const

const PLANNING_DEM_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSupportedImageHeightmapMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.startsWith('image/')
}

export function isPlanningDemGeoTiffSource(filename: string, mimeType: string | null | undefined): boolean {
  const normalizedName = filename.trim().toLowerCase()
  return normalizedName.endsWith('.tif')
    || normalizedName.endsWith('.tiff')
    || (typeof mimeType === 'string' && (mimeType.includes('tiff') || mimeType.includes('geotiff')))
}

export function isPlanningDemHeightmapImageSource(filename: string, mimeType: string | null | undefined): boolean {
  const normalizedName = filename.trim().toLowerCase()
  return isSupportedImageHeightmapMimeType(mimeType)
    || PLANNING_DEM_IMAGE_EXTENSIONS.some((extension) => normalizedName.endsWith(extension))
}

export function isSupportedPlanningDemSource(filename: string, mimeType: string | null | undefined): boolean {
  return isPlanningDemGeoTiffSource(filename, mimeType) || isPlanningDemHeightmapImageSource(filename, mimeType)
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

function normalizeResolution(raw: unknown): PlanningDemResolution | null {
  if (!Array.isArray(raw) || raw.length < 2) {
    return null
  }
  const [rawX, rawY] = raw
  if (!isFiniteNumber(rawX) || !isFiniteNumber(rawY)) {
    return null
  }
  const x = Math.abs(rawX)
  const y = Math.abs(rawY)
  if (x <= 1e-9 || y <= 1e-9) {
    return null
  }
  return { x, y }
}

function isGeographicCoordinateSpace(
  bounds: PlanningTerrainGeographicBounds | null,
  geoKeys: Record<string, unknown> | null | undefined,
): boolean {
  const modelType = typeof geoKeys?.GTModelTypeGeoKey === 'number' ? Number(geoKeys.GTModelTypeGeoKey) : null
  if (modelType === 2) {
    return true
  }
  if (modelType === 1) {
    return false
  }
  if (typeof geoKeys?.GeographicTypeGeoKey === 'number') {
    return true
  }
  if (typeof geoKeys?.ProjectedCSTypeGeoKey === 'number') {
    return false
  }
  if (!bounds) {
    return false
  }
  return Math.abs(bounds.west) <= 180
    && Math.abs(bounds.east) <= 180
    && Math.abs(bounds.south) <= 90
    && Math.abs(bounds.north) <= 90
}

function degreesToMeters(deltaLongitude: number, deltaLatitude: number, latitudeDegrees: number): { x: number; y: number } {
  const latitudeRadians = latitudeDegrees * (Math.PI / 180)
  const metersPerDegreeLatitude = 111_320
  const metersPerDegreeLongitude = Math.max(1e-6, Math.cos(latitudeRadians)) * metersPerDegreeLatitude
  return {
    x: Math.abs(deltaLongitude) * metersPerDegreeLongitude,
    y: Math.abs(deltaLatitude) * metersPerDegreeLatitude,
  }
}

function normalizeWorldBounds(options: {
  bounds: PlanningTerrainGeographicBounds | null
  resolution: PlanningDemResolution | null
  width: number
  height: number
  geographic: boolean
}): PlanningTerrainWorldBounds | null {
  const { bounds, resolution, width, height, geographic } = options
  const widthSegments = Math.max(1, width - 1)
  const heightSegments = Math.max(1, height - 1)

  if (resolution) {
    const centerLatitude = bounds ? (bounds.south + bounds.north) * 0.5 : 0
    const cellSize = geographic
      ? degreesToMeters(resolution.x, resolution.y, centerLatitude)
      : { x: resolution.x, y: resolution.y }
    return {
      minX: 0,
      minY: 0,
      maxX: widthSegments * cellSize.x,
      maxY: heightSegments * cellSize.y,
    }
  }

  if (!bounds) {
    return null
  }
  const centerLatitude = (bounds.south + bounds.north) * 0.5
  const span = geographic
    ? degreesToMeters(bounds.east - bounds.west, bounds.north - bounds.south, centerLatitude)
    : {
        x: Math.abs(bounds.east - bounds.west),
        y: Math.abs(bounds.north - bounds.south),
      }
  return {
    minX: 0,
    minY: 0,
    maxX: span.x,
    maxY: span.y,
  }
}

function computeSampleStepMeters(worldBounds: PlanningTerrainWorldBounds | null, width: number, height: number): number | null {
  if (!worldBounds) {
    return null
  }
  const widthSegments = Math.max(1, width - 1)
  const heightSegments = Math.max(1, height - 1)
  const stepX = Math.abs(worldBounds.maxX - worldBounds.minX) / widthSegments
  const stepY = Math.abs(worldBounds.maxY - worldBounds.minY) / heightSegments
  const validSteps = [stepX, stepY].filter((value) => Number.isFinite(value) && value > 0)
  return validSteps.length ? Math.max(...validSteps) : null
}

function normalizeWorldBoundsOverride(raw: PlanningTerrainWorldBounds | null | undefined): PlanningTerrainWorldBounds | null {
  if (!raw) {
    return null
  }
  const minX = Number(raw.minX)
  const minY = Number(raw.minY)
  const maxX = Number(raw.maxX)
  const maxY = Number(raw.maxY)
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }
  if (!(maxX > minX) || !(maxY > minY)) {
    return null
  }
  return { minX, minY, maxX, maxY }
}

function resolveImageHeightmapWorldBounds(
  width: number,
  height: number,
  options?: PlanningDemImportOptions,
): PlanningTerrainWorldBounds {
  const overriddenBounds = normalizeWorldBoundsOverride(options?.worldBoundsOverride ?? null)
  if (overriddenBounds) {
    return overriddenBounds
  }

  const metersPerPixel = Number(options?.metersPerPixel)
  if (Number.isFinite(metersPerPixel) && metersPerPixel > 0) {
    const halfWidth = Math.max(1, width - 1) * metersPerPixel * 0.5
    const halfHeight = Math.max(1, height - 1) * metersPerPixel * 0.5
    return {
      minX: -halfWidth,
      minY: -halfHeight,
      maxX: halfWidth,
      maxY: halfHeight,
    }
  }

  const halfWidth = Math.max(1, width - 1) * 0.5
  const halfHeight = Math.max(1, height - 1) * 0.5
  return {
    minX: -halfWidth,
    minY: -halfHeight,
    maxX: halfWidth,
    maxY: halfHeight,
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

export function decodePlanningPngHeightmapElevation(grayValue: number): number {
  const normalizedGrayValue = Math.max(0, Math.min(255, Math.round(grayValue)))
  return (normalizedGrayValue - PLANNING_PNG_HEIGHTMAP_CONTRACT.seaLevelGray) * PLANNING_PNG_HEIGHTMAP_CONTRACT.metersPerGray
}

function loadImageElementFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
      resolve(image)
    }
    image.onerror = () => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
      reject(new Error('Unable to decode heightmap image.'))
    }
    image.src = url
  })
}

async function parsePlanningHeightmapImageBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string | null,
  options?: PlanningDemImportOptions,
): Promise<PlanningDemImportResult> {
  const sourceFileHash = await computeSha256Hex(buffer)
  const imageBlob = new Blob([buffer], { type: mimeType ?? 'application/octet-stream' })
  const image = await loadImageElementFromBlob(imageBlob)
  const width = Math.max(1, Math.trunc(image.naturalWidth))
  const height = Math.max(1, Math.trunc(image.naturalHeight))
  if (width < 2 || height < 2) {
    throw new Error(`PNG heightmap validation failed: the image must be at least 2x2 pixels, but received ${width}x${height}. Re-export the heightmap from QGIS using the Harmony PNG DEM protocol.`)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Unable to create heightmap canvas context.')
  }
  context.drawImage(image, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const rasterData = new Float32Array(width * height)
  let nonGrayscalePixelCount = 0
  let translucentPixelCount = 0

  for (let index = 0; index < rasterData.length; index += 1) {
    const pixelOffset = index * 4
    const red = pixels[pixelOffset] ?? 0
    const green = pixels[pixelOffset + 1] ?? 0
    const blue = pixels[pixelOffset + 2] ?? 0
    const alpha = pixels[pixelOffset + 3] ?? 255
    if (Math.abs(red - green) > 1 || Math.abs(red - blue) > 1 || Math.abs(green - blue) > 1) {
      nonGrayscalePixelCount += 1
    }
    if (alpha < 255) {
      translucentPixelCount += 1
    }
    rasterData[index] = decodePlanningPngHeightmapElevation(red)
  }

  if (nonGrayscalePixelCount > 0 || translucentPixelCount > 0) {
    const issues: string[] = []
    if (nonGrayscalePixelCount > 0) {
      issues.push(`${nonGrayscalePixelCount} non-grayscale pixels`)
    }
    if (translucentPixelCount > 0) {
      issues.push(`${translucentPixelCount} translucent pixels`)
    }
    throw new Error(`PNG heightmap validation failed: found ${issues.join(' and ')}. Export a fully opaque grayscale PNG from QGIS using the Harmony PNG DEM protocol (gray 32 = 0m, 20m per gray).`)
  }

  const preview = sampleRasterToPreview(
    rasterData,
    width,
    height,
    PLANNING_PNG_HEIGHTMAP_CONTRACT.minElevation,
    PLANNING_PNG_HEIGHTMAP_CONTRACT.maxElevation,
  )
  const worldBounds = resolveImageHeightmapWorldBounds(width, height, options)

  return {
    sourceFileHash,
    filename,
    mimeType,
    width,
    height,
    rasterData,
    minElevation: PLANNING_PNG_HEIGHTMAP_CONTRACT.minElevation,
    maxElevation: PLANNING_PNG_HEIGHTMAP_CONTRACT.maxElevation,
    sampleStepMeters: computeSampleStepMeters(worldBounds, width, height),
    geographicBounds: null,
    worldBounds,
    preview,
    orthophoto: null,
  }
}

async function parsePlanningGeoTiffBuffer(buffer: ArrayBuffer, filename: string, mimeType: string | null): Promise<PlanningDemImportResult> {
  const sourceFileHash = await computeSha256Hex(buffer)
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const rasters = await readFirstBandRasters(image)
  const { min, max } = computeMinMax(rasters)
  const bbox = normalizeBounds(typeof image.getBoundingBox === 'function' ? image.getBoundingBox() : null)
  const resolution = normalizeResolution(typeof image.getResolution === 'function' ? image.getResolution() : null)
  const geoKeys = typeof image.getGeoKeys === 'function' ? image.getGeoKeys() : null
  const geographic = isGeographicCoordinateSpace(bbox, geoKeys)
  const worldBounds = normalizeWorldBounds({
    bounds: bbox,
    resolution,
    width,
    height,
    geographic,
  })
  const preview = min !== null && max !== null ? sampleRasterToPreview(rasters, width, height, min, max) : null
  const sampleStepMeters = computeSampleStepMeters(worldBounds, width, height)
  if (!worldBounds || !sampleStepMeters) {
    throw new Error('GeoTIFF validation failed: unable to determine world scale from GeoTIFF metadata. Re-export the DEM with valid georeferencing in QGIS, or convert it to a PNG heightmap and provide meters-per-pixel during import.')
  }

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
    worldBounds,
    preview,
    orthophoto: null,
  }
}

async function parsePlanningDemBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string | null,
  options?: PlanningDemImportOptions,
): Promise<PlanningDemImportResult> {
  if (isPlanningDemGeoTiffSource(filename, mimeType)) {
    return parsePlanningGeoTiffBuffer(buffer, filename, mimeType)
  }
  if (isPlanningDemHeightmapImageSource(filename, mimeType)) {
    return parsePlanningHeightmapImageBuffer(buffer, filename, mimeType, options)
  }
  throw new Error('Only GeoTIFF or image heightmap files are supported for DEM import.')
}

export async function parsePlanningDemFile(file: File, options?: PlanningDemImportOptions): Promise<PlanningDemImportResult> {
  const buffer = await file.arrayBuffer()
  return parsePlanningDemBuffer(buffer, file.name, file.type || null, options)
}

export async function parsePlanningDemBlob(
  blob: Blob,
  filename = 'DEM',
  mimeType: string | null = blob.type || null,
  options?: PlanningDemImportOptions,
): Promise<PlanningDemImportResult> {
  const buffer = await blob.arrayBuffer()
  return parsePlanningDemBuffer(buffer, filename, mimeType, options)
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

export async function openPlanningDemWindowedGeoTiffSource(
  blob: Blob,
  filename = 'DEM',
  mimeType: string | null = blob.type || null,
): Promise<PlanningDemWindowedGeoTiffSource | null> {
  if (!isPlanningDemGeoTiffSource(filename, mimeType)) {
    return null
  }
  const buffer = await blob.arrayBuffer()
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const bbox = normalizeBounds(typeof image.getBoundingBox === 'function' ? image.getBoundingBox() : null)
  const resolution = normalizeResolution(typeof image.getResolution === 'function' ? image.getResolution() : null)
  const geoKeys = typeof image.getGeoKeys === 'function' ? image.getGeoKeys() : null
  const geographic = isGeographicCoordinateSpace(bbox, geoKeys)
  const worldBounds = normalizeWorldBounds({
    bounds: bbox,
    resolution,
    width,
    height,
    geographic,
  })
  const sampleStepMeters = computeSampleStepMeters(worldBounds, width, height)
  return {
    width,
    height,
    geographicBounds: bbox,
    worldBounds,
    sampleStepMeters,
    async readWindow(options: { window: [number, number, number, number]; width?: number; height?: number }): Promise<ArrayLike<number>> {
      const rasters = await image.readRasters({
        window: options.window,
        width: options.width,
        height: options.height,
        interleave: true,
        resampleMethod: 'bilinear',
      })
      if (Array.isArray(rasters)) {
        return rasters[0] as ArrayLike<number>
      }
      return rasters as ArrayLike<number>
    },
  }
}