import { defineStore } from 'pinia'
import {
  getGroundVertexIndex,
  resolveGroundTerrainTileKeys,
  type GroundDynamicMesh,
  type GroundPlanningMetadata,
  type SceneNode,
} from '@schema'
import {
  createGroundRuntimeMeshFromSidecar,
  serializeGroundHeightSidecar,
} from '@/utils/groundHeightSidecar'

const runtimeGroundHeightmaps = new Map<string, GroundHeightRuntimeState>()

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
  manualHeightMap: Float64Array
  planningHeightMap: Float64Array
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
  const vertexCount = (definition.rows + 1) * (definition.columns + 1)
  return {
    nodeId,
    rows: definition.rows,
    columns: definition.columns,
    manualHeightMap: new Float64Array(vertexCount),
    planningHeightMap: new Float64Array(vertexCount),
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
  runtimeGroundHeightmaps.set(groundNode.id, {
    nodeId: groundNode.id,
    rows: runtimeDefinition.rows,
    columns: runtimeDefinition.columns,
    manualHeightMap: new Float64Array(runtimeDefinition.manualHeightMap),
    planningHeightMap: new Float64Array(runtimeDefinition.planningHeightMap),
    planningMetadata: clonePlanningMetadata(runtimeDefinition.planningMetadata ?? null),
    runtimeHydratedHeightState: runtimeDefinition.runtimeHydratedHeightState,
    runtimeDisableOptimizedChunks: runtimeDefinition.runtimeDisableOptimizedChunks,
    runtimeLoadedTileKeys: runtimeDefinition.runtimeLoadedTileKeys ?? resolveRuntimeLoadedTileKeys(definition),
    surfaceRevision: Number.isFinite(runtimeDefinition.surfaceRevision) ? Math.max(0, Math.trunc(runtimeDefinition.surfaceRevision as number)) : 0,
  })
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
  return serializeGroundHeightSidecar(
    useGroundHeightmapStore().resolveGroundRuntimeMesh(groundNode.id, definition),
  )
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
        manualHeightMap: state.manualHeightMap,
        planningHeightMap: state.planningHeightMap,
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
      if (state.manualHeightMap.length !== manualHeightMap.length) {
        state.manualHeightMap = new Float64Array(manualHeightMap)
      } else {
        state.manualHeightMap.set(manualHeightMap)
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
      if (state.planningHeightMap.length !== planningHeightMap.length) {
        state.planningHeightMap = new Float64Array(planningHeightMap)
      } else {
        state.planningHeightMap.set(planningHeightMap)
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
    replacePlanningHeightRegion(
      nodeId: string,
      definition: GroundDynamicMesh,
      region: GroundPlanningHeightRegion,
      planningMetadata?: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(nodeId, definition)
      state.rows = definition.rows
      state.columns = definition.columns
      const nextPlanningHeightMap = state.planningHeightMap
      const startRow = Math.max(0, Math.min(definition.rows, Math.trunc(region.startRow)))
      const endRow = Math.max(startRow, Math.min(definition.rows, Math.trunc(region.endRow)))
      const startColumn = Math.max(0, Math.min(definition.columns, Math.trunc(region.startColumn)))
      const endColumn = Math.max(startColumn, Math.min(definition.columns, Math.trunc(region.endColumn)))
      const vertexColumns = Math.max(1, Math.trunc(region.vertexColumns))
      for (let row = startRow; row <= endRow; row += 1) {
        const sourceOffset = (row - startRow) * vertexColumns
        for (let column = startColumn; column <= endColumn; column += 1) {
          nextPlanningHeightMap[getGroundVertexIndex(definition.columns, row, column)] = region.values[sourceOffset + (column - startColumn)] ?? 0
        }
      }
      state.planningHeightMap = nextPlanningHeightMap
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