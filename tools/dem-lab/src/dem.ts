import { fromArrayBuffer } from 'geotiff'

export type DemBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type DemRenderSpace = {
  boundsWidth: number
  boundsDepth: number
  cellSizeX: number
  cellSizeZ: number
  units: 'meters' | 'source-units'
  source: 'projected-resolution' | 'projected-bounds' | 'geographic-bounds' | 'raster-fallback'
  sourceBoundsText: string | null
}

export type DemImportResult = {
  filename: string
  mimeType: string | null
  width: number
  height: number
  rasterData: Float32Array
  minElevation: number | null
  maxElevation: number | null
  invalidSampleCount: number
  noDataValue: number | null
  geographicBounds: DemBounds | null
  worldBounds: {
    minX: number
    minZ: number
    maxX: number
    maxZ: number
  } | null
  renderSpace: DemRenderSpace
  previewDataUrl: string | null
}

export type DemSampleOptions = {
  filename?: string
  width?: number
  height?: number
  geographicBounds?: DemBounds
}

export type DemImportProgress = {
  phase: 'reading' | 'parsing' | 'processing'
  loaded: number
  total: number
  label: string
}

type DemImageLike = {
  getGeoKeys?: () => Record<string, unknown> | null | undefined
  getResolution?: () => [number, number, number?]
  getGDALNoData?: () => number | null
  getBoundingBox?: () => unknown
  getWidth: () => number
  getHeight: () => number
  readRasters: (options: { interleave: true }) => Promise<ArrayLike<number> | ArrayLike<number>[]>
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

function normalizeResolution(raw: unknown): { x: number; y: number } | null {
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

function readFileAsArrayBuffer(file: File, onProgress?: (progress: DemImportProgress) => void): Promise<ArrayBuffer> {
  if (typeof FileReader === 'undefined') {
    return file.arrayBuffer()
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = (event) => {
      onProgress?.({
        phase: 'reading',
        loaded: event.loaded,
        total: event.total || file.size,
        label: 'Reading file',
      })
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read DEM file'))
    }
    reader.onabort = () => {
      reject(new Error('DEM file read was cancelled'))
    }
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer)
    }
    reader.readAsArrayBuffer(file)
  })
}

function formatBounds(bounds: DemBounds): string {
  return `${bounds.west.toFixed(6)}, ${bounds.south.toFixed(6)} -> ${bounds.east.toFixed(6)}, ${bounds.north.toFixed(6)}`
}

