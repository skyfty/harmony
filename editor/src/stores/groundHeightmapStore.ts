import { defineStore } from 'pinia'
import {
  GROUND_HEIGHT_UNSET_VALUE,
  formatGroundLocalEditTileKey,
  getGroundVertexCount,
  getGroundVertexIndex,
  resolveGroundWorkingGridSize,
  type GroundHeightMap,
  type GroundContourBounds,
  type GroundDynamicMesh,
  type GroundLocalEditTileMap,
  type GroundLocalEditTileSource,
  type GroundPlanningMetadata,
  type SceneNode,
} from '@schema'
import { resolveGroundRuntimeChunkCells } from '@schema/groundMesh'
import {
  createGroundRuntimeMeshFromSidecar,
  serializeGroundHeightSidecarFromSampler,
  type GroundHeightSidecarSampler,
} from '@/utils/groundHeightSidecar'

const runtimeGroundHeightmaps = new Map<string, GroundHeightRuntimeState>()

export type GroundHeightTileState = {
  key: string
  startRow: number
  startColumn: number
  rows: number
  columns: number
  manualHeightMap: Float64Array
  planningHeightMap: Float64Array
}

export type GroundPlanningHeightRegion = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  vertexRows: number
  vertexColumns: number
  values: Float64Array
}

export type GroundLocalEditTileState = {
  key: string
  tileRow: number
  tileColumn: number
  tileSizeMeters: number
  resolution: number
  values: Float64Array
  source?: GroundLocalEditTileSource | null
  updatedAt?: number
}

export type GroundHeightRuntimeState = {
  nodeId: string
  rows: number
  columns: number
  tileResolution: number
  tiles: Map<string, GroundHeightTileState>
  localEditTiles: Map<string, GroundLocalEditTileState>
  planningMetadata: GroundPlanningMetadata | null
  optimizedMeshDirtyBounds: GroundContourBounds | null
  optimizedMeshDirtyChunkKeys: Set<string>
  runtimeHydratedHeightState?: 'pristine' | 'dirty'
  runtimeDisableOptimizedChunks?: boolean
  runtimeLoadedTileKeys?: string[]
  surfaceRevision?: number
  manualHeightOverrideCount: number
  planningHeightOverrideCount: number
  runtimeMeshVersion: number
  cachedRuntimeMeshVersion: number
  cachedRuntimeMesh?: GroundRuntimeDynamicMesh
  cachedManualHeightMap?: GroundHeightMap
  cachedPlanningHeightMap?: GroundHeightMap
  cachedLocalEditTiles?: GroundLocalEditTileMap | null
  cachedPlanningMetadata?: GroundPlanningMetadata | null
}

export type GroundRuntimeDynamicMesh = GroundDynamicMesh & {
  manualHeightMap: GroundHeightMap
  planningHeightMap: GroundHeightMap
  runtimeSampleHeightRegion?: (
    kind: 'manual' | 'planning',
    minRowInput: number,
    maxRowInput: number,
    minColumnInput: number,
    maxColumnInput: number,
  ) => {
    minRow: number
    maxRow: number
    minColumn: number
    maxColumn: number
    stride: number
    values: ArrayLike<number>
  }
  runtimeHydratedHeightState?: 'pristine' | 'dirty'
  runtimeDisableOptimizedChunks?: boolean
  runtimeLoadedTileKeys?: string[]
  runtimeManualHeightOverrideCount?: number
  runtimePlanningHeightOverrideCount?: number
}

function clampRegionIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return Math.floor(value)
}

function sampleRuntimeHeightRegion(
  state: GroundHeightRuntimeState,
  kind: 'manual' | 'planning',
  minRowInput: number,
  maxRowInput: number,
  minColumnInput: number,
  maxColumnInput: number,
): {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
  stride: number
  values: Float64Array
} {
  const minRow = clampRegionIndex(minRowInput, 0, state.rows)
  const maxRow = clampRegionIndex(maxRowInput, 0, state.rows)
  const minColumn = clampRegionIndex(minColumnInput, 0, state.columns)
  const maxColumn = clampRegionIndex(maxColumnInput, 0, state.columns)
  const stride = Math.max(0, maxColumn - minColumn + 1)
  const values = new Float64Array(Math.max(0, maxRow - minRow + 1) * stride).fill(GROUND_HEIGHT_UNSET_VALUE)

  if (stride <= 0 || maxRow < minRow || maxColumn < minColumn) {
    return { minRow, maxRow, minColumn, maxColumn, stride, values }
  }

  const minTileRow = Math.floor(minRow / Math.max(1, state.tileResolution))
  const maxTileRow = Math.floor(maxRow / Math.max(1, state.tileResolution))
  const minTileColumn = Math.floor(minColumn / Math.max(1, state.tileResolution))
  const maxTileColumn = Math.floor(maxColumn / Math.max(1, state.tileResolution))

  for (let tileRow = minTileRow; tileRow <= maxTileRow; tileRow += 1) {
    for (let tileColumn = minTileColumn; tileColumn <= maxTileColumn; tileColumn += 1) {
      const key = `${tileRow}:${tileColumn}`
      registerRuntimeLoadedTileKey(state, key)
      const tile = state.tiles.get(key)
      if (!tile) {
        continue
      }
      const rowStart = Math.max(minRow, tile.startRow)
      const rowEnd = Math.min(maxRow, tile.startRow + tile.rows)
      const columnStart = Math.max(minColumn, tile.startColumn)
      const columnEnd = Math.min(maxColumn, tile.startColumn + tile.columns)
      const source = kind === 'manual' ? tile.manualHeightMap : tile.planningHeightMap
      for (let row = rowStart; row <= rowEnd; row += 1) {
        const targetOffset = (row - minRow) * stride + (columnStart - minColumn)
        const sourceOffset = (row - tile.startRow) * (tile.columns + 1) + (columnStart - tile.startColumn)
        for (let column = columnStart; column <= columnEnd; column += 1) {
          values[targetOffset + (column - columnStart)] = source[sourceOffset + (column - columnStart)] ?? GROUND_HEIGHT_UNSET_VALUE
        }
      }
    }
  }

  return { minRow, maxRow, minColumn, maxColumn, stride, values }
}

