import { deflateSync, inflateSync } from 'fflate'

export const TERRAIN_DEM_RUNTIME_ORTHO_MAGIC = 0x484f5254
export const TERRAIN_DEM_RUNTIME_ORTHO_VERSION = 1
export const TERRAIN_DEM_RUNTIME_ORTHO_FORMAT = 'hort-v1' as const
export const TERRAIN_DEM_RUNTIME_ORTHO_MAX_SIZE = 2048
const HEADER_BYTES = 32
const CHANNELS = 3

/**
 * Runtime orthophoto payload. Rows are stored south-to-north and columns
 * west-to-east so row 0 maps to texture V=0 for the runtime DEM mesh.
 */
export interface TerrainDemRuntimeOrthoData {
  width: number
  height: number
  rgb: Uint8Array
}

function finiteDimension(value: unknown, label: string): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 1_000_000) {
    throw new Error(`DEM runtime ortho ${label} is invalid`)
  }
  return Math.floor(numeric)
}

export function encodeTerrainDemRuntimeOrtho(
  data: TerrainDemRuntimeOrthoData,
): Uint8Array {
  const width = finiteDimension(data.width, 'width')
  const height = finiteDimension(data.height, 'height')
  if (data.rgb.length !== width * height * CHANNELS) {
    throw new Error('DEM runtime ortho RGB byte count does not match dimensions')
  }
  const bytes = new Uint8Array(HEADER_BYTES + data.rgb.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, TERRAIN_DEM_RUNTIME_ORTHO_MAGIC, false)
  view.setUint32(4, TERRAIN_DEM_RUNTIME_ORTHO_VERSION, true)
  view.setUint32(8, CHANNELS, true)
  view.setUint32(12, width, true)
  view.setUint32(16, height, true)
  bytes.set(data.rgb, HEADER_BYTES)
  return bytes
}

export function decodeTerrainDemRuntimeOrtho(
  bytes: Uint8Array,
): TerrainDemRuntimeOrthoData {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES) {
    throw new Error('DEM runtime ortho is too short')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, false) !== TERRAIN_DEM_RUNTIME_ORTHO_MAGIC) {
    throw new Error('DEM runtime ortho magic mismatch')
  }
  const version = view.getUint32(4, true)
  if (version !== TERRAIN_DEM_RUNTIME_ORTHO_VERSION) {
    throw new Error(`DEM runtime ortho version ${version} is not supported`)
  }
  if (view.getUint32(8, true) !== CHANNELS) {
    throw new Error('DEM runtime ortho channel count is not supported')
  }
  const width = view.getUint32(12, true)
  const height = view.getUint32(16, true)
  const expectedBytes = HEADER_BYTES + width * height * CHANNELS
  if (width < 1 || height < 1 || bytes.byteLength < expectedBytes) {
    throw new Error('DEM runtime ortho payload is truncated or invalid')
  }
  return {
    width,
    height,
    rgb: bytes.slice(HEADER_BYTES, expectedBytes),
  }
}

export function encodeTerrainDemRuntimeOrthoFile(
  data: TerrainDemRuntimeOrthoData,
): Uint8Array {
  return deflateSync(encodeTerrainDemRuntimeOrtho(data), { level: 6 })
}

export function decodeTerrainDemRuntimeOrthoFile(
  bytes: Uint8Array,
): TerrainDemRuntimeOrthoData {
  return decodeTerrainDemRuntimeOrtho(inflateSync(bytes))
}

/** Expands opaque RGB to the RGBA layout expected by Three.js DataTexture. */
export function terrainDemRuntimeOrthoToRgba(
  data: TerrainDemRuntimeOrthoData,
): Uint8Array {
  const pixelCount = data.width * data.height
  if (data.rgb.length !== pixelCount * CHANNELS) {
    throw new Error('DEM runtime ortho RGB byte count does not match dimensions')
  }
  const rgba = new Uint8Array(pixelCount * 4)
  for (let source = 0, target = 0; source < data.rgb.length; source += 3, target += 4) {
    rgba[target] = data.rgb[source]!
    rgba[target + 1] = data.rgb[source + 1]!
    rgba[target + 2] = data.rgb[source + 2]!
    rgba[target + 3] = 255
  }
  return rgba
}

/**
 * The upload pipeline preserves missing orthophoto pixels as RGB 0. Return
 * their fraction so the editor can warn about incomplete aerial coverage.
 */
export function terrainDemRuntimeOrthoCoverage(
  data: TerrainDemRuntimeOrthoData,
): number {
  const pixelCount = data.width * data.height
  if (data.rgb.length !== pixelCount * CHANNELS) {
    throw new Error('DEM runtime ortho RGB byte count does not match dimensions')
  }
  if (pixelCount === 0) {
    return 0
  }
  let covered = 0
  for (let offset = 0; offset < data.rgb.length; offset += CHANNELS) {
    if (data.rgb[offset]! !== 0 || data.rgb[offset + 1]! !== 0 || data.rgb[offset + 2]! !== 0) {
      covered += 1
    }
  }
  return covered / pixelCount
}
