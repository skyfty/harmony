import type { GroundChunkCoord, GroundDynamicMesh, GroundHeightMap } from './core'

export const GROUND_TERRAIN_CHUNK_SIZE_METERS = 100

export const GROUND_HEIGHT_UNSET_VALUE = Number.NaN

export function getGroundVertexColumns(columns: number): number {
  return Math.max(1, Math.trunc(columns)) + 1
}

export function getGroundVertexRows(rows: number): number {
  return Math.max(1, Math.trunc(rows)) + 1
}

export function getGroundVertexCount(rows: number, columns: number): number {
  return getGroundVertexRows(rows) * getGroundVertexColumns(columns)
}

export function getGroundVertexIndex(columns: number, row: number, column: number): number {
  return row * getGroundVertexColumns(columns) + column
}

export function createGroundHeightMap(rows: number, columns: number, fill = GROUND_HEIGHT_UNSET_VALUE): GroundHeightMap {
  const map = new Float64Array(getGroundVertexCount(rows, columns))
  map.fill(fill)
  return map
}

export function cloneGroundHeightMap(
  source: ArrayLike<number> | null | undefined,
  rows: number,
  columns: number,
  fill = GROUND_HEIGHT_UNSET_VALUE,
): GroundHeightMap {
  const target = createGroundHeightMap(rows, columns, fill)
  if (!source) {
    return target
  }
  const limit = Math.min(target.length, source.length ?? 0)
  for (let index = 0; index < limit; index += 1) {
    target[index] = Number(source[index])
  }
  return target
}

export function ensureGroundHeightMap(
  source: ArrayLike<number> | null | undefined,
  rows: number,
  columns: number,
  fill = GROUND_HEIGHT_UNSET_VALUE,
): GroundHeightMap {
  const expectedLength = getGroundVertexCount(rows, columns)
  if (source && typeof source === 'object' && source.length === expectedLength) {
    return source as GroundHeightMap
  }
  return cloneGroundHeightMap(source, rows, columns, fill)
}

export type GroundLocalEditTileSource = 'manual' | 'dem' | 'mixed'

export interface GroundLocalEditTileData {
  key: string
  tileRow: number
  tileColumn: number
  tileSizeMeters: number
  resolution: number
  values: number[]
  source?: GroundLocalEditTileSource | null
  updatedAt?: number
}

export type GroundLocalEditTileMap = Record<string, GroundLocalEditTileData>

export function formatGroundLocalEditTileKey(tileRow: number, tileColumn: number): string {
  return `${Math.trunc(tileRow)}:${Math.trunc(tileColumn)}`
}

export function parseGroundLocalEditTileKey(key: string): { tileRow: number; tileColumn: number } | null {
  const raw = typeof key === 'string' ? key.trim() : ''
  if (!raw) {
    return null
  }
  const parts = raw.split(':')
  if (parts.length !== 2) {
    return null
  }
  const tileRow = Number.parseInt(parts[0] ?? '', 10)
  const tileColumn = Number.parseInt(parts[1] ?? '', 10)
  if (!Number.isFinite(tileRow) || !Number.isFinite(tileColumn)) {
    return null
  }
  return {
    tileRow: Math.trunc(tileRow),
    tileColumn: Math.trunc(tileColumn),
  }
}

export interface GroundWorldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface GroundChunkBounds {
  minChunkX: number
  maxChunkX: number
  minChunkZ: number
  maxChunkZ: number
}

function clampPositiveGroundMetric(value: number | null | undefined, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function clampFiniteGroundCoordinate(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function resolveInfiniteGroundGridOriginMeters(
  gridSizeMeters = GROUND_TERRAIN_CHUNK_SIZE_METERS,
): number {
  const safeGridSize = Number.isFinite(gridSizeMeters) && gridSizeMeters > 0
    ? gridSizeMeters
    : GROUND_TERRAIN_CHUNK_SIZE_METERS
  return -safeGridSize * 0.5
}

export function parseGroundChunkKey(value: string | null | undefined): GroundChunkCoord | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return null
  }
  const parts = normalized.split(':')
  if (parts.length !== 2) {
    return null
  }
  const chunkX = Number(parts[0])
  const chunkZ = Number(parts[1])
  if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
    return null
  }
  return {
    chunkX: Math.trunc(chunkX),
    chunkZ: Math.trunc(chunkZ),
  }
}