function resolveRuntimeLoadedTileKeys(definition: GroundDynamicMesh): string[] {
  const existing = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys
  return Array.isArray(existing) ? [...existing] : []
}

function resolveRuntimeTileResolution(definition: GroundDynamicMesh): number {
  const gridSize = resolveGroundWorkingGridSize(definition)
  return Math.max(1, Math.trunc(definition.tileResolution ?? gridSize.rows))
}

function createGroundHeightTileState(input: {
  key: string
  startRow: number
  startColumn: number
  rows: number
  columns: number
}): GroundHeightTileState {
  const vertexCount = (Math.max(1, input.rows) + 1) * (Math.max(1, input.columns) + 1)
  return {
    key: input.key,
    startRow: input.startRow,
    startColumn: input.startColumn,
    rows: input.rows,
    columns: input.columns,
    manualHeightMap: new Float64Array(vertexCount).fill(GROUND_HEIGHT_UNSET_VALUE),
    planningHeightMap: new Float64Array(vertexCount).fill(GROUND_HEIGHT_UNSET_VALUE),
  }
}

function getGroundHeightTileKey(row: number, column: number, tileResolution: number): string {
  return `${Math.floor(Math.max(0, row) / Math.max(1, tileResolution))}:${Math.floor(Math.max(0, column) / Math.max(1, tileResolution))}`
}

function getOrCreateGroundHeightTile(
  state: GroundHeightRuntimeState,
  row: number,
  column: number,
): GroundHeightTileState {
  const key = getGroundHeightTileKey(row, column, state.tileResolution)
  registerRuntimeLoadedTileKey(state, key)
  const existing = state.tiles.get(key)
  if (existing) {
    return existing
  }
  const tileRow = Math.floor(Math.max(0, row) / state.tileResolution)
  const tileColumn = Math.floor(Math.max(0, column) / state.tileResolution)
  const startRow = tileRow * state.tileResolution
  const startColumn = tileColumn * state.tileResolution
  const tileRows = Math.min(state.tileResolution, state.rows - startRow)
  const tileColumns = Math.min(state.tileResolution, state.columns - startColumn)
  const created = createGroundHeightTileState({
    key,
    startRow,
    startColumn,
    rows: tileRows,
    columns: tileColumns,
  })
  state.tiles.set(key, created)
  return created
}

function registerRuntimeLoadedTileKey(state: GroundHeightRuntimeState, key: string): void {
  const target = (state.runtimeLoadedTileKeys ??= [])
  if (!target.includes(key)) {
    target.push(key)
  }
}

function setTileHeightMapValue(
  state: GroundHeightRuntimeState,
  tile: GroundHeightTileState,
  kind: 'manual' | 'planning',
  row: number,
  column: number,
  value: number,
): void {
  const localRow = row - tile.startRow
  const localColumn = column - tile.startColumn
  if (localRow < 0 || localColumn < 0 || localRow > tile.rows || localColumn > tile.columns) {
    return
  }
  const index = getGroundVertexIndex(tile.columns, localRow, localColumn)
  const previousValue = kind === 'manual' ? Number(tile.manualHeightMap[index]) : Number(tile.planningHeightMap[index])
  const nextValue = Number.isFinite(value) ? value : GROUND_HEIGHT_UNSET_VALUE
  updateHeightOverrideCount(state, kind, previousValue, nextValue)
  if (kind === 'manual') {
    tile.manualHeightMap[index] = nextValue
  } else {
    tile.planningHeightMap[index] = nextValue
  }
}

function getTileHeightMapValue(
  state: GroundHeightRuntimeState,
  kind: 'manual' | 'planning',
  row: number,
  column: number,
): number {
  const key = getGroundHeightTileKey(row, column, state.tileResolution)
  registerRuntimeLoadedTileKey(state, key)
  const tile = state.tiles.get(key)
  if (!tile) {
    return GROUND_HEIGHT_UNSET_VALUE
  }
  const localRow = row - tile.startRow
  const localColumn = column - tile.startColumn
  if (localRow < 0 || localColumn < 0 || localRow > tile.rows || localColumn > tile.columns) {
    return GROUND_HEIGHT_UNSET_VALUE
  }
  const index = getGroundVertexIndex(tile.columns, localRow, localColumn)
  const value = kind === 'manual' ? Number(tile.manualHeightMap[index]) : Number(tile.planningHeightMap[index])
  return Number.isFinite(value) ? value : GROUND_HEIGHT_UNSET_VALUE
}

