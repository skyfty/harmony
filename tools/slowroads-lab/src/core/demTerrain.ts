import * as THREE from 'three'
import { fromArrayBuffer } from 'geotiff'
import type { Heightfield } from './heightfield'
import { fbm2, smoothstep } from './noise'
import { createTerrainBounds, type TerrainBounds } from './terrainBounds'
import { latLonToUtm } from './utm'

export interface DemAnchor {
  latitudeDegrees: number
  longitudeDegrees: number
  groundElevationMeters: number
}

export interface DemSidecar {
  version?: number
  generator?: string
  createdAt?: string
  anchor: DemAnchor
  crs: {
    type: string
    epsg: number
    zone: number
    hemisphere: 'north' | 'south'
    geographicEpsg?: number
  }
  geoTransform: [number, number, number, number, number, number]
  elevationDatum?: string
  dem: {
    file: string
    width: number
    height: number
    cellSizeMeters: number
    minElevationMeters: number | null
    maxElevationMeters: number | null
  }
  ortho?: unknown
  stats?: {
    sourceTriangleCount?: number
    sampledCellCount?: number
    filledCellCount?: number
    filledRatio?: number
    warnings?: string[]
  }
}

export interface DemTerrainGrid {
  cols: number
  rows: number
  cellSizeX: number
  cellSizeZ: number
  bounds: TerrainBounds
  /** Row 0 is south, column 0 is west; values are local metres above the datum. */
  heights: Float32Array
  minHeight: number
  maxHeight: number
  peakX: number
  peakZ: number
  /** Terrain-only mode places the conceptual water line below the lowest sample. */
  waterLevel: number
  detailEnabled: boolean
  detailAmplitude: number
  detailWavelength: number
  sourceMinElevation: number
  sourceMaxElevation: number
  sourceWidth: number
  sourceHeight: number
  sourceCellSize: number
  anchor: DemAnchor
  warnings: string[]
}

export interface DemTerrainBuildResult {
  grid: DemTerrainGrid
  decodeMs: number
  hybridMs: number
  totalMs: number
  warnings: string[]
}

export interface DemTerrainBuildOptions {
  detailEnabled?: boolean
  detailSeed?: number
  detailAmplitude?: number
  detailWavelength?: number
  detailOctaves?: number
}

export interface DemTerrainWorkerRequest {
  demBuffer: ArrayBuffer
  sidecar: DemSidecar
  options: DemTerrainBuildOptions
}

export type DemTerrainWorkerResponse =
  | {
      ok: true
      result: DemTerrainBuildResult
    }
  | {
      ok: false
      error: string
    }

const DEM_DETAIL_SEED = 0x51ed270b
const DEM_DETAIL_AMPLITUDE = 2.5
const DEM_DETAIL_WAVELENGTH = 96
const DEM_DETAIL_OCTAVES = 3
const DEM_WATER_OFFSET = -10

function finiteMinMax(values: ArrayLike<number>): { min: number; max: number; invalid: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let invalid = 0
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!
    if (!Number.isFinite(value)) {
      invalid += 1
      continue
    }
    if (value < min) min = value
    if (value > max) max = value
  }
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    invalid,
  }
}

function validateSidecar(sidecar: DemSidecar): void {
  if (!sidecar || typeof sidecar !== 'object') {
    throw new Error('DEM sidecar is missing or invalid.')
  }
  if (sidecar.crs?.type !== 'utm' || sidecar.crs.epsg !== 32646 || sidecar.crs.zone !== 46) {
    throw new Error(
      `DEM must be UTM zone 46N (EPSG:32646); received ${sidecar.crs?.type ?? 'unknown'} ` +
      `EPSG:${sidecar.crs?.epsg ?? '?'} zone ${sidecar.crs?.zone ?? '?'}.`,
    )
  }
  const transform = sidecar.geoTransform
  if (!Array.isArray(transform) || transform.length !== 6 || transform.some((value) => !Number.isFinite(value))) {
    throw new Error('DEM sidecar geoTransform must contain six finite numbers.')
  }
  if (Math.abs(transform[2]!) > 1e-9 || Math.abs(transform[4]!) > 1e-9) {
    throw new Error('Rotated or skewed DEM rasters are not supported.')
  }
  const cellX = Math.abs(transform[1]!)
  const cellY = Math.abs(transform[5]!)
  if (cellX <= 0 || cellY <= 0 || Math.abs(cellX - cellY) > Math.max(cellX, cellY) * 1e-4) {
    throw new Error(`DEM pixels must be square; received ${cellX} x ${cellY}.`)
  }
  if (Math.abs(cellX - sidecar.dem.cellSizeMeters) > 1e-3) {
    throw new Error(
      `DEM pixel size ${cellX}m does not match sidecar cellSizeMeters ${sidecar.dem.cellSizeMeters}m.`,
    )
  }
  if (sidecar.dem.width < 2 || sidecar.dem.height < 2) {
    throw new Error('DEM raster must be at least 2 x 2 samples.')
  }
}

