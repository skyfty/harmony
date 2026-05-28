import type { GroundDynamicMesh, GroundSurfaceChunkTextureMap, SceneNode } from '@schema/core'
import {
  deserializeGroundSplatSidecar,
  serializeGroundSplatSidecar,
  type GroundSplatSidecarPayload,
} from '@schema/core'
import { defineStore } from 'pinia'

type GroundSplatRuntimeState = {
  sceneId: string
  nodeId: string
  revision: number
  surfaceLayerTextureAssetIds: string[] | null
  groundSurfaceChunks: GroundSurfaceChunkTextureMap | null
}

const runtimeGroundSplats = new Map<string, GroundSplatRuntimeState>()

function cloneValue<T>(value: T): T {
  if (value == null) {
    return value
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function asGroundDynamicMesh(node: SceneNode | null | undefined): GroundDynamicMesh | null {
  const dynamicMesh = node?.dynamicMesh
  if (dynamicMesh?.type !== 'Ground') {
    return null
  }
  return dynamicMesh
}

function normalizeAssetIds(value: string[] | null | undefined): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const normalized = Array.from(new Set(
    value
      .map((entry) => typeof entry === 'string' ? entry.trim() : '')
      .filter((entry) => entry.length > 0),
  ))
  return normalized.length > 0 ? normalized : null
}

function replaceRuntimeState(
  sceneId: string,
  groundNode: SceneNode | null,
  payload: GroundSplatSidecarPayload | null,
): void {
  runtimeGroundSplats.delete(sceneId)
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return
  }
  if (!payload?.groundSurfaceChunks) {
    groundNode.dynamicMesh = {
      ...definition,
      groundSurfaceChunks: null,
      groundSplatBake: null,
    }
    return
  }
  runtimeGroundSplats.set(sceneId, {
    sceneId,
    nodeId: groundNode.id,
    revision: Number.isFinite(payload.revision) ? Math.max(0, Math.trunc(payload.revision)) : 0,
    surfaceLayerTextureAssetIds: normalizeAssetIds(payload.surfaceLayerTextureAssetIds),
    groundSurfaceChunks: cloneValue(payload.groundSurfaceChunks),
  })
  groundNode.dynamicMesh = {
    ...definition,
    groundSurfaceChunks: cloneValue(payload.groundSurfaceChunks),
    groundSplatBake: {
      revision: Number.isFinite(payload.revision) ? Math.max(0, Math.trunc(payload.revision)) : 0,
      chunkTextureMap: cloneValue(payload.groundSurfaceChunks),
      surfaceLayerTextureAssetIds: normalizeAssetIds(payload.surfaceLayerTextureAssetIds),
    },
  }
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundSplatSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const currentState = runtimeGroundSplats.get(sceneId) ?? null
  const groundSurfaceChunks = cloneValue(definition.groundSurfaceChunks ?? currentState?.groundSurfaceChunks ?? null)
  if (!groundSurfaceChunks || Object.keys(groundSurfaceChunks).length <= 0) {
    return null
  }
  const revision = Number.isFinite(definition.groundSplatBake?.revision)
    ? Math.max(0, Math.trunc(definition.groundSplatBake!.revision))
    : (currentState?.revision ?? 0)
  const surfaceLayerTextureAssetIds = normalizeAssetIds(
    definition.groundSplatBake?.surfaceLayerTextureAssetIds ?? currentState?.surfaceLayerTextureAssetIds ?? null,
  )
  return {
    groundNodeId: groundNode.id,
    revision,
    surfaceLayerTextureAssetIds,
    groundSurfaceChunks,
  }
}

export function attachGroundSplatRuntimeToNode(
  sceneId: string,
  groundNode: SceneNode | null | undefined,
): SceneNode | null | undefined {
  const definition = asGroundDynamicMesh(groundNode)
  const state = runtimeGroundSplats.get(sceneId)
  if (!groundNode || !definition || !state || state.nodeId !== groundNode.id) {
    return groundNode
  }
  groundNode.dynamicMesh = {
    ...definition,
    groundSurfaceChunks: cloneValue(state.groundSurfaceChunks),
    groundSplatBake: state.groundSurfaceChunks
      ? {
          revision: state.revision,
          chunkTextureMap: cloneValue(state.groundSurfaceChunks),
          surfaceLayerTextureAssetIds: cloneValue(state.surfaceLayerTextureAssetIds),
        }
      : null,
  }
  return groundNode
}

export const useGroundSplatStore = defineStore('groundSplat', {
  actions: {
    async hydrateSceneDocument(sceneId: string, groundNode: SceneNode | null, sidecar: ArrayBuffer | null): Promise<void> {
      replaceRuntimeState(sceneId, groundNode, sidecar ? deserializeGroundSplatSidecar(sidecar) : null)
    },
    clearSceneDocument(sceneId?: string): void {
      if (sceneId) {
        runtimeGroundSplats.delete(sceneId)
        return
      }
      runtimeGroundSplats.clear()
    },
    buildSceneDocumentSidecar(sceneId: string, groundNode: SceneNode | null): ArrayBuffer | null {
      const payload = buildPayload(sceneId, groundNode)
      return payload ? serializeGroundSplatSidecar(payload) : null
    },
    replaceGroundSplat(
      sceneId: string,
      nodeId: string,
      payload: Omit<GroundSplatSidecarPayload, 'groundNodeId'> | null,
    ): GroundSplatRuntimeState | null {
      if (!payload?.groundSurfaceChunks || Object.keys(payload.groundSurfaceChunks).length <= 0) {
        runtimeGroundSplats.delete(sceneId)
        return null
      }
      const state: GroundSplatRuntimeState = {
        sceneId,
        nodeId,
        revision: Number.isFinite(payload.revision) ? Math.max(0, Math.trunc(payload.revision)) : 0,
        surfaceLayerTextureAssetIds: normalizeAssetIds(payload.surfaceLayerTextureAssetIds),
        groundSurfaceChunks: cloneValue(payload.groundSurfaceChunks),
      }
      runtimeGroundSplats.set(sceneId, state)
      return state
    },
    getSceneGroundSplat(sceneId: string): GroundSplatRuntimeState | null {
      return runtimeGroundSplats.get(sceneId) ?? null
    },
  },
})