function createHeightMapViewFromTiles(
  state: GroundHeightRuntimeState,
  kind: 'manual' | 'planning',
): GroundHeightMap {
  const length = getGroundVertexCount(state.rows, state.columns)
  const target = { length }
  return new Proxy(target, {
    get(object, property) {
      if (property === 'length') {
        return length
      }
      if (typeof property === 'string') {
        const index = Number(property)
        if (Number.isInteger(index) && index >= 0 && index < length) {
          const row = Math.floor(index / (state.columns + 1))
          const column = index % (state.columns + 1)
          return getTileHeightMapValue(state, kind, row, column)
        }
      }
      return Reflect.get(object, property)
    },
    set(object, property, value) {
      if (typeof property === 'string') {
        const index = Number(property)
        if (Number.isInteger(index) && index >= 0 && index < length) {
          const row = Math.floor(index / (state.columns + 1))
          const column = index % (state.columns + 1)
          const tile = getOrCreateGroundHeightTile(state, row, column)
          const numeric = Number(value)
            setTileHeightMapValue(state, tile, kind, row, column, Number.isFinite(numeric) ? numeric : GROUND_HEIGHT_UNSET_VALUE)
          return true
        }
      }
      return Reflect.set(object, property, value)
    },
  }) as unknown as GroundHeightMap
}

function syncFlatHeightMapIntoTiles(
  state: GroundHeightRuntimeState,
  source: ArrayLike<number>,
  kind: 'manual' | 'planning',
): void {
  for (let row = 0; row <= state.rows; row += 1) {
    for (let column = 0; column <= state.columns; column += 1) {
      const tile = getOrCreateGroundHeightTile(state, row, column)
      const value = source[getGroundVertexIndex(state.columns, row, column)] ?? GROUND_HEIGHT_UNSET_VALUE
      setTileHeightMapValue(state, tile, kind, row, column, value)
    }
  }
}

function asGroundDynamicMesh(node: SceneNode | null | undefined): GroundDynamicMesh | null {
  const definition = node?.dynamicMesh
  if (definition?.type !== 'Ground') {
    return null
  }
  return definition
}

function clonePlanningMetadata(metadata: GroundPlanningMetadata | null | undefined): GroundPlanningMetadata | null {
  if (!metadata) {
    return null
  }
  return {
    contourBounds: metadata.contourBounds
      ? {
          minRow: metadata.contourBounds.minRow,
          maxRow: metadata.contourBounds.maxRow,
          minColumn: metadata.contourBounds.minColumn,
          maxColumn: metadata.contourBounds.maxColumn,
        }
      : null,
    generatedAt: metadata.generatedAt,
    demSource: metadata.demSource
      ? {
          sourceFileHash: metadata.demSource.sourceFileHash ?? null,
          filename: metadata.demSource.filename ?? null,
          mimeType: metadata.demSource.mimeType ?? null,
          width: metadata.demSource.width,
          height: metadata.demSource.height,
          minElevation: metadata.demSource.minElevation ?? null,
          maxElevation: metadata.demSource.maxElevation ?? null,
          sampleStepMeters: metadata.demSource.sampleStepMeters ?? null,
          sampleStepX: metadata.demSource.sampleStepX ?? null,
          sampleStepY: metadata.demSource.sampleStepY ?? null,
          worldBounds: metadata.demSource.worldBounds
            ? {
                minX: metadata.demSource.worldBounds.minX,
                minY: metadata.demSource.worldBounds.minY,
                maxX: metadata.demSource.worldBounds.maxX,
                maxY: metadata.demSource.worldBounds.maxY,
              }
            : null,
          targetRows: metadata.demSource.targetRows,
          targetColumns: metadata.demSource.targetColumns,
          targetCellSize: metadata.demSource.targetCellSize,
          localEditCellSize: metadata.demSource.localEditCellSize,
          localEditTileSizeMeters: metadata.demSource.localEditTileSizeMeters,
          localEditTileResolution: metadata.demSource.localEditTileResolution,
          tileLayout: metadata.demSource.tileLayout
            ? {
                tileRows: metadata.demSource.tileLayout.tileRows,
                tileColumns: metadata.demSource.tileLayout.tileColumns,
                tileWorldWidth: metadata.demSource.tileLayout.tileWorldWidth,
                tileWorldHeight: metadata.demSource.tileLayout.tileWorldHeight,
                sourceSamplesPerTileX: metadata.demSource.tileLayout.sourceSamplesPerTileX,
                sourceSamplesPerTileY: metadata.demSource.tileLayout.sourceSamplesPerTileY,
                targetSamplesPerTileX: metadata.demSource.tileLayout.targetSamplesPerTileX,
                targetSamplesPerTileY: metadata.demSource.tileLayout.targetSamplesPerTileY,
              }
            : null,
          detailLimitedByGroundGrid: metadata.demSource.detailLimitedByGroundGrid === true,
          detailLimitedByEditResolution: metadata.demSource.detailLimitedByEditResolution === true,
        }
      : null,
  }
}

