import { fromArrayBuffer } from 'geotiff'
import { decode as decodePng, hasPngSignature } from 'fast-png'
import type {
  PlanningTerrainDemData,
  PlanningTerrainDemHeightmapEncoding,
  PlanningTerrainDemHeightmapEncodingMode,
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
  heightmapEncoding?: PlanningTerrainDemHeightmapEncoding | null
  preview: PlanningDemPreviewResult | null
  orthophoto?: PlanningTerrainOrthophotoData | null
}

export interface PlanningDemImportOptions {
  minElevation?: number | null
  maxElevation?: number | null
  metersPerPixel?: number | null
  worldBoundsOverride?: PlanningTerrainWorldBounds | null
  heightmapEncoding?: PlanningTerrainDemHeightmapEncoding | null
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

const PLANNING_DEM_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
const DEFAULT_IMAGE_HEIGHTMAP_ELEVATION_SPAN = 255
export const DEFAULT_IMAGE_HEIGHTMAP_MIN_ELEVATION = -DEFAULT_IMAGE_HEIGHTMAP_ELEVATION_SPAN * 0.5
export const DEFAULT_IMAGE_HEIGHTMAP_MAX_ELEVATION = DEFAULT_IMAGE_HEIGHTMAP_ELEVATION_SPAN * 0.5
export const STRICT_QGIS_HEIGHTMAP_ZERO_CODE = 32768
export const STRICT_QGIS_HEIGHTMAP_METERS_PER_UNIT = 1

export function createStrictQgis16BitHeightmapEncoding(): PlanningTerrainDemHeightmapEncoding {
  return {
    version: 1,
    sourceFormat: 'png',
    mode: 'strict-qgis-16bit',
    bitDepth: 16,
    channels: 1,
    signed: true,
    zeroCode: STRICT_QGIS_HEIGHTMAP_ZERO_CODE,
    metersPerUnit: STRICT_QGIS_HEIGHTMAP_METERS_PER_UNIT,
  }
}

export function createCustomRangeHeightmapEncoding(bitDepth = 8, channels = 1): PlanningTerrainDemHeightmapEncoding {
  return {
    version: 1,
    sourceFormat: 'png',
    mode: 'custom-range',
    bitDepth: bitDepth === 16 ? 16 : 8,
    channels: Math.max(1, Math.trunc(channels)),
    signed: false,
    zeroCode: null,
    metersPerUnit: null,
  }
}

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

function cloneHeightmapEncoding(
  encoding: PlanningTerrainDemHeightmapEncoding | null | undefined,
): PlanningTerrainDemHeightmapEncoding | null {
  if (!encoding) {
    return null
  }
  return {
    version: 1,
    sourceFormat: 'png',
    mode: encoding.mode === 'custom-range' ? 'custom-range' : 'strict-qgis-16bit',
    bitDepth: encoding.bitDepth === 8 ? 8 : 16,
    channels: Math.max(1, Math.trunc(Number(encoding.channels) || 1)),
    signed: Boolean(encoding.signed),
    zeroCode: Number.isFinite(Number(encoding.zeroCode)) ? Number(encoding.zeroCode) : null,
    metersPerUnit: Number.isFinite(Number(encoding.metersPerUnit)) ? Number(encoding.metersPerUnit) : null,
  }
}

function resolveRequestedHeightmapEncoding(options?: PlanningDemImportOptions): PlanningTerrainDemHeightmapEncoding {
  const explicit = cloneHeightmapEncoding(options?.heightmapEncoding ?? null)
  if (explicit) {
    return explicit
  }
  return createStrictQgis16BitHeightmapEncoding()
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

export function resolveDefaultImageHeightmapElevationRange(): { minElevation: number; maxElevation: number } {
  return {
    minElevation: DEFAULT_IMAGE_HEIGHTMAP_MIN_ELEVATION,
    maxElevation: DEFAULT_IMAGE_HEIGHTMAP_MAX_ELEVATION,
  }
}

function mapImageHeightmapValueToElevation(value: number, minElevation: number, maxElevation: number): number {
  const normalized = Math.max(0, Math.min(1, value / DEFAULT_IMAGE_HEIGHTMAP_ELEVATION_SPAN))
  return minElevation + normalized * (maxElevation - minElevation)
}

function resolveImageHeightmapElevationRange(options?: PlanningDemImportOptions): { minElevation: number; maxElevation: number } {
  const minElevation = Number(options?.minElevation)
  const maxElevation = Number(options?.maxElevation)
  const defaults = resolveDefaultImageHeightmapElevationRange()
  const normalizedMin = Number.isFinite(minElevation) ? minElevation : defaults.minElevation
  const normalizedMax = Number.isFinite(maxElevation) ? maxElevation : defaults.maxElevation
  if (normalizedMax >= normalizedMin) {
    return {
      minElevation: normalizedMin,
      maxElevation: normalizedMax,
    }
  }
  return {
    minElevation: normalizedMax,
    maxElevation: normalizedMin,
  }
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

function parseStrictQgis16BitHeightmapPng(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string | null,
  sourceFileHash: string,
  options?: PlanningDemImportOptions,
): PlanningDemImportResult {
  const requestedEncoding = resolveRequestedHeightmapEncoding(options)
  const zeroCode = Number.isFinite(Number(requestedEncoding.zeroCode))
    ? Number(requestedEncoding.zeroCode)
    : STRICT_QGIS_HEIGHTMAP_ZERO_CODE
  const metersPerUnit = Number.isFinite(Number(requestedEncoding.metersPerUnit)) && Number(requestedEncoding.metersPerUnit) > 0
    ? Number(requestedEncoding.metersPerUnit)
    : STRICT_QGIS_HEIGHTMAP_METERS_PER_UNIT
  const isPng = hasPngSignature(new Uint8Array(buffer))
    || filename.trim().toLowerCase().endsWith('.png')
    || mimeType === 'image/png'
  if (!isPng) {
    throw new Error('PNG heightmap validation failed: strict QGIS mode only accepts 16-bit grayscale PNG files.')
  }

  const decoded = decodePng(buffer)
  const width = Math.max(1, Math.trunc(decoded.width))
  const height = Math.max(1, Math.trunc(decoded.height))
  if (width < 2 || height < 2) {
    throw new Error(`PNG heightmap validation failed: the image must be at least 2x2 pixels, but received ${width}x${height}. Re-export the raster from QGIS with at least 2x2 samples.`)
  }
  if (decoded.depth !== 16) {
    throw new Error(`PNG heightmap validation failed: strict QGIS mode requires a 16-bit grayscale PNG, but received ${decoded.depth}-bit data.`)
  }
  if (decoded.channels !== 1) {
    throw new Error(`PNG heightmap validation failed: strict QGIS mode requires a single-channel grayscale PNG, but received ${decoded.channels} channel(s).`)
  }
  if (decoded.palette?.length) {
    throw new Error('PNG heightmap validation failed: indexed/palette PNG files are not supported. Export a true grayscale 16-bit PNG from QGIS.')
  }
  if (decoded.transparency?.length) {
    throw new Error('PNG heightmap validation failed: transparency is not allowed in strict QGIS heightmaps. Export a fully opaque grayscale PNG.')
  }
  if (!(decoded.data instanceof Uint16Array)) {
    throw new Error('PNG heightmap validation failed: decoded strict QGIS heightmap is not backed by 16-bit samples.')
  }

  const rasterData = new Float32Array(width * height)
  let minEncodedValue = Number.POSITIVE_INFINITY
  let maxEncodedValue = Number.NEGATIVE_INFINITY
  let minElevation = Number.POSITIVE_INFINITY
  let maxElevation = Number.NEGATIVE_INFINITY
  for (let index = 0; index < decoded.data.length; index += 1) {
    const encodedValue = decoded.data[index]!
    const elevation = (encodedValue - zeroCode) * metersPerUnit
    rasterData[index] = elevation
    if (encodedValue < minEncodedValue) minEncodedValue = encodedValue
    if (encodedValue > maxEncodedValue) maxEncodedValue = encodedValue
    if (elevation < minElevation) minElevation = elevation
    if (elevation > maxElevation) maxElevation = elevation
  }

  const heightmapEncoding: PlanningTerrainDemHeightmapEncoding = {
    version: 1,
    sourceFormat: 'png',
    mode: 'strict-qgis-16bit',
    bitDepth: 16,
    channels: 1,
    signed: true,
    zeroCode,
    metersPerUnit,
  }
  const preview = sampleRasterToPreview(rasterData, width, height, minElevation, maxElevation)
  const worldBounds = resolveImageHeightmapWorldBounds(width, height, options)

  return {
    sourceFileHash,
    filename,
    mimeType,
    width,
    height,
    rasterData,
    minElevation,
    maxElevation,
    sampleStepMeters: computeSampleStepMeters(worldBounds, width, height),
    geographicBounds: null,
    worldBounds,
    heightmapEncoding,
    preview,
    orthophoto: null,
  }
}

async function parsePlanningHeightmapImageBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string | null,
  options?: PlanningDemImportOptions,
): Promise<PlanningDemImportResult> {
  const sourceFileHash = await computeSha256Hex(buffer)
  const requestedEncoding = resolveRequestedHeightmapEncoding(options)
  if (requestedEncoding.mode === 'strict-qgis-16bit') {
    return parseStrictQgis16BitHeightmapPng(buffer, filename, mimeType, sourceFileHash, options)
  }
  const imageBlob = new Blob([buffer], { type: mimeType ?? 'application/octet-stream' })
  const image = await loadImageElementFromBlob(imageBlob)
  const width = Math.max(1, Math.trunc(image.naturalWidth))
  const height = Math.max(1, Math.trunc(image.naturalHeight))
  if (width < 2 || height < 2) {
    throw new Error(`PNG heightmap validation failed: the image must be at least 2x2 pixels, but received ${width}x${height}. Please fix the file in QGIS or Photoshop and re-export it.`)
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
  let actualMinValue = Number.POSITIVE_INFINITY
  let actualMaxValue = Number.NEGATIVE_INFINITY

  const grayscaleValues = new Float64Array(width * height)

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
    const grayscaleValue = 0.299 * red + 0.587 * green + 0.114 * blue
    grayscaleValues[index] = grayscaleValue
    actualMinValue = Math.min(actualMinValue, grayscaleValue)
    actualMaxValue = Math.max(actualMaxValue, grayscaleValue)
  }

  if (nonGrayscalePixelCount > 0 || translucentPixelCount > 0) {
    const issues: string[] = []
    if (nonGrayscalePixelCount > 0) {
      issues.push(`${nonGrayscalePixelCount} non-grayscale pixels`)
    }
    if (translucentPixelCount > 0) {
      issues.push(`${translucentPixelCount} translucent pixels`)
    }
    throw new Error(`PNG heightmap validation failed: found ${issues.join(' and ')}. Use QGIS or Photoshop to export a fully opaque grayscale PNG heightmap, then re-import it.`)
  }

  if (!Number.isFinite(actualMinValue) || !Number.isFinite(actualMaxValue)) {
    actualMinValue = 0
    actualMaxValue = 0
  }

  const normalizedDefaultRange = resolveImageHeightmapElevationRange({
    minElevation: DEFAULT_IMAGE_HEIGHTMAP_MIN_ELEVATION,
    maxElevation: DEFAULT_IMAGE_HEIGHTMAP_MAX_ELEVATION,
  })
  const explicitMinElevation = Number(options?.minElevation)
  const explicitMaxElevation = Number(options?.maxElevation)
  const hasExplicitElevationRange = Number.isFinite(explicitMinElevation) || Number.isFinite(explicitMaxElevation)
  const autoMinElevation = mapImageHeightmapValueToElevation(actualMinValue, normalizedDefaultRange.minElevation, normalizedDefaultRange.maxElevation)
  const autoMaxElevation = mapImageHeightmapValueToElevation(actualMaxValue, normalizedDefaultRange.minElevation, normalizedDefaultRange.maxElevation)
  const { minElevation, maxElevation } = hasExplicitElevationRange
    ? resolveImageHeightmapElevationRange(options)
    : {
        minElevation: autoMinElevation,
        maxElevation: autoMaxElevation,
      }
  const sourceRange = actualMaxValue - actualMinValue
  const targetRange = maxElevation - minElevation

  for (let index = 0; index < rasterData.length; index += 1) {
    const normalized = sourceRange <= Number.EPSILON
      ? 0
      : (grayscaleValues[index]! - actualMinValue) / sourceRange
    rasterData[index] = minElevation + Math.max(0, Math.min(1, normalized)) * targetRange
  }

  const preview = sampleRasterToPreview(rasterData, width, height, minElevation, maxElevation)
  const worldBounds = resolveImageHeightmapWorldBounds(width, height, options)
  const heightmapEncoding = createCustomRangeHeightmapEncoding(8, 1)

  return {
    sourceFileHash,
    filename,
    mimeType,
    width,
    height,
    rasterData,
    minElevation,
    maxElevation,
    sampleStepMeters: computeSampleStepMeters(worldBounds, width, height),
    geographicBounds: null,
    worldBounds,
    heightmapEncoding,
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
    heightmapEncoding: cloneHeightmapEncoding(result.heightmapEncoding ?? null),
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