export function resolveGroundChunkCoordFromWorldPosition(
  worldX: number,
  worldZ: number,
  chunkSizeMeters = GROUND_TERRAIN_CHUNK_SIZE_METERS,
): GroundChunkCoord {
  const safeChunkSize = Number.isFinite(chunkSizeMeters) && chunkSizeMeters > 0
    ? chunkSizeMeters
    : GROUND_TERRAIN_CHUNK_SIZE_METERS
  const origin = resolveInfiniteGroundGridOriginMeters(safeChunkSize)
  return {
    chunkX: Math.floor((worldX - origin) / safeChunkSize),
    chunkZ: Math.floor((worldZ - origin) / safeChunkSize),
  }
}

export function resolveGroundEditTileSizeMeters(definition: Pick<GroundDynamicMesh, 'editTileSizeMeters' | 'cellSize'>): number {
  const fallbackCellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const explicit = Number(definition.editTileSizeMeters)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(fallbackCellSize, explicit)
  }
  return fallbackCellSize
}

export function resolveGroundEditTileResolution(definition: Pick<GroundDynamicMesh, 'editTileResolution'>): number {
  const explicit = Number(definition.editTileResolution)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.round(explicit))
  }
  return 1
}

export function resolveGroundEditCellSize(
  definition: Pick<GroundDynamicMesh, 'editTileSizeMeters' | 'editTileResolution' | 'cellSize'>,
): number {
  const tileSizeMeters = resolveGroundEditTileSizeMeters(definition)
  const resolution = resolveGroundEditTileResolution(definition)
  const fallbackCellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  return Math.max(Number.EPSILON, Math.min(fallbackCellSize, tileSizeMeters / resolution))
}

export function normalizeGroundWorldBounds(bounds: GroundWorldBounds | null | undefined): GroundWorldBounds | null {
  if (!bounds || typeof bounds !== 'object') {
    return null
  }
  const minX = clampFiniteGroundCoordinate(bounds.minX)
  const maxX = clampFiniteGroundCoordinate(bounds.maxX)
  const minZ = clampFiniteGroundCoordinate(bounds.minZ)
  const maxZ = clampFiniteGroundCoordinate(bounds.maxZ)
  if (minX === null || maxX === null || minZ === null || maxZ === null) {
    return null
  }
  const normalizedMinX = Math.min(minX, maxX)
  const normalizedMaxX = Math.max(minX, maxX)
  const normalizedMinZ = Math.min(minZ, maxZ)
  const normalizedMaxZ = Math.max(minZ, maxZ)
  if (normalizedMaxX - normalizedMinX <= Number.EPSILON || normalizedMaxZ - normalizedMinZ <= Number.EPSILON) {
    return null
  }
  return {
    minX: normalizedMinX,
    maxX: normalizedMaxX,
    minZ: normalizedMinZ,
    maxZ: normalizedMaxZ,
  }
}

function resolveGroundChunkWindowRadiusMeters(definition: Pick<GroundDynamicMesh, 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>): number {
  const chunkSizeMeters = clampPositiveGroundMetric(definition.chunkSizeMeters, GROUND_TERRAIN_CHUNK_SIZE_METERS)
  const radiusChunks = Math.max(
    1,
    Math.trunc(
      Number.isFinite(definition.renderRadiusChunks) && definition.renderRadiusChunks! > 0
        ? definition.renderRadiusChunks!
        : definition.collisionRadiusChunks ?? 0,
    ),
  )
  return chunkSizeMeters * radiusChunks
}

export function resolveGroundWorldBounds(
  definition: Pick<GroundDynamicMesh, 'worldBounds' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
): GroundWorldBounds {
  const normalizedBounds = normalizeGroundWorldBounds(definition.worldBounds)
  if (normalizedBounds) {
    return normalizedBounds
  }
  const spanMeters = Math.max(GROUND_TERRAIN_CHUNK_SIZE_METERS, resolveGroundChunkWindowRadiusMeters(definition) * 2)
  const halfSpan = spanMeters * 0.5
  return {
    minX: -halfSpan,
    maxX: halfSpan,
    minZ: -halfSpan,
    maxZ: halfSpan,
  }
}

export function resolveGroundWorkingGridSize(
  definition: Pick<GroundDynamicMesh, 'cellSize' | 'worldBounds' | 'chunkSizeMeters' | 'renderRadiusChunks' | 'collisionRadiusChunks'>,
): { rows: number; columns: number } {
  const cellSize = clampPositiveGroundMetric(definition.cellSize, 1)
  const bounds = resolveGroundWorldBounds(definition)
  return {
    rows: Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / cellSize)),
    columns: Math.max(1, Math.round((bounds.maxX - bounds.minX) / cellSize)),
  }
}
