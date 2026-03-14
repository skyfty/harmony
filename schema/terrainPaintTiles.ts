import { resolveGroundChunkCells } from './groundMesh'

type TerrainPaintGroundDefinition = {
  cellSize: number
  width: number
  depth: number
  rows: number
  columns: number
}

export type TerrainPaintChunkKeyParts = {
  chunkRow: number
  chunkColumn: number
}

export type TerrainPaintTileKeyParts = {
  tileRow: number
  tileColumn: number
}

export type TerrainPaintChunkBounds = {
  minX: number
  minZ: number
  width: number
  depth: number
}

export type TerrainPaintTileBounds = TerrainPaintChunkBounds

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1
  }
  return value
}

function clampFinite(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function formatTerrainPaintChunkKey(chunkRow: number, chunkColumn: number): string {
  return `${Math.trunc(chunkRow)}:${Math.trunc(chunkColumn)}`
}

export function parseTerrainPaintChunkKey(value: string | null | undefined): TerrainPaintChunkKeyParts | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return null
  }
  const [rowText, columnText] = normalized.split(':')
  const chunkRow = Number.parseInt(rowText ?? '', 10)
  const chunkColumn = Number.parseInt(columnText ?? '', 10)
  if (!Number.isFinite(chunkRow) || !Number.isFinite(chunkColumn)) {
    return null
  }
  return { chunkRow, chunkColumn }
}

export function formatTerrainPaintTileKey(tileRow: number, tileColumn: number): string {
  return `${Math.trunc(tileRow)}:${Math.trunc(tileColumn)}`
}

export function parseTerrainPaintTileKey(value: string | null | undefined): TerrainPaintTileKeyParts | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return null
  }
  const [rowText, columnText] = normalized.split(':')
  const tileRow = Number.parseInt(rowText ?? '', 10)
  const tileColumn = Number.parseInt(columnText ?? '', 10)
  if (!Number.isFinite(tileRow) || !Number.isFinite(tileColumn)) {
    return null
  }
  return { tileRow, tileColumn }
}

export function resolveTerrainPaintChunkBounds(
  definition: TerrainPaintGroundDefinition,
  chunkRow: number,
  chunkColumn: number,
  chunkCells = resolveGroundChunkCells(definition as Parameters<typeof resolveGroundChunkCells>[0]),
): TerrainPaintChunkBounds | null {
  const cellSize = clampFinite(definition.cellSize, 1)
  const normalizedChunkCells = Math.max(1, Math.trunc(chunkCells))
  const halfWidth = clampFinite(definition.width, 0) * 0.5
  const halfDepth = clampFinite(definition.depth, 0) * 0.5
  const startColumn = Math.max(0, Math.trunc(chunkColumn) * normalizedChunkCells)
  const startRow = Math.max(0, Math.trunc(chunkRow) * normalizedChunkCells)
  const effectiveColumns = Math.max(0, Math.min(normalizedChunkCells, Math.max(0, Math.trunc(definition.columns) - startColumn)))
  const effectiveRows = Math.max(0, Math.min(normalizedChunkCells, Math.max(0, Math.trunc(definition.rows) - startRow)))
  const width = effectiveColumns * cellSize
  const depth = effectiveRows * cellSize
  if (!(width > 0) || !(depth > 0)) {
    return null
  }
  return {
    minX: -halfWidth + startColumn * cellSize,
    minZ: -halfDepth + startRow * cellSize,
    width,
    depth,
  }
}

export function resolveTerrainPaintTilesPerAxis(chunkSizeMeters: number, tileWorldSize: number): number {
  const normalizedChunkSize = Math.max(0.000001, clampFinite(chunkSizeMeters, 1))
  const normalizedTileWorldSize = Math.max(0.25, clampFinite(tileWorldSize, 8))
  return Math.max(1, Math.ceil(normalizedChunkSize / normalizedTileWorldSize))
}

export function resolveTerrainPaintTileWorldBounds(
  chunkBounds: TerrainPaintChunkBounds,
  tileRow: number,
  tileColumn: number,
  tileWorldSize: number,
): TerrainPaintTileBounds {
  const tilesPerAxisX = resolveTerrainPaintTilesPerAxis(chunkBounds.width, tileWorldSize)
  const tilesPerAxisZ = resolveTerrainPaintTilesPerAxis(chunkBounds.depth, tileWorldSize)
  const normalizedTileColumn = Math.max(0, Math.min(tilesPerAxisX - 1, Math.trunc(tileColumn)))
  const normalizedTileRow = Math.max(0, Math.min(tilesPerAxisZ - 1, Math.trunc(tileRow)))
  const tileWidth = chunkBounds.width / tilesPerAxisX
  const tileDepth = chunkBounds.depth / tilesPerAxisZ
  return {
    minX: chunkBounds.minX + normalizedTileColumn * tileWidth,
    minZ: chunkBounds.minZ + normalizedTileRow * tileDepth,
    width: tileWidth,
    depth: tileDepth,
  }
}

export async function decodeTerrainPaintMaskTileToData(blob: Blob, resolution: number): Promise<Uint8ClampedArray> {
  const res = Math.max(1, Math.round(resolution))
  const expectedSingleChannelLength = res * res
  const expectedRgbaLength = expectedSingleChannelLength * 4
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  let payload = bytes
  if (bytes.length >= 10 && bytes[0] === 0x48 && bytes[1] === 0x57 && bytes[2] === 0x50 && bytes[3] === 0x31) {
    const view = new DataView(buffer)
    const storedRes = view.getUint16(4, true)
    const payloadLength = view.getUint32(6, true)
    const payloadOffset = 10
    if (storedRes !== res) {
      throw new Error(`Terrain paint mask tile resolution mismatch: expected ${res}, got ${storedRes}`)
    }
    if (payloadOffset + payloadLength > bytes.length) {
      throw new Error('Terrain paint mask tile payload truncated')
    }
    payload = bytes.subarray(payloadOffset, payloadOffset + payloadLength)
  }

  if (payload.length === expectedSingleChannelLength) {
    return new Uint8ClampedArray(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength))
  }
  if (payload.length === expectedRgbaLength) {
    const mask = new Uint8ClampedArray(expectedSingleChannelLength)
    for (let index = 0; index < expectedSingleChannelLength; index += 1) {
      mask[index] = payload[index * 4] ?? 0
    }
    return mask
  }
  throw new Error(`Unsupported terrain paint mask tile payload length: ${payload.length}`)
}

export function sampleTerrainPaintMaskTileValue(
  mask: Uint8ClampedArray | Uint8Array | null | undefined,
  resolution: number,
  u: number,
  v: number,
): number {
  if (!mask) {
    return 0
  }
  const res = Math.max(1, Math.round(resolution))
  if (mask.length < res * res) {
    return 0
  }
  const clampedU = clamp01(u)
  const clampedV = clamp01(v)
  const x = clampedU * Math.max(0, res - 1)
  const y = clampedV * Math.max(0, res - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(res - 1, x0 + 1)
  const y1 = Math.min(res - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const offset00 = y0 * res + x0
  const offset10 = y0 * res + x1
  const offset01 = y1 * res + x0
  const offset11 = y1 * res + x1
  const top = ((mask[offset00] ?? 0) / 255) * (1 - tx) + ((mask[offset10] ?? 0) / 255) * tx
  const bottom = ((mask[offset01] ?? 0) / 255) * (1 - tx) + ((mask[offset11] ?? 0) / 255) * tx
  return top * (1 - ty) + bottom * ty
}