import fs from 'node:fs/promises'
import path from 'node:path'
import { fromArrayBuffer } from 'geotiff'

const GROUND_TERRAIN_CHUNK_SIZE_METERS = 100
const SQUARE_RESOLUTION_RELATIVE_TOLERANCE = 0.01

function normalizeBounds(raw) {
  if (!Array.isArray(raw) || raw.length < 4) {
    return null
  }
  const [west, south, east, north] = raw.map((value) => Number(value))
  if (![west, south, east, north].every(Number.isFinite)) {
    return null
  }
  return { west, south, east, north }
}

function normalizeResolution(raw) {
  if (!Array.isArray(raw) || raw.length < 2) {
    return null
  }
  const x = Math.abs(Number(raw[0]))
  const y = Math.abs(Number(raw[1]))
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(x > 0) || !(y > 0)) {
    return null
  }
  return { x, y }
}

function isSquareResolution(resolution) {
  const larger = Math.max(resolution.x, resolution.y)
  const smaller = Math.min(resolution.x, resolution.y)
  if (!(larger > 0) || !(smaller > 0)) {
    return false
  }
  return (larger - smaller) / larger <= SQUARE_RESOLUTION_RELATIVE_TOLERANCE
}

function createCenteredWorldBounds(spanX, spanY) {
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || !(spanX > 0) || !(spanY > 0)) {
    return null
  }
  return {
    minX: -spanX * 0.5,
    minY: -spanY * 0.5,
    maxX: spanX * 0.5,
    maxY: spanY * 0.5,
  }
}

function normalizeWorldBounds({ bounds, resolution, width, height }) {
  const widthSegments = Math.max(1, width - 1)
  const heightSegments = Math.max(1, height - 1)
  if (resolution) {
    return createCenteredWorldBounds(widthSegments * resolution.x, heightSegments * resolution.y)
  }
  if (!bounds) {
    return null
  }
  return createCenteredWorldBounds(Math.abs(bounds.east - bounds.west), Math.abs(bounds.north - bounds.south))
}

function computeSampleStepMeters(worldBounds, width, height) {
  if (!worldBounds) {
    return null
  }
  const widthSegments = Math.max(1, width - 1)
  const heightSegments = Math.max(1, height - 1)
  const stepX = Math.abs(worldBounds.maxX - worldBounds.minX) / widthSegments
  const stepY = Math.abs(worldBounds.maxY - worldBounds.minY) / heightSegments
  return Math.max(stepX, stepY)
}

function resolveTargetChunkResolution(sampleStepMeters, chunkSizeMeters = GROUND_TERRAIN_CHUNK_SIZE_METERS) {
  if (!Number.isFinite(sampleStepMeters) || !(sampleStepMeters > 0)) {
    return null
  }
  return Math.max(1, Math.min(2048, Math.round(chunkSizeMeters / sampleStepMeters)))
}

function resolveChunkRange(minWorld, maxWorld, originWorld, chunkSizeMeters = GROUND_TERRAIN_CHUNK_SIZE_METERS) {
  const epsilon = Math.max(1e-9, chunkSizeMeters * 1e-9)
  const startTile = Math.floor((minWorld - originWorld) / chunkSizeMeters)
  const endTile = Math.max(startTile, Math.floor((maxWorld - originWorld - epsilon) / chunkSizeMeters))
  return { startTile, endTile }
}

function formatChunkKey(tileRow, tileColumn) {
  return `${tileRow}:${tileColumn}`
}

function summarizeRaster(values, noDataValue) {
  let invalidSampleCount = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index])
    const isNoData = Number.isFinite(noDataValue) && Math.abs(value - noDataValue) <= 1e-6
    if (!Number.isFinite(value) || isNoData) {
      invalidSampleCount += 1
      continue
    }
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return {
    invalidSampleCount,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  }
}

