import { deflateSync, inflateSync } from 'fflate'

export const TERRAIN_DEM_RUNTIME_GRID_MAGIC = 0x4844454d
export const TERRAIN_DEM_RUNTIME_GRID_VERSION = 1
export const TERRAIN_DEM_RUNTIME_GRID_FORMAT = 'hdem-v1' as const
const HEADER_BYTES = 128

export interface TerrainDemRuntimeGridData {
  width: number
  height: number
  cellSizeX: number
  cellSizeZ: number
  /** Local XZ bounds relative to the sidecar anchor. */
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  /** Datum elevation; heights are local (0 = datum). */
  minElevation: number
  maxElevation: number
  sourceMinElevation: number
  sourceMaxElevation: number
  anchor: {
    latitudeDegrees: number
    longitudeDegrees: number
    groundElevationMeters: number
  }
  crs: {
    epsg: number
    zone: number
    hemisphere: 'north' | 'south'
  }
  filledRatio: number
  /** Row 0 south, column 0 west; local elevations relative to minElevation. */
  heights: Float32Array
}

function finite(value: unknown, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`DEM runtime grid ${label} is not finite`)
  }
  return numeric
}

export function encodeTerrainDemRuntimeGrid(grid: TerrainDemRuntimeGridData): Uint8Array {
  const width = Math.max(2, Math.floor(finite(grid.width, 'width')))
  const height = Math.max(2, Math.floor(finite(grid.height, 'height')))
  if (grid.heights.length !== width * height) {
    throw new Error('DEM runtime grid height count does not match dimensions')
  }
  const bytes = new Uint8Array(HEADER_BYTES + grid.heights.length * 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, TERRAIN_DEM_RUNTIME_GRID_MAGIC, false)
  view.setUint32(4, TERRAIN_DEM_RUNTIME_GRID_VERSION, true)
  view.setUint32(8, 0, true)
  view.setUint32(12, width, true)
  view.setUint32(16, height, true)
  view.setFloat32(20, grid.cellSizeX, true)
  view.setFloat32(24, grid.cellSizeZ, true)
  view.setFloat64(28, grid.minX, true)
  view.setFloat64(36, grid.minZ, true)
  view.setFloat64(44, grid.maxX, true)
  view.setFloat64(52, grid.maxZ, true)
  view.setFloat64(60, grid.minElevation, true)
  view.setFloat64(68, grid.maxElevation, true)
  view.setFloat64(76, grid.anchor.latitudeDegrees, true)
  view.setFloat64(84, grid.anchor.longitudeDegrees, true)
  view.setFloat64(92, grid.anchor.groundElevationMeters, true)
  view.setFloat64(100, grid.sourceMinElevation, true)
  view.setFloat64(108, grid.sourceMaxElevation, true)
  view.setFloat32(116, grid.filledRatio, true)
  view.setUint32(120, grid.crs.epsg, true)
  view.setUint16(124, grid.crs.zone, true)
  view.setUint8(126, grid.crs.hemisphere === 'south' ? 1 : 0)
  view.setUint8(127, 0)
  new Float32Array(bytes.buffer, HEADER_BYTES, grid.heights.length).set(grid.heights)
  return bytes
}

export function decodeTerrainDemRuntimeGrid(bytes: Uint8Array): TerrainDemRuntimeGridData {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES) {
    throw new Error('DEM runtime grid is too short')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, false) !== TERRAIN_DEM_RUNTIME_GRID_MAGIC) {
    throw new Error('DEM runtime grid magic mismatch')
  }
  const version = view.getUint32(4, true)
  if (version !== TERRAIN_DEM_RUNTIME_GRID_VERSION) {
    throw new Error(`DEM runtime grid version ${version} is not supported`)
  }
  const width = view.getUint32(12, true)
  const height = view.getUint32(16, true)
  if (width < 2 || height < 2 || width * height > 100_000_000) {
    throw new Error('DEM runtime grid dimensions are invalid')
  }
  const expectedBytes = HEADER_BYTES + width * height * 4
  if (bytes.byteLength < expectedBytes) {
    throw new Error('DEM runtime grid payload is truncated')
  }
  const heights = new Float32Array(width * height)
  const payload = new Uint8Array(width * height * 4)
  payload.set(bytes.subarray(HEADER_BYTES, HEADER_BYTES + width * height * 4))
  heights.set(new Float32Array(payload.buffer))
  const cellSizeX = view.getFloat32(20, true)
  const cellSizeZ = view.getFloat32(24, true)
  const minX = view.getFloat64(28, true)
  const minZ = view.getFloat64(36, true)
  const maxX = view.getFloat64(44, true)
  const maxZ = view.getFloat64(52, true)
  if (!(cellSizeX > 0) || !(cellSizeZ > 0)) {
    throw new Error('DEM runtime grid cell size is invalid')
  }
  return {
    width,
    height,
    cellSizeX,
    cellSizeZ,
    minX,
    minZ,
    maxX,
    maxZ,
    minElevation: view.getFloat64(60, true),
    maxElevation: view.getFloat64(68, true),
    sourceMinElevation: view.getFloat64(100, true),
    sourceMaxElevation: view.getFloat64(108, true),
    anchor: {
      latitudeDegrees: view.getFloat64(76, true),
      longitudeDegrees: view.getFloat64(84, true),
      groundElevationMeters: view.getFloat64(92, true),
    },
    crs: {
      epsg: view.getUint32(120, true),
      zone: view.getUint16(124, true),
      hemisphere: view.getUint8(126) === 1 ? 'south' : 'north',
    },
    filledRatio: view.getFloat32(116, true),
    heights,
  }
}

export function encodeTerrainDemRuntimeGridFile(grid: TerrainDemRuntimeGridData): Uint8Array {
  return deflateSync(encodeTerrainDemRuntimeGrid(grid), { level: 6 })
}

export function decodeTerrainDemRuntimeGridFile(bytes: Uint8Array): TerrainDemRuntimeGridData {
  return decodeTerrainDemRuntimeGrid(inflateSync(bytes))
}