function isGeographicCoordinateSpace(bounds: DemBounds | null, geoKeys: Record<string, unknown> | null | undefined): boolean {
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

function degreesToMeters(deltaLongitude: number, deltaLatitude: number, latitudeDegrees: number): { x: number; z: number } {
  const latitudeRadians = latitudeDegrees * (Math.PI / 180)
  const metersPerDegreeLatitude = 111_320
  const metersPerDegreeLongitude = Math.max(1e-6, Math.cos(latitudeRadians)) * metersPerDegreeLatitude
  return {
    x: Math.abs(deltaLongitude) * metersPerDegreeLongitude,
    z: Math.abs(deltaLatitude) * metersPerDegreeLatitude,
  }
}

function buildRenderSpace(width: number, height: number, bounds: DemBounds | null, resolution: { x: number; y: number } | null, geographic: boolean): DemRenderSpace {
  const widthSegments = Math.max(1, width - 1)
  const heightSegments = Math.max(1, height - 1)

  if (resolution) {
    const centerLatitude = bounds ? (bounds.south + bounds.north) * 0.5 : 0
    const cellSize = geographic
      ? degreesToMeters(resolution.x, resolution.y, centerLatitude)
      : { x: resolution.x, z: resolution.y }
    return {
      boundsWidth: Math.max(1, widthSegments * cellSize.x),
      boundsDepth: Math.max(1, heightSegments * cellSize.z),
      cellSizeX: Math.max(1e-6, cellSize.x),
      cellSizeZ: Math.max(1e-6, cellSize.z),
      units: geographic ? 'meters' : 'source-units',
      source: geographic ? 'geographic-bounds' : 'projected-resolution',
      sourceBoundsText: bounds ? formatBounds(bounds) : null,
    }
  }

  if (bounds) {
    const centerLatitude = (bounds.south + bounds.north) * 0.5
    const span = geographic
      ? degreesToMeters(bounds.east - bounds.west, bounds.north - bounds.south, centerLatitude)
      : { x: Math.abs(bounds.east - bounds.west), z: Math.abs(bounds.north - bounds.south) }
    const boundsWidth = Math.max(1, span.x)
    const boundsDepth = Math.max(1, span.z)
    return {
      boundsWidth,
      boundsDepth,
      cellSizeX: Math.max(1e-6, boundsWidth / widthSegments),
      cellSizeZ: Math.max(1e-6, boundsDepth / heightSegments),
      units: geographic ? 'meters' : 'source-units',
      source: geographic ? 'geographic-bounds' : 'projected-bounds',
      sourceBoundsText: formatBounds(bounds),
    }
  }

  return {
    boundsWidth: Math.max(1, widthSegments),
    boundsDepth: Math.max(1, heightSegments),
    cellSizeX: 1,
    cellSizeZ: 1,
    units: 'source-units',
    source: 'raster-fallback',
    sourceBoundsText: null,
  }
}

function sanitizeRasterValues(
  values: ArrayLike<number>,
  noDataValue: number | null,
  onProgress?: (progress: DemImportProgress) => void,
): { rasterData: Float32Array; invalidSampleCount: number; minElevation: number | null; maxElevation: number | null } {
  const rasterData = new Float32Array(values.length)
  let invalidSampleCount = 0
  let minElevation = Number.POSITIVE_INFINITY
  let maxElevation = Number.NEGATIVE_INFINITY
  const chunkSize = Math.max(4096, Math.floor(values.length / 24))

  for (let index = 0; index < values.length; index += 1) {
    const numericValue = Number(values[index])
    const isNoData = noDataValue !== null && Math.abs(numericValue - noDataValue) <= 1e-6
    if (!Number.isFinite(numericValue) || isNoData) {
      rasterData[index] = Number.NaN
      invalidSampleCount += 1
      continue
    }
    rasterData[index] = numericValue
    if (numericValue < minElevation) minElevation = numericValue
    if (numericValue > maxElevation) maxElevation = numericValue

    if (onProgress && (index % chunkSize === 0 || index === values.length - 1)) {
      onProgress({
        phase: 'processing',
        loaded: index + 1,
        total: values.length,
        label: 'Analyzing raster',
      })
    }
  }

  return {
    rasterData,
    invalidSampleCount,
    minElevation: minElevation === Number.POSITIVE_INFINITY ? null : minElevation,
    maxElevation: maxElevation === Number.NEGATIVE_INFINITY ? null : maxElevation,
  }
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

  const renderSpace = buildRenderSpace(width, height, geographicBounds, null, false)

  return {
    filename,
    mimeType: 'application/x-dem-sample',
    width,
    height,
    rasterData,
    minElevation,
    maxElevation,
    invalidSampleCount: 0,
    noDataValue: null,
    geographicBounds,
    worldBounds: {
      minX: -renderSpace.boundsWidth * 0.5,
      minZ: -renderSpace.boundsDepth * 0.5,
      maxX: renderSpace.boundsWidth * 0.5,
      maxZ: renderSpace.boundsDepth * 0.5,
    },
    renderSpace,
    previewDataUrl: buildPreviewImage(rasterData, width, height, minElevation, maxElevation),
  }
}

async function readFirstBandRasters(image: DemImageLike): Promise<ArrayLike<number>> {
  const rasters = await image.readRasters({ interleave: true })
  if (Array.isArray(rasters)) {
    return rasters[0] as ArrayLike<number>
  }
  return rasters as ArrayLike<number>
}

export async function parseDemFile(file: File, onProgress?: (progress: DemImportProgress) => void): Promise<DemImportResult> {
  onProgress?.({ phase: 'reading', loaded: 0, total: file.size, label: 'Reading file' })
  const buffer = await readFileAsArrayBuffer(file, onProgress)
  onProgress?.({ phase: 'parsing', loaded: file.size, total: file.size, label: 'Decoding GeoTIFF' })
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage() as DemImageLike
  const width = image.getWidth()
  const height = image.getHeight()
  const raster = await readFirstBandRasters(image)
  const noDataValue = typeof image.getGDALNoData === 'function' ? image.getGDALNoData() : null
  onProgress?.({ phase: 'processing', loaded: 0, total: raster.length, label: 'Analyzing raster' })
  const { rasterData, invalidSampleCount, minElevation, maxElevation } = sanitizeRasterValues(
    raster,
    Number.isFinite(noDataValue) ? noDataValue : null,
    onProgress,
  )
  const geographicBounds = normalizeBounds(typeof image.getBoundingBox === 'function' ? image.getBoundingBox() : null)
  const geoKeys = typeof image.getGeoKeys === 'function' ? image.getGeoKeys() : null

  let resolution: { x: number; y: number } | null = null
  try {
    resolution = normalizeResolution(typeof image.getResolution === 'function' ? image.getResolution() : null)
  } catch {
    resolution = null
  }

  const isGeographic = isGeographicCoordinateSpace(geographicBounds, geoKeys)
  const renderSpace = buildRenderSpace(width, height, geographicBounds, resolution, isGeographic)

  return {
    filename: file.name,
    mimeType: file.type || null,
    width,
    height,
    rasterData,
    minElevation,
    maxElevation,
    invalidSampleCount,
    noDataValue: Number.isFinite(noDataValue) ? noDataValue : null,
    geographicBounds,
    worldBounds: {
      minX: -renderSpace.boundsWidth * 0.5,
      minZ: -renderSpace.boundsDepth * 0.5,
      maxX: renderSpace.boundsWidth * 0.5,
      maxZ: renderSpace.boundsDepth * 0.5,
    },
    renderSpace,
    previewDataUrl: minElevation !== null && maxElevation !== null ? buildPreviewImage(rasterData, width, height, minElevation, maxElevation) : null,
  }
}