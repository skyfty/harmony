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
  chunkCells = resolveGroundChunkCells(definition),
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