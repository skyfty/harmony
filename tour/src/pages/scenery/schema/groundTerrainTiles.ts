export type GroundTerrainTileKeyParts = {
  row: number
  column: number
}

export type GroundTerrainTileGridInput = {
  rows: number
  columns: number
  tileResolution: number
  terrainTilesRootPath: string
  collisionRootPath: string
}

export type GroundTerrainTileKeyGridInput = {
  rows: number
  columns: number
  tileResolution: number
}

export type GroundTerrainTileEntryLike = {
  tileKey: string
  row: number
  column: number
  path: string
  startRow: number
  startColumn: number
  rows: number
  columns: number
  collisionPath: string | null
}

export function formatGroundTerrainTileKey(row: number, column: number): string {
  return `${Math.trunc(row)}:${Math.trunc(column)}`
}

export function parseGroundTerrainTileKey(key: string): GroundTerrainTileKeyParts | null {
  const raw = typeof key === 'string' ? key.trim() : ''
  if (!raw) {
    return null
  }
  const parts = raw.split(':')
  if (parts.length !== 2) {
    return null
  }
  const row = Number.parseInt(parts[0] ?? '', 10)
  const column = Number.parseInt(parts[1] ?? '', 10)
  if (!Number.isFinite(row) || !Number.isFinite(column)) {
    return null
  }
  return {
    row: Math.trunc(row),
    column: Math.trunc(column),
  }
}

export function resolveGroundTerrainTileKeys(input: GroundTerrainTileKeyGridInput): string[] {
  const rows = Math.max(1, Math.trunc(input.rows))
  const columns = Math.max(1, Math.trunc(input.columns))
  const tileResolution = Math.max(1, Math.trunc(input.tileResolution))
  const tileCountRows = Math.max(1, Math.ceil(rows / tileResolution))
  const tileCountColumns = Math.max(1, Math.ceil(columns / tileResolution))
  const keys: string[] = []

  for (let tileRow = 0; tileRow < tileCountRows; tileRow += 1) {
    for (let tileColumn = 0; tileColumn < tileCountColumns; tileColumn += 1) {
      keys.push(formatGroundTerrainTileKey(tileRow, tileColumn))
    }
  }

  return keys
}

export function buildGroundTerrainTileEntries(input: GroundTerrainTileGridInput): GroundTerrainTileEntryLike[] {
  const rows = Math.max(1, Math.trunc(input.rows))
  const columns = Math.max(1, Math.trunc(input.columns))
  const tileResolution = Math.max(1, Math.trunc(input.tileResolution))
  const tileCountRows = Math.max(1, Math.ceil(rows / tileResolution))
  const tileCountColumns = Math.max(1, Math.ceil(columns / tileResolution))
  const entries: GroundTerrainTileEntryLike[] = []

  for (let tileRow = 0; tileRow < tileCountRows; tileRow += 1) {
    for (let tileColumn = 0; tileColumn < tileCountColumns; tileColumn += 1) {
      const startRow = tileRow * tileResolution
      const startColumn = tileColumn * tileResolution
      const tileRows = Math.min(tileResolution, rows - startRow)
      const tileColumns = Math.min(tileResolution, columns - startColumn)
      const tileKey = formatGroundTerrainTileKey(tileRow, tileColumn)
      entries.push({
        tileKey,
        row: tileRow,
        column: tileColumn,
        path: `${input.terrainTilesRootPath}tile_r${tileRow}_c${tileColumn}.bin`,
        startRow,
        startColumn,
        rows: tileRows,
        columns: tileColumns,
        collisionPath: `${input.collisionRootPath}tile_r${tileRow}_c${tileColumn}.bin`,
      })
    }
  }

  return entries
}