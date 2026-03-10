import { defineStore } from 'pinia'
import type { GroundDynamicMesh, SceneNode, TerrainPaintSettings } from '@schema'
import {
  deserializeGroundDynamicSidecar,
  serializeGroundDynamicSidecar,
  type GroundDynamicSidecarPayload,
} from '@schema'
import {
  deleteTerrainScatterStore,
  loadTerrainScatterSnapshot,
  saveTerrainScatterSnapshot,
  type TerrainScatterStoreSnapshot,
} from '@schema/terrain-scatter'

type GroundDynamicRuntimeState = {
  sceneId: string
  nodeId: string
  terrainScatter: TerrainScatterStoreSnapshot | null
  terrainPaint: TerrainPaintSettings | null
}

const runtimeGroundDynamics = new Map<string, GroundDynamicRuntimeState>()

function asGroundDynamicMesh(node: SceneNode | null | undefined): GroundDynamicMesh | null {
  const dynamicMesh = node?.dynamicMesh
  if (dynamicMesh?.type !== 'Ground') {
    return null
  }
  return dynamicMesh
}

function cloneValue<T>(value: T): T {
  if (value == null) {
    return value
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function ensureRuntimeState(sceneId: string, nodeId: string): GroundDynamicRuntimeState {
  const existing = runtimeGroundDynamics.get(sceneId)
  if (existing && existing.nodeId === nodeId) {
    return existing
  }
  const created: GroundDynamicRuntimeState = {
    sceneId,
    nodeId,
    terrainScatter: null,
    terrainPaint: null,
  }
  runtimeGroundDynamics.set(sceneId, created)
  return created
}

function replaceRuntimeState(
  sceneId: string,
  groundNode: SceneNode | null,
  payload: GroundDynamicSidecarPayload | null,
): void {
  runtimeGroundDynamics.delete(sceneId)
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  state.terrainScatter = cloneValue(payload?.terrainScatter ?? null)
  state.terrainPaint = cloneValue(payload?.terrainPaint ?? null)
  if (state.terrainScatter) {
    loadTerrainScatterSnapshot(groundNode.id, state.terrainScatter)
  } else {
    deleteTerrainScatterStore(groundNode.id)
  }
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundDynamicSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  const terrainScatter = saveTerrainScatterSnapshot(groundNode.id) ?? state.terrainScatter ?? null
  state.terrainScatter = cloneValue(terrainScatter)
  return {
    groundNodeId: groundNode.id,
    terrainScatter,
    terrainPaint: cloneValue(state.terrainPaint),
  }
}

export function attachGroundDynamicRuntimeToNode(
  sceneId: string,
  groundNode: SceneNode | null | undefined,
): SceneNode | null | undefined {
  const definition = asGroundDynamicMesh(groundNode)
  const state = runtimeGroundDynamics.get(sceneId)
  if (!groundNode || !definition || !state || state.nodeId !== groundNode.id) {
    return groundNode
  }
  groundNode.dynamicMesh = {
    ...definition,
    terrainScatter: cloneValue(state.terrainScatter),
    terrainPaint: cloneValue(state.terrainPaint),
  }
  return groundNode
}

export const useGroundDynamicStore = defineStore('groundDynamic', {
  actions: {
    async hydrateSceneDocument(sceneId: string, groundNode: SceneNode | null, sidecar: ArrayBuffer | null): Promise<void> {
      replaceRuntimeState(sceneId, groundNode, sidecar ? deserializeGroundDynamicSidecar(sidecar) : null)
    },
    clearSceneDocument(sceneId?: string): void {
      if (sceneId) {
        const existing = runtimeGroundDynamics.get(sceneId)
        if (existing) {
          deleteTerrainScatterStore(existing.nodeId)
          runtimeGroundDynamics.delete(sceneId)
        }
        return
      }
      runtimeGroundDynamics.forEach((state) => {
        deleteTerrainScatterStore(state.nodeId)
      })
      runtimeGroundDynamics.clear()
    },
    buildSceneDocumentSidecar(sceneId: string, groundNode: SceneNode | null): ArrayBuffer | null {
      const payload = buildPayload(sceneId, groundNode)
      return payload ? serializeGroundDynamicSidecar(payload) : null
    },
    getSceneGroundDynamic(sceneId: string): GroundDynamicRuntimeState | null {
      return runtimeGroundDynamics.get(sceneId) ?? null
    },
    replaceTerrainPaint(sceneId: string, nodeId: string, terrainPaint: TerrainPaintSettings | null): GroundDynamicRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.terrainPaint = cloneValue(terrainPaint)
      return state
    },
    replaceTerrainScatter(sceneId: string, nodeId: string, terrainScatter: TerrainScatterStoreSnapshot | null): GroundDynamicRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.terrainScatter = cloneValue(terrainScatter)
      if (terrainScatter) {
        loadTerrainScatterSnapshot(nodeId, terrainScatter)
      } else {
        deleteTerrainScatterStore(nodeId)
      }
      return state
    },
    captureTerrainScatterSnapshot(sceneId: string, nodeId: string): GroundDynamicRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.terrainScatter = cloneValue(saveTerrainScatterSnapshot(nodeId) ?? null)
      return state
    },
  },
})