function cloneGroundContourBounds(bounds: GroundContourBounds | null | undefined): GroundContourBounds | null {
  if (!bounds) {
    return null
  }
  return {
    minRow: Math.max(0, Math.trunc(bounds.minRow)),
    maxRow: Math.max(0, Math.trunc(bounds.maxRow)),
    minColumn: Math.max(0, Math.trunc(bounds.minColumn)),
    maxColumn: Math.max(0, Math.trunc(bounds.maxColumn)),
  }
}

function mergeGroundContourBounds(
  current: GroundContourBounds | null | undefined,
  next: GroundContourBounds | null | undefined,
): GroundContourBounds | null {
  const normalizedCurrent = cloneGroundContourBounds(current)
  const normalizedNext = cloneGroundContourBounds(next)
  if (!normalizedCurrent) {
    return normalizedNext
  }
  if (!normalizedNext) {
    return normalizedCurrent
  }
  return {
    minRow: Math.min(normalizedCurrent.minRow, normalizedNext.minRow),
    maxRow: Math.max(normalizedCurrent.maxRow, normalizedNext.maxRow),
    minColumn: Math.min(normalizedCurrent.minColumn, normalizedNext.minColumn),
    maxColumn: Math.max(normalizedCurrent.maxColumn, normalizedNext.maxColumn),
  }
}

function normalizeGroundChunkKey(key: string): string | null {
  if (typeof key !== 'string') {
    return null
  }
  const trimmed = key.trim()
  if (!trimmed) {
    return null
  }
  const parts = trimmed.split(':')
  if (parts.length !== 2) {
    return null
  }
  const row = Number(parts[0])
  const column = Number(parts[1])
  if (!Number.isFinite(row) || !Number.isFinite(column)) {
    return null
  }
  return `${Math.trunc(row)}:${Math.trunc(column)}`
}

function parseGroundChunkKeyFromDirtyKey(key: string): { chunkRow: number; chunkColumn: number } | null {
  const normalized = normalizeGroundChunkKey(key)
  if (!normalized) {
    return null
  }
  const [rowText, columnText] = normalized.split(':')
  const chunkRow = Number(rowText)
  const chunkColumn = Number(columnText)
  if (!Number.isFinite(chunkRow) || !Number.isFinite(chunkColumn)) {
    return null
  }
  return {
    chunkRow: Math.trunc(chunkRow),
    chunkColumn: Math.trunc(chunkColumn),
  }
}

function expandGroundContourBoundsFromChunkKeys(
  definition: GroundDynamicMesh,
  chunkKeys: Iterable<string>,
): GroundContourBounds | null {
  const chunkCells = Math.max(1, resolveGroundRuntimeChunkCells(definition))
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minColumn = Number.POSITIVE_INFINITY
  let maxColumn = Number.NEGATIVE_INFINITY
  for (const key of chunkKeys) {
    const indices = parseGroundChunkKeyFromDirtyKey(key)
    if (!indices) {
      continue
    }
    const startRow = indices.chunkRow * chunkCells
    const startColumn = indices.chunkColumn * chunkCells
    const endRow = startRow + chunkCells
    const endColumn = startColumn + chunkCells
    minRow = Math.min(minRow, startRow)
    maxRow = Math.max(maxRow, endRow)
    minColumn = Math.min(minColumn, startColumn)
    maxColumn = Math.max(maxColumn, endColumn)
  }
  if (!Number.isFinite(minRow) || !Number.isFinite(maxRow) || !Number.isFinite(minColumn) || !Number.isFinite(maxColumn)) {
    return null
  }
  const gridSize = resolveGroundWorkingGridSize(definition)
  return {
    minRow: Math.max(0, Math.floor(minRow)),
    maxRow: Math.min(gridSize.rows, Math.ceil(maxRow)),
    minColumn: Math.max(0, Math.floor(minColumn)),
    maxColumn: Math.min(gridSize.columns, Math.ceil(maxColumn)),
  }
}

function expandGroundContourBounds(
  bounds: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  rows: number,
  columns: number,
  padding = 1,
): GroundContourBounds | null {
  const minRow = Math.max(0, Math.min(rows, Math.min(bounds.startRow, bounds.endRow)))
  const maxRow = Math.max(0, Math.min(rows, Math.max(bounds.startRow, bounds.endRow)))
  const minColumn = Math.max(0, Math.min(columns, Math.min(bounds.startColumn, bounds.endColumn)))
  const maxColumn = Math.max(0, Math.min(columns, Math.max(bounds.startColumn, bounds.endColumn)))
  if (maxRow < minRow || maxColumn < minColumn) {
    return null
  }
  return {
    minRow: Math.max(0, Math.floor(minRow) - padding),
    maxRow: Math.min(rows, Math.ceil(maxRow) + padding),
    minColumn: Math.max(0, Math.floor(minColumn) - padding),
    maxColumn: Math.min(columns, Math.ceil(maxColumn) + padding),
  }
}

