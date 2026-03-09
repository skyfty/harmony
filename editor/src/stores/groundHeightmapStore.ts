import { defineStore } from 'pinia'
import { createGroundHeightMap, type GroundDynamicMesh, type GroundPlanningMetadata, type SceneNode } from '@schema'
import {
  createGroundRuntimeMeshFromSidecar,
  serializeGroundHeightSidecar,
} from '@/utils/groundHeightSidecar'

const runtimeGroundHeightmaps = new Map<string, GroundHeightRuntimeState>()

export type GroundHeightRuntimeState = {
  nodeId: string
  rows: number
  columns: number
  manualHeightMap: Float64Array
  planningHeightMap: Float64Array
  planningMetadata: GroundPlanningMetadata | null
}

export type GroundRuntimeDynamicMesh = GroundDynamicMesh & {
  manualHeightMap: Float64Array
  planningHeightMap: Float64Array
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
  }
}

function createRuntimeState(nodeId: string, definition: GroundDynamicMesh): GroundHeightRuntimeState {
  const vertexCount = (definition.rows + 1) * (definition.columns + 1)
  return {
    nodeId,
    rows: definition.rows,
    columns: definition.columns,
    manualHeightMap: new Float64Array(createGroundHeightMap(definition.rows, definition.columns).buffer.slice(0, vertexCount * Float64Array.BYTES_PER_ELEMENT)),
    planningHeightMap: new Float64Array(createGroundHeightMap(definition.rows, definition.columns).buffer.slice(0, vertexCount * Float64Array.BYTES_PER_ELEMENT)),
    planningMetadata: clonePlanningMetadata(definition.planningMetadata ?? null),
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
  runtimeGroundHeightmaps.clear()
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition || !sidecar) {
    return
  }
  const runtimeDefinition = createGroundRuntimeMeshFromSidecar(definition, sidecar)
  runtimeGroundHeightmaps.set(groundNode.id, {
    nodeId: groundNode.id,
    rows: runtimeDefinition.rows,
    columns: runtimeDefinition.columns,
    manualHeightMap: new Float64Array(runtimeDefinition.manualHeightMap),
    planningHeightMap: new Float64Array(runtimeDefinition.planningHeightMap),
    planningMetadata: clonePlanningMetadata(runtimeDefinition.planningMetadata ?? null),
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
      state.manualHeightMap = new Float64Array(manualHeightMap)
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
      state.planningHeightMap = new Float64Array(planningHeightMap)
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
      return state
    },
  },
})