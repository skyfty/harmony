import { defineStore } from 'pinia'
import type { GroundDynamicMesh, SceneNode } from '@schema'
import {
  deserializeGroundScatterSidecar,
  serializeGroundScatterSidecar,
  type GroundScatterSidecarPayload,
} from '@schema'
import {
  deleteTerrainScatterStore,
  loadTerrainScatterSnapshot,
  saveTerrainScatterSnapshot,
  type TerrainScatterStoreSnapshot,
} from '@schema/terrain-scatter'

type GroundScatterRuntimeState = {
  sceneId: string
  nodeId: string
  terrainScatter: TerrainScatterStoreSnapshot | null
}

const runtimeGroundScatters = new Map<string, GroundScatterRuntimeState>()

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

function ensureRuntimeState(sceneId: string, nodeId: string): GroundScatterRuntimeState {
  const existing = runtimeGroundScatters.get(sceneId)
  if (existing && existing.nodeId === nodeId) {
    return existing
  }
  const created: GroundScatterRuntimeState = {
    sceneId,
    nodeId,
    terrainScatter: null,
  }
  runtimeGroundScatters.set(sceneId, created)
  return created
}

function replaceRuntimeState(
  sceneId: string,
  groundNode: SceneNode | null,
  payload: GroundScatterSidecarPayload | null,
): void {
  runtimeGroundScatters.delete(sceneId)
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  state.terrainScatter = payload?.terrainScatter ?? null
  if (state.terrainScatter) {
    loadTerrainScatterSnapshot(groundNode.id, state.terrainScatter)
  } else {
    deleteTerrainScatterStore(groundNode.id)
  }
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundScatterSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  const terrainScatter = saveTerrainScatterSnapshot(groundNode.id) ?? state.terrainScatter ?? null
  state.terrainScatter = terrainScatter
  return {
    groundNodeId: groundNode.id,
    terrainScatter,
  }
}

export function attachGroundScatterRuntimeToNode(
  sceneId: string,
  groundNode: SceneNode | null | undefined,
): SceneNode | null | undefined {
  const definition = asGroundDynamicMesh(groundNode)
  const state = runtimeGroundScatters.get(sceneId)
  if (!groundNode || !definition || !state || state.nodeId !== groundNode.id) {
    return groundNode
  }
  groundNode.dynamicMesh = {
    ...definition,
    terrainScatter: cloneValue(state.terrainScatter),
  }
  return groundNode
}

export const useGroundScatterStore = defineStore('groundScatter', {
  state: () => ({
    sceneRuntimeVersions: {} as Record<string, number>,
  }),
  actions: {
    async hydrateSceneDocument(sceneId: string, groundNode: SceneNode | null, sidecar: ArrayBuffer | null): Promise<void> {
      replaceRuntimeState(sceneId, groundNode, sidecar ? deserializeGroundScatterSidecar(sidecar) : null)
      this.sceneRuntimeVersions = {
        ...this.sceneRuntimeVersions,
        [sceneId]: (this.sceneRuntimeVersions[sceneId] ?? 0) + 1,
      }
    },
    clearSceneDocument(sceneId?: string): void {
      if (sceneId) {
        const existing = runtimeGroundScatters.get(sceneId)
        if (existing) {
          deleteTerrainScatterStore(existing.nodeId)
          runtimeGroundScatters.delete(sceneId)
        }
        const nextVersions = { ...this.sceneRuntimeVersions }
        delete nextVersions[sceneId]
        this.sceneRuntimeVersions = nextVersions
        return
      }
      runtimeGroundScatters.forEach((state) => {
        deleteTerrainScatterStore(state.nodeId)
      })
      runtimeGroundScatters.clear()
      this.sceneRuntimeVersions = {}
    },
    buildSceneDocumentSidecar(sceneId: string, groundNode: SceneNode | null): ArrayBuffer | null {
      const payload = buildPayload(sceneId, groundNode)
      return payload ? serializeGroundScatterSidecar(payload) : null
    },
    getSceneGroundScatter(sceneId: string): GroundScatterRuntimeState | null {
      return runtimeGroundScatters.get(sceneId) ?? null
    },
    getSceneRuntimeVersion(sceneId: string): number {
      return this.sceneRuntimeVersions[sceneId] ?? 0
    },
    replaceTerrainScatter(sceneId: string, nodeId: string, terrainScatter: TerrainScatterStoreSnapshot | null): GroundScatterRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      // Callers transfer ownership of terrainScatter into the runtime sidecar store.
      state.terrainScatter = terrainScatter
      if (terrainScatter) {
        loadTerrainScatterSnapshot(nodeId, terrainScatter)
      } else {
        deleteTerrainScatterStore(nodeId)
      }
      this.sceneRuntimeVersions = {
        ...this.sceneRuntimeVersions,
        [sceneId]: (this.sceneRuntimeVersions[sceneId] ?? 0) + 1,
      }
      return state
    },
    captureTerrainScatterSnapshot(sceneId: string, nodeId: string): GroundScatterRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.terrainScatter = saveTerrainScatterSnapshot(nodeId) ?? null
      this.sceneRuntimeVersions = {
        ...this.sceneRuntimeVersions,
        [sceneId]: (this.sceneRuntimeVersions[sceneId] ?? 0) + 1,
      }
      return state
    },
  },
})