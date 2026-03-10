import { defineStore } from 'pinia'
import type { GroundDynamicMesh, SceneNode, TerrainPaintSettings } from '@schema'
import {
  deserializeGroundPaintSidecar,
  serializeGroundPaintSidecar,
  type GroundPaintSidecarPayload,
} from '@schema'

type GroundPaintRuntimeState = {
  sceneId: string
  nodeId: string
  terrainPaint: TerrainPaintSettings | null
}

const runtimeGroundPaints = new Map<string, GroundPaintRuntimeState>()

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

function ensureRuntimeState(sceneId: string, nodeId: string): GroundPaintRuntimeState {
  const existing = runtimeGroundPaints.get(sceneId)
  if (existing && existing.nodeId === nodeId) {
    return existing
  }
  const created: GroundPaintRuntimeState = {
    sceneId,
    nodeId,
    terrainPaint: null,
  }
  runtimeGroundPaints.set(sceneId, created)
  return created
}

function replaceRuntimeState(sceneId: string, groundNode: SceneNode | null, payload: GroundPaintSidecarPayload | null): void {
  runtimeGroundPaints.delete(sceneId)
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  state.terrainPaint = payload?.terrainPaint ?? null
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundPaintSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  if (!state.terrainPaint) {
    return null
  }
  return {
    groundNodeId: groundNode.id,
    terrainPaint: state.terrainPaint,
  }
}

export function attachGroundPaintRuntimeToNode(
  sceneId: string,
  groundNode: SceneNode | null | undefined,
): SceneNode | null | undefined {
  const definition = asGroundDynamicMesh(groundNode)
  const state = runtimeGroundPaints.get(sceneId)
  if (!groundNode || !definition || !state || state.nodeId !== groundNode.id) {
    return groundNode
  }
  groundNode.dynamicMesh = {
    ...definition,
    terrainPaint: cloneValue(state.terrainPaint),
  }
  return groundNode
}

export const useGroundPaintStore = defineStore('groundPaint', {
  actions: {
    async hydrateSceneDocument(sceneId: string, groundNode: SceneNode | null, sidecar: ArrayBuffer | null): Promise<void> {
      replaceRuntimeState(sceneId, groundNode, sidecar ? deserializeGroundPaintSidecar(sidecar) : null)
    },
    clearSceneDocument(sceneId?: string): void {
      if (sceneId) {
        runtimeGroundPaints.delete(sceneId)
        return
      }
      runtimeGroundPaints.clear()
    },
    buildSceneDocumentSidecar(sceneId: string, groundNode: SceneNode | null): ArrayBuffer | null {
      const payload = buildPayload(sceneId, groundNode)
      return payload ? serializeGroundPaintSidecar(payload) : null
    },
    getSceneGroundPaint(sceneId: string): GroundPaintRuntimeState | null {
      return runtimeGroundPaints.get(sceneId) ?? null
    },
    replaceTerrainPaint(sceneId: string, nodeId: string, terrainPaint: TerrainPaintSettings | null): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      // Callers transfer ownership of terrainPaint into the runtime sidecar store.
      state.terrainPaint = terrainPaint
      return state
    },
  },
})