function createRuntimeState(nodeId: string, definition: GroundDynamicMesh): GroundHeightRuntimeState {
  const gridSize = resolveGroundWorkingGridSize(definition)
  return {
    nodeId,
    rows: gridSize.rows,
    columns: gridSize.columns,
    tileResolution: resolveRuntimeTileResolution(definition),
    tiles: new Map<string, GroundHeightTileState>(),
    localEditTiles: cloneRuntimeLocalEditTiles(definition.localEditTiles ?? null),
    planningMetadata: clonePlanningMetadata(definition.planningMetadata ?? null),
    optimizedMeshDirtyBounds: null,
    optimizedMeshDirtyChunkKeys: new Set<string>(),
    runtimeHydratedHeightState: (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState,
    runtimeDisableOptimizedChunks: (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks,
    runtimeLoadedTileKeys: resolveRuntimeLoadedTileKeys(definition),
    surfaceRevision: Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
    manualHeightOverrideCount: 0,
    planningHeightOverrideCount: 0,
    runtimeMeshVersion: 0,
    cachedRuntimeMeshVersion: -1,
  }
}

function touchRuntimeMeshState(state: GroundHeightRuntimeState): void {
  state.runtimeMeshVersion += 1
}

function updateHeightOverrideCount(
  state: GroundHeightRuntimeState,
  kind: 'manual' | 'planning',
  previousValue: number,
  nextValue: number,
): void {
  const hadValue = Number.isFinite(previousValue)
  const hasValue = Number.isFinite(nextValue)
  if (hadValue === hasValue) {
    return
  }
  if (kind === 'manual') {
    state.manualHeightOverrideCount += hasValue ? 1 : -1
    if (state.manualHeightOverrideCount < 0) {
      state.manualHeightOverrideCount = 0
    }
  } else {
    state.planningHeightOverrideCount += hasValue ? 1 : -1
    if (state.planningHeightOverrideCount < 0) {
      state.planningHeightOverrideCount = 0
    }
  }
}

function cloneRuntimeLocalEditTiles(source: GroundLocalEditTileMap | null | undefined): Map<string, GroundLocalEditTileState> {
  const result = new Map<string, GroundLocalEditTileState>()
  if (!source || typeof source !== 'object') {
    return result
  }
  Object.values(source).forEach((tile) => {
    if (!tile || typeof tile !== 'object') {
      return
    }
    const resolution = Math.max(1, Math.trunc(Number(tile.resolution) || 0))
    const expectedLength = (resolution + 1) * (resolution + 1)
    const values = new Float64Array(expectedLength).fill(GROUND_HEIGHT_UNSET_VALUE)
    const inputValues = Array.isArray(tile.values) ? tile.values : []
    const limit = Math.min(expectedLength, inputValues.length)
    for (let index = 0; index < limit; index += 1) {
      const value = Number(inputValues[index])
      values[index] = Number.isFinite(value) ? value : GROUND_HEIGHT_UNSET_VALUE
    }
    const tileRow = Math.trunc(Number(tile.tileRow) || 0)
    const tileColumn = Math.trunc(Number(tile.tileColumn) || 0)
    const key = typeof tile.key === 'string' && tile.key.trim().length
      ? tile.key.trim()
      : formatGroundLocalEditTileKey(tileRow, tileColumn)
    result.set(key, {
      key,
      tileRow,
      tileColumn,
      tileSizeMeters: Number.isFinite(tile.tileSizeMeters) ? Math.max(0, tile.tileSizeMeters) : 0,
      resolution,
      values,
      source: tile.source ?? null,
      updatedAt: Number.isFinite(tile.updatedAt) ? Number(tile.updatedAt) : undefined,
    })
  })
  return result
}

function serializeRuntimeLocalEditTiles(source: Map<string, GroundLocalEditTileState>): GroundLocalEditTileMap | null {
  if (!(source instanceof Map) || source.size === 0) {
    return null
  }
  const result: GroundLocalEditTileMap = {}
  source.forEach((tile, key) => {
    const resolution = Math.max(1, Math.trunc(Number(tile.resolution) || 0))
    const expectedLength = (resolution + 1) * (resolution + 1)
    const values = new Array<number>(expectedLength)
    for (let index = 0; index < expectedLength; index += 1) {
      const value = Number(tile.values[index])
      values[index] = Number.isFinite(value) ? value : GROUND_HEIGHT_UNSET_VALUE
    }
    result[key] = {
      key,
      tileRow: Math.trunc(Number(tile.tileRow) || 0),
      tileColumn: Math.trunc(Number(tile.tileColumn) || 0),
      tileSizeMeters: Number.isFinite(tile.tileSizeMeters) ? Math.max(0, tile.tileSizeMeters) : 0,
      resolution,
      values,
      source: tile.source ?? null,
      updatedAt: Number.isFinite(tile.updatedAt) ? Number(tile.updatedAt) : undefined,
    }
  })
  return Object.keys(result).length ? result : null
}

function ensureNodeRuntimeState(
  nodeId: string,
  definition: GroundDynamicMesh,
): GroundHeightRuntimeState {
  const gridSize = resolveGroundWorkingGridSize(definition)
  const existing = runtimeGroundHeightmaps.get(nodeId)
  if (
    existing
    && existing.rows === gridSize.rows
    && existing.columns === gridSize.columns
    && existing.tileResolution === resolveRuntimeTileResolution(definition)
  ) {
    return existing
  }
  const created = createRuntimeState(nodeId, definition)
  runtimeGroundHeightmaps.set(nodeId, created)
  return created
}

function resolveRuntimeMeshView(
  state: GroundHeightRuntimeState,
  definition: GroundDynamicMesh,
): GroundRuntimeDynamicMesh {
  const cacheHit = state.cachedRuntimeMeshVersion === state.runtimeMeshVersion
  if (!cacheHit) {
    state.cachedManualHeightMap = createHeightMapViewFromTiles(state, 'manual')
    state.cachedPlanningHeightMap = createHeightMapViewFromTiles(state, 'planning')
    state.cachedLocalEditTiles = serializeRuntimeLocalEditTiles(state.localEditTiles)
    state.cachedPlanningMetadata = clonePlanningMetadata(state.planningMetadata ?? definition.planningMetadata ?? null)
    state.cachedRuntimeMeshVersion = state.runtimeMeshVersion
  }

  state.cachedRuntimeMesh = {
    ...definition,
    manualHeightMap: state.cachedManualHeightMap as GroundHeightMap,
    planningHeightMap: state.cachedPlanningHeightMap as GroundHeightMap,
    localEditTiles: state.cachedLocalEditTiles,
    runtimeSampleHeightRegion: (kind, minRowInput, maxRowInput, minColumnInput, maxColumnInput) => sampleRuntimeHeightRegion(
      state,
      kind,
      minRowInput,
      maxRowInput,
      minColumnInput,
      maxColumnInput,
    ),
    planningMetadata: state.cachedPlanningMetadata,
    runtimeHydratedHeightState: state.runtimeHydratedHeightState,
    runtimeDisableOptimizedChunks: state.runtimeDisableOptimizedChunks,
    runtimeLoadedTileKeys: state.runtimeLoadedTileKeys ?? [],
    runtimeManualHeightOverrideCount: state.manualHeightOverrideCount,
    runtimePlanningHeightOverrideCount: state.planningHeightOverrideCount,
    surfaceRevision: Number.isFinite(state.surfaceRevision) ? Math.max(0, Math.trunc(state.surfaceRevision as number)) : definition.surfaceRevision,
  }
  return state.cachedRuntimeMesh as GroundRuntimeDynamicMesh

  return state.cachedRuntimeMesh as GroundRuntimeDynamicMesh
}

function replaceRuntimeGroundHeightmapsFromSidecar(
  groundNode: SceneNode | null,
  sidecar: ArrayBuffer | null,
): void {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    runtimeGroundHeightmaps.clear()
    return
  }
  const runtimeGroundDefinition = definition as GroundRuntimeDynamicMesh
  if (!sidecar) {
    runtimeGroundHeightmaps.clear()
    delete runtimeGroundDefinition.runtimeHydratedHeightState
    delete runtimeGroundDefinition.runtimeDisableOptimizedChunks
    delete runtimeGroundDefinition.runtimeLoadedTileKeys
    delete runtimeGroundDefinition.runtimeManualHeightOverrideCount
    delete runtimeGroundDefinition.runtimePlanningHeightOverrideCount
    return
  }
  const runtimeDefinition = createGroundRuntimeMeshFromSidecar(definition, sidecar)
  runtimeGroundHeightmaps.clear()
  runtimeGroundDefinition.runtimeHydratedHeightState = runtimeDefinition.runtimeHydratedHeightState
  runtimeGroundDefinition.runtimeDisableOptimizedChunks = runtimeDefinition.runtimeDisableOptimizedChunks
  runtimeGroundDefinition.surfaceRevision = runtimeDefinition.surfaceRevision
  runtimeGroundDefinition.runtimeLoadedTileKeys = runtimeDefinition.runtimeLoadedTileKeys ?? []
  runtimeGroundDefinition.runtimeManualHeightOverrideCount = runtimeDefinition.runtimeManualHeightOverrideCount
  runtimeGroundDefinition.runtimePlanningHeightOverrideCount = runtimeDefinition.runtimePlanningHeightOverrideCount
  const created = createRuntimeState(groundNode.id, runtimeDefinition)
  syncFlatHeightMapIntoTiles(created, runtimeDefinition.manualHeightMap, 'manual')
  syncFlatHeightMapIntoTiles(created, runtimeDefinition.planningHeightMap, 'planning')
  created.planningMetadata = clonePlanningMetadata(runtimeDefinition.planningMetadata ?? null)
  created.optimizedMeshDirtyBounds = null
  created.runtimeHydratedHeightState = runtimeDefinition.runtimeHydratedHeightState
  created.runtimeDisableOptimizedChunks = runtimeDefinition.runtimeDisableOptimizedChunks
  created.runtimeLoadedTileKeys = runtimeDefinition.runtimeLoadedTileKeys ?? []
  created.manualHeightOverrideCount = runtimeDefinition.runtimeManualHeightOverrideCount ?? created.manualHeightOverrideCount
  created.planningHeightOverrideCount = runtimeDefinition.runtimePlanningHeightOverrideCount ?? created.planningHeightOverrideCount
  created.surfaceRevision = Number.isFinite(runtimeDefinition.surfaceRevision) ? Math.max(0, Math.trunc(runtimeDefinition.surfaceRevision as number)) : 0
  runtimeGroundHeightmaps.set(groundNode.id, created)
}

function ensureSceneGroundHeightmap(groundNode: SceneNode | null): void {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return
  }
  ensureNodeRuntimeState(groundNode.id, definition)
}

