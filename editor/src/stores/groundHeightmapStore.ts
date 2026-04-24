import { defineStore } from 'pinia'
import {
  GROUND_HEIGHT_UNSET_VALUE,
  createGroundHeightMap,
  getGroundVertexIndex,
  resolveGroundTerrainTileKeys,
  type GroundDynamicMesh,
  type GroundPlanningMetadata,
  type SceneNode,
} from '@schema'
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

export type GroundHeightRuntimeState = {
  nodeId: string
  rows: number
  columns: number
  tileResolution: number
  tiles: Map<string, GroundHeightTileState>
  planningMetadata: GroundPlanningMetadata | null
  runtimeHydratedHeightState?: 'pristine' | 'dirty'
  runtimeDisableOptimizedChunks?: boolean
  runtimeLoadedTileKeys?: string[]
  surfaceRevision?: number
}

export type GroundRuntimeDynamicMesh = GroundDynamicMesh & {
  manualHeightMap: Float64Array
  planningHeightMap: Float64Array
  runtimeHydratedHeightState?: 'pristine' | 'dirty'
  runtimeDisableOptimizedChunks?: boolean
  runtimeLoadedTileKeys?: string[]
}

function resolveRuntimeLoadedTileKeys(definition: GroundDynamicMesh): string[] {
  return resolveGroundTerrainTileKeys({
    rows: definition.rows,
    columns: definition.columns,
    tileResolution: definition.tileResolution ?? definition.rows,
  })
}

