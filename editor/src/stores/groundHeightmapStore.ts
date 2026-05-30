import { defineStore } from 'pinia'
import {
  GROUND_HEIGHT_UNSET_VALUE,
  formatGroundLocalEditTileKey,
  resolveGroundWorkingGridSize,
  type GroundContourBounds,
  type GroundDynamicMesh,
  type GroundLocalEditTileMap,
  type GroundLocalEditTileSource,
  type GroundPlanningMetadata,
  type SceneNode,
} from '@schema/core'
import { resolveGroundRuntimeChunkCells } from '@schema/groundMesh'
import { sampleGroundHeight } from '@schema/groundMesh'
import {
  createGroundRuntimeMeshFromSidecar,
  serializeGroundHeightSidecarFromSampler,
  type GroundHeightSidecarSampler,
} from '@/utils/groundHeightSidecar'

const runtimeGroundHeightmaps = new Map<string, GroundHeightRuntimeState>()

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
  localEditTiles: Map<string, GroundLocalEditTileState>
  planningMetadata: GroundPlanningMetadata | null
  optimizedMeshDirtyBounds: GroundContourBounds | null
  optimizedMeshDirtyChunkKeys: Set<string>
  runtimeHydratedHeightState?: 'pristine' | 'dirty'
  runtimeDisableOptimizedChunks?: boolean
  runtimeLoadedTileKeys?: string[]
  surfaceRevision?: number
  runtimeMeshVersion: number
  cachedRuntimeMeshVersion: number
  cachedRuntimeMesh?: GroundRuntimeDynamicMesh
  cachedLocalEditTiles?: GroundLocalEditTileMap | null
  cachedPlanningMetadata?: GroundPlanningMetadata | null
}

export type GroundRuntimeDynamicMesh = GroundDynamicMesh & {
  runtimeHydratedHeightState?: 'pristine' | 'dirty'
  runtimeDisableOptimizedChunks?: boolean
  runtimeLoadedTileKeys?: string[]
}

function shouldUseCanonicalTerrainAuthoringState(
  state: Pick<GroundHeightRuntimeState, 'localEditTiles' | 'planningMetadata'>,
  definition: Pick<GroundDynamicMesh, 'localEditTiles' | 'planningMetadata'>,
): boolean {
  return Boolean(
    (state.localEditTiles && state.localEditTiles.size > 0)
    || (definition.localEditTiles && Object.keys(definition.localEditTiles).length > 0)
    || state.planningMetadata?.demSource
    || definition.planningMetadata?.demSource,
  )
}

function clearLegacyHeightTileState(state: GroundHeightRuntimeState): void {
}

function resolveRuntimeLoadedTileKeys(definition: GroundDynamicMesh): string[] {
  const existing = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys
  return Array.isArray(existing) ? [...existing] : []
}

function resolveRuntimeTileResolution(definition: GroundDynamicMesh): number {
  const gridSize = resolveGroundWorkingGridSize(definition)
  return Math.max(1, Math.trunc(gridSize.rows))
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
    localEditTiles: cloneRuntimeLocalEditTiles(definition.localEditTiles ?? null),
    planningMetadata: clonePlanningMetadata(definition.planningMetadata ?? null),
    optimizedMeshDirtyBounds: null,
    optimizedMeshDirtyChunkKeys: new Set<string>(),
    runtimeHydratedHeightState: (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState,
    runtimeDisableOptimizedChunks: (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks,
    runtimeLoadedTileKeys: resolveRuntimeLoadedTileKeys(definition),
    surfaceRevision: Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
    runtimeMeshVersion: 0,
    cachedRuntimeMeshVersion: -1,
  }
}

function touchRuntimeMeshState(state: GroundHeightRuntimeState): void {
  state.runtimeMeshVersion += 1
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
    state.cachedLocalEditTiles = serializeRuntimeLocalEditTiles(state.localEditTiles)
    state.cachedPlanningMetadata = clonePlanningMetadata(state.planningMetadata ?? definition.planningMetadata ?? null)
    state.cachedRuntimeMeshVersion = state.runtimeMeshVersion
  }

  state.cachedRuntimeMesh = {
    ...definition,
    localEditTiles: state.cachedLocalEditTiles,
    planningMetadata: state.cachedPlanningMetadata,
    runtimeHydratedHeightState: state.runtimeHydratedHeightState,
    runtimeDisableOptimizedChunks: state.runtimeDisableOptimizedChunks,
    runtimeLoadedTileKeys: state.runtimeLoadedTileKeys ?? [],
    surfaceRevision: Number.isFinite(state.surfaceRevision) ? Math.max(0, Math.trunc(state.surfaceRevision as number)) : definition.surfaceRevision,
  }
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
    return
  }
  const runtimeDefinition = createGroundRuntimeMeshFromSidecar(definition, sidecar)
  runtimeGroundHeightmaps.clear()
  runtimeGroundDefinition.planningMetadata = runtimeDefinition.planningMetadata
  runtimeGroundDefinition.localEditTiles = runtimeDefinition.localEditTiles ?? null
  runtimeGroundDefinition.runtimeHydratedHeightState = runtimeDefinition.runtimeHydratedHeightState
  runtimeGroundDefinition.runtimeDisableOptimizedChunks = runtimeDefinition.runtimeDisableOptimizedChunks
  runtimeGroundDefinition.surfaceRevision = runtimeDefinition.surfaceRevision
  runtimeGroundDefinition.runtimeLoadedTileKeys = runtimeDefinition.runtimeLoadedTileKeys ?? []
  const created = createRuntimeState(groundNode.id, runtimeDefinition)
  clearLegacyHeightTileState(created)
  created.planningMetadata = clonePlanningMetadata(runtimeDefinition.planningMetadata ?? null)
  created.optimizedMeshDirtyBounds = null
  created.runtimeHydratedHeightState = runtimeDefinition.runtimeHydratedHeightState
  created.runtimeDisableOptimizedChunks = runtimeDefinition.runtimeDisableOptimizedChunks
  created.runtimeLoadedTileKeys = runtimeDefinition.runtimeLoadedTileKeys ?? []
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
    localEditTiles: serializeRuntimeLocalEditTiles(state.localEditTiles) ?? definition.localEditTiles ?? null,
    sampleHeightAtWorld: (x, z) => sampleGroundHeight(definition, x, z),
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
        planningMetadata: state.planningMetadata ?? definition.planningMetadata ?? null,
        localEditTiles: serializeRuntimeLocalEditTiles(state.localEditTiles) ?? definition.localEditTiles ?? null,
        sampleHeightAtWorld: (x, z) => sampleGroundHeight(definition, x, z),
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
      const receivedChunkKeys = Array.from(chunkKeys).filter((key) => typeof key === 'string' && key.length > 0)
      for (const key of receivedChunkKeys) {
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
      if (shouldUseCanonicalTerrainAuthoringState(state, definition)) {
        clearLegacyHeightTileState(state)
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
      if (shouldUseCanonicalTerrainAuthoringState(state, definition)) {
        clearLegacyHeightTileState(state)
      }
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
    updatePlanningMetadata(
      nodeId: string,
      definition: GroundDynamicMesh,
      planningMetadata: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.planningMetadata = clonePlanningMetadata(planningMetadata)
      if (shouldUseCanonicalTerrainAuthoringState(state, definition)) {
        clearLegacyHeightTileState(state)
      }
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      touchRuntimeMeshState(state)
      return state
    },
  },
})