async function inspectTif(filePath) {
  const absolutePath = path.resolve(filePath)
  const buffer = await fs.readFile(absolutePath)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const bbox = normalizeBounds(typeof image.getBoundingBox === 'function' ? image.getBoundingBox() : null)
  const resolution = normalizeResolution(typeof image.getResolution === 'function' ? image.getResolution() : null)
  const noDataValue = Number(typeof image.getGDALNoData === 'function' ? image.getGDALNoData() : Number.NaN)
  const rasters = await image.readRasters({ interleave: true })
  const rasterSummary = summarizeRaster(rasters, noDataValue)
  const worldBounds = normalizeWorldBounds({ bounds: bbox, resolution, width, height })
  const sampleStepMeters = computeSampleStepMeters(worldBounds, width, height)
  const targetChunkResolution = resolveTargetChunkResolution(sampleStepMeters)
  const chunkOrigin = -GROUND_TERRAIN_CHUNK_SIZE_METERS * 0.5
  const tileColumnRange = worldBounds
    ? resolveChunkRange(worldBounds.minX, worldBounds.maxX, chunkOrigin)
    : null
  const tileRowRange = worldBounds
    ? resolveChunkRange(worldBounds.minY, worldBounds.maxY, chunkOrigin)
    : null

  const occupiedChunkKeys = []
  if (tileColumnRange && tileRowRange) {
    for (let tileRow = tileRowRange.startTile; tileRow <= tileRowRange.endTile; tileRow += 1) {
      for (let tileColumn = tileColumnRange.startTile; tileColumn <= tileColumnRange.endTile; tileColumn += 1) {
        occupiedChunkKeys.push(formatChunkKey(tileRow, tileColumn))
      }
    }
  }

  const effectiveCellSize = targetChunkResolution ? GROUND_TERRAIN_CHUNK_SIZE_METERS / targetChunkResolution : null
  const sourceCenter = worldBounds
    ? {
        x: (worldBounds.minX + worldBounds.maxX) * 0.5,
        z: (worldBounds.minY + worldBounds.maxY) * 0.5,
      }
    : null

  const payload = {
    tifFile: {
      path: absolutePath,
      filename: path.basename(absolutePath),
      width,
      height,
      bbox,
      resolution,
      squarePixels: resolution ? isSquareResolution(resolution) : false,
      noDataValue: Number.isFinite(noDataValue) ? noDataValue : null,
      rasterSummary,
    },
    expectedConversion: {
      worldBounds,
      sampleStepMeters,
      targetChunkResolution,
      chunkSizeMeters: GROUND_TERRAIN_CHUNK_SIZE_METERS,
      chunkOrigin,
      tileColumnRange,
      tileRowRange,
      occupiedChunkCount: occupiedChunkKeys.length,
      occupiedChunkKeys,
      occupiedChunkKeysText: occupiedChunkKeys.join(', '),
    },
    validation: {
      sourceCenteredAtOrigin: sourceCenter ? Math.abs(sourceCenter.x) <= 1e-6 && Math.abs(sourceCenter.z) <= 1e-6 : false,
      sourceCenter,
      effectiveEditCellSize: effectiveCellSize,
      cellSizeMatchesSourceStep: Number.isFinite(effectiveCellSize) && Number.isFinite(sampleStepMeters)
        ? Math.abs(effectiveCellSize - sampleStepMeters) <= Math.max(1e-6, sampleStepMeters * 0.05)
        : false,
      detailLimitedByEditResolution: Number.isFinite(effectiveCellSize) && Number.isFinite(sampleStepMeters)
        ? effectiveCellSize > sampleStepMeters
        : null,
      sourceSamplesPerChunk: Number.isFinite(sampleStepMeters)
        ? GROUND_TERRAIN_CHUNK_SIZE_METERS / sampleStepMeters
        : null,
    },
  }

  console.log(JSON.stringify(payload, null, 2))
}

const inputPath = process.argv[2]

if (!inputPath) {
  console.error('Usage: node ./scripts/planning-dem-tif-inspect.mjs <tif-file-path>')
  process.exit(1)
}

inspectTif(inputPath).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})