function resolveRuntimeTileResolution(definition: GroundDynamicMesh): number {
  return Math.max(1, Math.trunc(definition.tileResolution ?? definition.rows))
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

function setTileHeightMapValue(
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
  if (kind === 'manual') {
    tile.manualHeightMap[index] = value
  } else {
    tile.planningHeightMap[index] = value
  }
}

function getTileHeightMapValue(
  state: GroundHeightRuntimeState,
  kind: 'manual' | 'planning',
  row: number,
  column: number,
): number {
  const tile = state.tiles.get(getGroundHeightTileKey(row, column, state.tileResolution))
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

function buildFlatHeightMapFromTiles(
  state: GroundHeightRuntimeState,
  kind: 'manual' | 'planning',
): Float64Array {
  const target = createGroundHeightMap(state.rows, state.columns)
  for (const tile of state.tiles.values()) {
    for (let row = 0; row <= tile.rows; row += 1) {
      const globalRow = tile.startRow + row
      if (globalRow > state.rows) {
        continue
      }
      for (let column = 0; column <= tile.columns; column += 1) {
        const globalColumn = tile.startColumn + column
        if (globalColumn > state.columns) {
          continue
        }
        const index = getGroundVertexIndex(state.columns, globalRow, globalColumn)
        const sourceIndex = getGroundVertexIndex(tile.columns, row, column)
        const value = kind === 'manual' ? Number(tile.manualHeightMap[sourceIndex]) : Number(tile.planningHeightMap[sourceIndex])
        target[index] = Number.isFinite(value) ? value : GROUND_HEIGHT_UNSET_VALUE
      }
    }
  }
  return target
}

function syncFlatHeightMapIntoTiles(
  state: GroundHeightRuntimeState,
  source: Float64Array,
  kind: 'manual' | 'planning',
): void {
  for (let row = 0; row <= state.rows; row += 1) {
    for (let column = 0; column <= state.columns; column += 1) {
      const tile = getOrCreateGroundHeightTile(state, row, column)
      const value = source[getGroundVertexIndex(state.columns, row, column)] ?? GROUND_HEIGHT_UNSET_VALUE
      setTileHeightMapValue(tile, kind, row, column, value)
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

function createRuntimeState(nodeId: string, definition: GroundDynamicMesh): GroundHeightRuntimeState {
  return {
    nodeId,
    rows: definition.rows,
    columns: definition.columns,
    tileResolution: resolveRuntimeTileResolution(definition),
    tiles: new Map<string, GroundHeightTileState>(),
    planningMetadata: clonePlanningMetadata(definition.planningMetadata ?? null),
    runtimeHydratedHeightState: (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState,
    runtimeDisableOptimizedChunks: (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks,
    runtimeLoadedTileKeys: (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition),
    surfaceRevision: Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0,
  }
}

function ensureNodeRuntimeState(
  nodeId: string,
  definition: GroundDynamicMesh,
): GroundHeightRuntimeState {
  const existing = runtimeGroundHeightmaps.get(nodeId)
  if (
    existing
    && existing.rows === definition.rows
    && existing.columns === definition.columns
    && existing.tileResolution === resolveRuntimeTileResolution(definition)
  ) {
    return existing
  }
  const created = createRuntimeState(nodeId, definition)
  runtimeGroundHeightmaps.set(nodeId, created)
  return created
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
  runtimeGroundDefinition.runtimeHydratedHeightState = runtimeDefinition.runtimeHydratedHeightState
  runtimeGroundDefinition.runtimeDisableOptimizedChunks = runtimeDefinition.runtimeDisableOptimizedChunks
  runtimeGroundDefinition.surfaceRevision = runtimeDefinition.surfaceRevision
  runtimeGroundDefinition.runtimeLoadedTileKeys = runtimeDefinition.runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
  const created = createRuntimeState(groundNode.id, runtimeDefinition)
  syncFlatHeightMapIntoTiles(created, runtimeDefinition.manualHeightMap, 'manual')
  syncFlatHeightMapIntoTiles(created, runtimeDefinition.planningHeightMap, 'planning')
  created.planningMetadata = clonePlanningMetadata(runtimeDefinition.planningMetadata ?? null)
  created.runtimeHydratedHeightState = runtimeDefinition.runtimeHydratedHeightState
  created.runtimeDisableOptimizedChunks = runtimeDefinition.runtimeDisableOptimizedChunks
  created.runtimeLoadedTileKeys = runtimeDefinition.runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
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
    ensureNodeGroundHeightmap(nodeId: string, definition: GroundDynamicMesh): GroundHeightRuntimeState {
      return ensureNodeRuntimeState(nodeId, definition)
    },
    resolveGroundRuntimeMesh(
      nodeId: string,
      definition: GroundDynamicMesh,
    ): GroundRuntimeDynamicMesh {
      const state = ensureNodeRuntimeState(nodeId, definition)
      return {
        ...definition,
        manualHeightMap: buildFlatHeightMapFromTiles(state, 'manual'),
        planningHeightMap: buildFlatHeightMapFromTiles(state, 'planning'),
        planningMetadata: clonePlanningMetadata(state.planningMetadata ?? definition.planningMetadata ?? null),
        runtimeHydratedHeightState: state.runtimeHydratedHeightState,
        runtimeDisableOptimizedChunks: state.runtimeDisableOptimizedChunks,
        runtimeLoadedTileKeys: state.runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition),
        surfaceRevision: Number.isFinite(state.surfaceRevision) ? Math.max(0, Math.trunc(state.surfaceRevision as number)) : definition.surfaceRevision,
      }
    },
    replaceManualHeightMap(
      nodeId: string,
      definition: GroundDynamicMesh,
      manualHeightMap: Float64Array,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.rows = definition.rows
      state.columns = definition.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      syncFlatHeightMapIntoTiles(state, manualHeightMap, 'manual')
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      return state
    },
    syncRuntimeGroundState(
      nodeId: string,
      definition: GroundDynamicMesh,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.rows = definition.rows
      state.columns = definition.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      return state
    },
    replaceManualHeightRegion(
      nodeId: string,
      definition: GroundDynamicMesh,
      region: GroundPlanningHeightRegion,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.rows = definition.rows
      state.columns = definition.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      const startRow = Math.max(0, Math.min(definition.rows, Math.trunc(region.startRow)))
      const endRow = Math.max(startRow, Math.min(definition.rows, Math.trunc(region.endRow)))
      const startColumn = Math.max(0, Math.min(definition.columns, Math.trunc(region.startColumn)))
      const endColumn = Math.max(startColumn, Math.min(definition.columns, Math.trunc(region.endColumn)))
      const vertexColumns = Math.max(1, Math.trunc(region.vertexColumns))
      for (let row = startRow; row <= endRow; row += 1) {
        const sourceOffset = (row - startRow) * vertexColumns
        for (let column = startColumn; column <= endColumn; column += 1) {
          const tile = getOrCreateGroundHeightTile(state, row, column)
          const value = region.values[sourceOffset + (column - startColumn)] ?? GROUND_HEIGHT_UNSET_VALUE
          setTileHeightMapValue(tile, 'manual', row, column, value)
        }
      }
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      return state
    },
    replacePlanningHeightMap(
      nodeId: string,
      definition: GroundDynamicMesh,
      planningHeightMap: Float64Array,
      planningMetadata?: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.rows = definition.rows
      state.columns = definition.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      syncFlatHeightMapIntoTiles(state, planningHeightMap, 'planning')
      state.runtimeHydratedHeightState = (definition as GroundRuntimeDynamicMesh).runtimeHydratedHeightState
      state.runtimeDisableOptimizedChunks = (definition as GroundRuntimeDynamicMesh).runtimeDisableOptimizedChunks
      state.runtimeLoadedTileKeys = (definition as GroundRuntimeDynamicMesh).runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition)
      state.surfaceRevision = Number.isFinite(definition.surfaceRevision) ? Math.max(0, Math.trunc(definition.surfaceRevision as number)) : 0
      if (planningMetadata !== undefined) {
        state.planningMetadata = clonePlanningMetadata(planningMetadata)
      }
      return state
    },
    replacePlanningHeightRegion(
      nodeId: string,
      definition: GroundDynamicMesh,
      region: GroundPlanningHeightRegion,
      planningMetadata?: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.rows = definition.rows
      state.columns = definition.columns
      state.tileResolution = resolveRuntimeTileResolution(definition)
      const startRow = Math.max(0, Math.min(definition.rows, Math.trunc(region.startRow)))
      const endRow = Math.max(startRow, Math.min(definition.rows, Math.trunc(region.endRow)))
      const startColumn = Math.max(0, Math.min(definition.columns, Math.trunc(region.startColumn)))
      const endColumn = Math.max(startColumn, Math.min(definition.columns, Math.trunc(region.endColumn)))
      const vertexColumns = Math.max(1, Math.trunc(region.vertexColumns))
      for (let row = startRow; row <= endRow; row += 1) {
        const sourceOffset = (row - startRow) * vertexColumns
        for (let column = startColumn; column <= endColumn; column += 1) {
          const tile = getOrCreateGroundHeightTile(state, row, column)
          const value = region.values[sourceOffset + (column - startColumn)] ?? GROUND_HEIGHT_UNSET_VALUE
          setTileHeightMapValue(tile, 'planning', row, column, value)
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
      return state
    },
  },
})