/**
 * Reads the GeoTIFF, validates the sidecar, converts UTM cell centres into a
 * local +X east / +Z north frame, and bakes the optional high-frequency detail.
 */
export async function parseDemTerrain(
  demBuffer: ArrayBuffer,
  sidecar: DemSidecar,
  options: DemTerrainBuildOptions = {},
): Promise<DemTerrainBuildResult> {
  const start = performance.now()
  validateSidecar(sidecar)

  const tiff = await fromArrayBuffer(demBuffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  if (width !== sidecar.dem.width || height !== sidecar.dem.height) {
    throw new Error(
      `DEM raster is ${width}x${height}, but dem.json records ` +
      `${sidecar.dem.width}x${sidecar.dem.height}.`,
    )
  }
  const resolution = image.getResolution()
  const rasterCellX = Math.abs(Number(resolution[0]))
  const rasterCellY = Math.abs(Number(resolution[1]))
  if (
    !Number.isFinite(rasterCellX) || !Number.isFinite(rasterCellY)
    || Math.abs(rasterCellX - sidecar.dem.cellSizeMeters) > 1e-3
    || Math.abs(rasterCellY - sidecar.dem.cellSizeMeters) > 1e-3
  ) {
    throw new Error(
      `DEM GeoTIFF resolution ${rasterCellX}x${rasterCellY}m does not match ` +
      `dem.json ${sidecar.dem.cellSizeMeters}m.`,
    )
  }
  const raster = await image.readRasters({ interleave: true })
  const rasterValues = raster as ArrayLike<number>
  if (rasterValues.length !== width * height) {
    throw new Error(
      `DEM raster has ${rasterValues.length} values; expected ${width * height} for one band.`,
    )
  }
  const sourceRange = finiteMinMax(rasterValues)
  if (sourceRange.invalid > 0) {
    throw new Error(`DEM contains ${sourceRange.invalid} invalid elevation samples.`)
  }
  const decodeMs = performance.now() - start

  const hybridStart = performance.now()
  const anchorUtm = latLonToUtm(
    sidecar.anchor.latitudeDegrees,
    sidecar.anchor.longitudeDegrees,
    sidecar.crs.zone,
  )
  if (anchorUtm.epsg !== sidecar.crs.epsg) {
    throw new Error(`Anchor projects to EPSG:${anchorUtm.epsg}, sidecar records EPSG:${sidecar.crs.epsg}.`)
  }

  const transform = sidecar.geoTransform
  const originX = transform[0]!
  const originY = transform[3]!
  const cellX = Math.abs(transform[1]!)
  const cellY = Math.abs(transform[5]!)
  const anchorEasting = anchorUtm.easting
  const anchorNorthing = anchorUtm.northing
  const minX = originX + 0.5 * cellX - anchorEasting
  const maxX = originX + (width - 0.5) * cellX - anchorEasting
  const minZ = originY - (height - 0.5) * cellY - anchorNorthing
  const maxZ = originY - 0.5 * cellY - anchorNorthing
  const bounds = createTerrainBounds(minX, minZ, maxX, maxZ)

  const detailEnabled = options.detailEnabled ?? true
  const detailSeed = (options.detailSeed ?? DEM_DETAIL_SEED) >>> 0
  const detailAmplitude = options.detailAmplitude ?? DEM_DETAIL_AMPLITUDE
  const detailWavelength = options.detailWavelength ?? DEM_DETAIL_WAVELENGTH
  const detailOctaves = options.detailOctaves ?? DEM_DETAIL_OCTAVES
  const heights = new Float32Array(width * height)
  let rawMin = Number.POSITIVE_INFINITY
  let rawMax = Number.NEGATIVE_INFINITY
  let peakRow = 0
  let peakCol = 0

  const sample = (col: number, row: number): number => {
    const c = Math.max(0, Math.min(width - 1, col))
    const r = Math.max(0, Math.min(height - 1, row))
    return rasterValues[r * width + c]!
  }

  for (let outRow = 0; outRow < height; outRow += 1) {
    const sourceRow = height - 1 - outRow
    const z = minZ + outRow * cellY
    for (let col = 0; col < width; col += 1) {
      const x = minX + col * cellX
      const elevation = sample(col, sourceRow)
      let value = elevation
      if (detailEnabled) {
        const dx = (sample(col + 1, sourceRow) - sample(col - 1, sourceRow)) / (2 * cellX)
        const dz = (sample(col, sourceRow + 1) - sample(col, sourceRow - 1)) / (2 * cellY)
        const slope = Math.hypot(dx, dz)
        const slopeMask = smoothstep(1.2, 0.3, slope)
        const noise = (fbm2(detailSeed, x / detailWavelength, z / detailWavelength, detailOctaves) - 0.5) * 2
        value += noise * detailAmplitude * slopeMask
      }
      heights[outRow * width + col] = value
      if (value < rawMin) rawMin = value
      if (value > rawMax) {
        rawMax = value
        peakRow = outRow
        peakCol = col
      }
    }
  }

  // Keep local Y small and stable. Terrain-only mode uses a water line below
  // the datum so the lowest samples remain dry.
  const datum = Number.isFinite(rawMin) ? rawMin : sourceRange.min
  for (let i = 0; i < heights.length; i += 1) {
    heights[i] = heights[i]! - datum
  }
  const minHeight = 0
  const maxHeight = Math.max(0, rawMax - datum)
  const warnings = [...(sidecar.stats?.warnings ?? [])]
  if ((sidecar.stats?.filledRatio ?? 0) > 0.05) {
    warnings.unshift(
      `DEM sidecar reports ${(sidecar.stats!.filledRatio! * 100).toFixed(1)}% nearest-value fill; ` +
      'flat plateaus may be data artifacts.',
    )
  }

  const grid: DemTerrainGrid = {
    cols: width,
    rows: height,
    cellSizeX: cellX,
    cellSizeZ: cellY,
    bounds,
    heights,
    minHeight,
    maxHeight,
    peakX: minX + peakCol * cellX,
    peakZ: minZ + peakRow * cellY,
    waterLevel: DEM_WATER_OFFSET,
    detailEnabled,
    detailAmplitude,
    detailWavelength,
    sourceMinElevation: sourceRange.min,
    sourceMaxElevation: sourceRange.max,
    sourceWidth: width,
    sourceHeight: height,
    sourceCellSize: cellX,
    anchor: sidecar.anchor,
    warnings,
  }
  const hybridMs = performance.now() - hybridStart
  return {
    grid,
    decodeMs,
    hybridMs,
    totalMs: performance.now() - start,
    warnings,
  }
}

/** Bilinear lookup on the baked local grid. Outside the grid it clamps. */
export function sampleDemGridHeight(grid: DemTerrainGrid, x: number, z: number): number {
  const gx = (x - grid.bounds.minX) / grid.cellSizeX
  const gz = (z - grid.bounds.minZ) / grid.cellSizeZ
  const x0 = Math.floor(gx)
  const z0 = Math.floor(gz)
  const tx = gx - x0
  const tz = gz - z0
  const cx0 = Math.max(0, Math.min(grid.cols - 1, x0))
  const cx1 = Math.max(0, Math.min(grid.cols - 1, x0 + 1))
  const cz0 = Math.max(0, Math.min(grid.rows - 1, z0))
  const cz1 = Math.max(0, Math.min(grid.rows - 1, z0 + 1))
  const h00 = grid.heights[cz0 * grid.cols + cx0]!
  const h10 = grid.heights[cz0 * grid.cols + cx1]!
  const h01 = grid.heights[cz1 * grid.cols + cx0]!
  const h11 = grid.heights[cz1 * grid.cols + cx1]!
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
}

export function createDemHeightfield(grid: DemTerrainGrid): Heightfield {
  const worldSize = Math.max(grid.bounds.sizeX, grid.bounds.sizeZ)
  const halfSize = worldSize * 0.5
  return {
    bounds: grid.bounds,
    worldSize,
    halfSize,
    waterLevel: grid.waterLevel,
    minHeight: grid.minHeight,
    maxHeight: grid.maxHeight,
    inBounds(x: number, z: number, margin = 0): boolean {
      return this.contains(x, z, margin)
    },
    contains(x: number, z: number, margin = 0): boolean {
      return x >= grid.bounds.minX + margin && x <= grid.bounds.maxX - margin
        && z >= grid.bounds.minZ + margin && z <= grid.bounds.maxZ - margin
    },
    sampleHeight(x: number, z: number): number {
      return sampleDemGridHeight(grid, x, z)
    },
    sampleNormal(x: number, z: number, target?: THREE.Vector3): THREE.Vector3 {
      const hx0 = sampleDemGridHeight(grid, x - grid.cellSizeX, z)
      const hx1 = sampleDemGridHeight(grid, x + grid.cellSizeX, z)
      const hz0 = sampleDemGridHeight(grid, x, z - grid.cellSizeZ)
      const hz1 = sampleDemGridHeight(grid, x, z + grid.cellSizeZ)
      const dx = (hx1 - hx0) / (2 * grid.cellSizeX)
      const dz = (hz1 - hz0) / (2 * grid.cellSizeZ)
      const out = target ?? new THREE.Vector3()
      return out.set(-dx, 1, -dz).normalize()
    },
    sampleSlope(x: number, z: number): number {
      const normal = this.sampleNormal(x, z)
      return Math.max(0, 1 - normal.y)
    },
  }
}