function buildSceneGroundSidecar(groundNode: SceneNode | null): ArrayBuffer | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const state = useGroundHeightmapStore().ensureNodeGroundHeightmap(groundNode.id, definition)
  const sampler: GroundHeightSidecarSampler = {
    rows: state.rows,
    columns: state.columns,
    planningMetadata: state.planningMetadata ?? definition.planningMetadata ?? null,
    getManualHeight: (row, column) => getTileHeightMapValue(state, 'manual', row, column),
    getPlanningHeight: (row, column) => getTileHeightMapValue(state, 'planning', row, column),
    sampleHeightRegion: (kind, minRowInput, maxRowInput, minColumnInput, maxColumnInput) => sampleRuntimeHeightRegion(
      state,
      kind,
      minRowInput,
      maxRowInput,
      minColumnInput,
      maxColumnInput,
    ),
  }
  return serializeGroundHeightSidecarFromSampler(sampler)
}

export const useGroundHeightmapStore = defineStore('groundHeightmap', {
  actions: {
    async hydrateSceneDocument(groundNode: SceneNode | null, sidecar: ArrayBuffer | null): Promise<void> {
      replaceRuntimeGroundHeightmapsFromSidecar(groundNode, sidecar)
    },
    clearSceneDocument(): void {
      runtimeGroundHeightmaps.clear()
    },
    buildSceneDocumentSidecar(groundNode: SceneNode | null): ArrayBuffer | null {
      ensureSceneGroundHeightmap(groundNode)
      return buildSceneGroundSidecar(groundNode)
    },
    getSceneGroundHeightmaps(): Map<string, GroundHeightRuntimeState> {
      return runtimeGroundHeightmaps
    },
    getNodeGroundHeightmap(nodeId: string): GroundHeightRuntimeState | null {
      return runtimeGroundHeightmaps.get(nodeId) ?? null
    },
    resolveGroundRuntimeHeightSampler(
      nodeId: string,
      definition: GroundDynamicMesh,
    ): GroundHeightSidecarSampler {
      const state = ensureNodeRuntimeState(nodeId, definition)
      return {
        rows: state.rows,
        columns: state.columns,
        getManualHeight: (row, column) => getTileHeightMapValue(state, 'manual', row, column),
        getPlanningHeight: (row, column) => getTileHeightMapValue(state, 'planning', row, column),
        sampleHeightRegion: (kind, minRowInput, maxRowInput, minColumnInput, maxColumnInput) => sampleRuntimeHeightRegion(
          state,
          kind,
          minRowInput,
          maxRowInput,
          minColumnInput,
          maxColumnInput,
        ),
      }
    },
    markOptimizedMeshDirtyBounds(
      nodeId: string,
      definition: GroundDynamicMesh,
      bounds: { startRow: number; endRow: number; startColumn: number; endColumn: number } | null,
    ): GroundHeightRuntimeState {
      const gridSize = resolveGroundWorkingGridSize(definition)
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.optimizedMeshDirtyBounds = mergeGroundContourBounds(
        state.optimizedMeshDirtyBounds,
        bounds ? expandGroundContourBounds(bounds, gridSize.rows, gridSize.columns, 1) : null,
      )
      state.optimizedMeshDirtyChunkKeys.clear()
      touchRuntimeMeshState(state)
      return state
    },
    markOptimizedMeshDirtyChunkKeys(
      nodeId: string,
      definition: GroundDynamicMesh,
      chunkKeys: Iterable<string> | null | undefined,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      if (!chunkKeys) {
        return state
      }
      for (const key of chunkKeys) {
        const normalized = normalizeGroundChunkKey(key)
        if (!normalized) {
          continue
        }
        state.optimizedMeshDirtyChunkKeys.add(normalized)
      }
      state.optimizedMeshDirtyBounds = mergeGroundContourBounds(
        state.optimizedMeshDirtyBounds,
        expandGroundContourBoundsFromChunkKeys(definition, state.optimizedMeshDirtyChunkKeys),
      )
      touchRuntimeMeshState(state)
      return state
    },
    clearOptimizedMeshDirtyBounds(nodeId: string, definition: GroundDynamicMesh): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.optimizedMeshDirtyBounds = null
      state.optimizedMeshDirtyChunkKeys.clear()
      touchRuntimeMeshState(state)
      return state
    },
    consumeOptimizedMeshDirtyBounds(nodeId: string, definition: GroundDynamicMesh): GroundContourBounds | null {
      const state = ensureNodeRuntimeState(nodeId, definition)
      const dirtyBounds = state.optimizedMeshDirtyBounds
      const chunkBounds = expandGroundContourBoundsFromChunkKeys(definition, state.optimizedMeshDirtyChunkKeys)
      state.optimizedMeshDirtyBounds = null
      state.optimizedMeshDirtyChunkKeys.clear()
      touchRuntimeMeshState(state)
      return mergeGroundContourBounds(dirtyBounds, chunkBounds)
    },
    ensureNodeGroundHeightmap(nodeId: string, definition: GroundDynamicMesh): GroundHeightRuntimeState {
      return ensureNodeRuntimeState(nodeId, definition)
    },
    resolveGroundRuntimeMesh(
      nodeId: string,
      definition: GroundDynamicMesh,
    ): GroundRuntimeDynamicMesh {
      const state = ensureNodeRuntimeState(nodeId, definition)
      return resolveRuntimeMeshView(state, definition)
    },
    resolveGroundRuntimeMeshView(
      nodeId: string,
      definition: GroundDynamicMesh,
    ): GroundRuntimeDynamicMesh {
      const state = ensureNodeRuntimeState(nodeId, definition)
      return resolveRuntimeMeshView(state, definition)
    },
    replaceManualHeightMap(
      nodeId: string,
      definition: GroundDynamicMesh,
      manualHeightMap: ArrayLike<number>,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      const gridSize = resolveGroundWorkingGridSize(definition)
      state.rows = gridSize.rows
      state.columns = gridSize.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      syncFlatHeightMapIntoTiles(state, manualHeightMap, 'manual')
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      touchRuntimeMeshState(state)
      return state
    },
    syncRuntimeGroundState(
      nodeId: string,
      definition: GroundDynamicMesh,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      const gridSize = resolveGroundWorkingGridSize(definition)
      state.rows = gridSize.rows
      state.columns = gridSize.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      touchRuntimeMeshState(state)
      return state
    },
    replaceManualHeightRegion(
      nodeId: string,
      definition: GroundDynamicMesh,
      region: GroundPlanningHeightRegion,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      const gridSize = resolveGroundWorkingGridSize(definition)
      state.rows = gridSize.rows
      state.columns = gridSize.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      const startRow = Math.max(0, Math.min(gridSize.rows, Math.trunc(region.startRow)))
      const endRow = Math.max(startRow, Math.min(gridSize.rows, Math.trunc(region.endRow)))
      const startColumn = Math.max(0, Math.min(gridSize.columns, Math.trunc(region.startColumn)))
      const endColumn = Math.max(startColumn, Math.min(gridSize.columns, Math.trunc(region.endColumn)))
      const vertexColumns = Math.max(1, Math.trunc(region.vertexColumns))
      for (let row = startRow; row <= endRow; row += 1) {
        const sourceOffset = (row - startRow) * vertexColumns
        for (let column = startColumn; column <= endColumn; column += 1) {
          const tile = getOrCreateGroundHeightTile(state, row, column)
          const value = region.values[sourceOffset + (column - startColumn)] ?? GROUND_HEIGHT_UNSET_VALUE
          setTileHeightMapValue(state, tile, 'manual', row, column, value)
        }
      }
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      touchRuntimeMeshState(state)
      return state
    },
    replacePlanningHeightMap(
      nodeId: string,
      definition: GroundDynamicMesh,
      planningHeightMap: ArrayLike<number>,
      planningMetadata?: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      const gridSize = resolveGroundWorkingGridSize(definition)
      state.rows = gridSize.rows
      state.columns = gridSize.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      syncFlatHeightMapIntoTiles(state, planningHeightMap, 'planning')
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      if (planningMetadata !== undefined) {
        state.planningMetadata = clonePlanningMetadata(planningMetadata)
      }
      touchRuntimeMeshState(state)
      return state
    },
    replaceLocalEditTiles(
      nodeId: string,
      definition: GroundDynamicMesh,
      localEditTiles: GroundLocalEditTileMap | null | undefined,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.localEditTiles = cloneRuntimeLocalEditTiles(localEditTiles)
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      touchRuntimeMeshState(state)
      return state
    },
    serializeNodeLocalEditTiles(nodeId: string, definition: GroundDynamicMesh): GroundLocalEditTileMap | null {
      const state = ensureNodeRuntimeState(nodeId, definition)
      return serializeRuntimeLocalEditTiles(state.localEditTiles)
    },
    replacePlanningHeightRegion(
      nodeId: string,
      definition: GroundDynamicMesh,
      region: GroundPlanningHeightRegion,
      planningMetadata?: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      const gridSize = resolveGroundWorkingGridSize(definition)
      state.rows = gridSize.rows
      state.columns = gridSize.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      const startRow = Math.max(0, Math.min(gridSize.rows, Math.trunc(region.startRow)))
      const endRow = Math.max(startRow, Math.min(gridSize.rows, Math.trunc(region.endRow)))
      const startColumn = Math.max(0, Math.min(gridSize.columns, Math.trunc(region.startColumn)))
      const endColumn = Math.max(startColumn, Math.min(gridSize.columns, Math.trunc(region.endColumn)))
      const vertexColumns = Math.max(1, Math.trunc(region.vertexColumns))
      for (let row = startRow; row <= endRow; row += 1) {
        const sourceOffset = (row - startRow) * vertexColumns
        for (let column = startColumn; column <= endColumn; column += 1) {
          const tile = getOrCreateGroundHeightTile(state, row, column)
          const value = region.values[sourceOffset + (column - startColumn)] ?? GROUND_HEIGHT_UNSET_VALUE
          setTileHeightMapValue(state, tile, 'planning', row, column, value)
        }
      }
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      if (planningMetadata !== undefined) {
        state.planningMetadata = clonePlanningMetadata(planningMetadata)
      }
      return state
    },
    updatePlanningMetadata(
      nodeId: string,
      definition: GroundDynamicMesh,
      planningMetadata: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.planningMetadata = clonePlanningMetadata(planningMetadata)
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      touchRuntimeMeshState(state)
      return state
    },
  },
})