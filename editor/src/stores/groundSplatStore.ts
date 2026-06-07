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


/// Replaces the runtime state for the ground splat associated with the given scene and node, based on the provided payload.
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
  const safePayload = payload ?? {
    groundNodeId: groundNode.id,
    revision: 0,
    surfaceLayerTextureAssetIds: null,
    groundSurfaceChunks: null,
    groundTileMaterialMap: null,
  }
  const tileMaterialMap = safePayload.groundTileMaterialMap ?? safePayload.groundSurfaceChunks ?? null
  if (!tileMaterialMap) {
    groundNode.dynamicMesh = {
      ...definition,
      groundSurfaceChunks: null,
      groundTileMaterialMap: null,
      groundSplatBake: null,
    }
    return
  }
  const revision = Number.isFinite(safePayload.revision) ? Math.max(0, Math.trunc(safePayload.revision)) : 0
  const surfaceLayerTextureAssetIds = normalizeAssetIds(safePayload.surfaceLayerTextureAssetIds)
  const groundSurfaceChunks = cloneValue(tileMaterialMap)
  runtimeGroundSplats.set(sceneId, {
    sceneId,
    nodeId: groundNode.id,
    revision,
    surfaceLayerTextureAssetIds,
    groundSurfaceChunks,
  })
  groundNode.dynamicMesh = {
    ...definition,
    groundSurfaceChunks: cloneValue(groundSurfaceChunks),
    groundTileMaterialMap: cloneValue(groundSurfaceChunks),
    groundSplatBake: {
      revision,
      chunkTextureMap: cloneValue(groundSurfaceChunks),
      tileMaterialMap: cloneValue(groundSurfaceChunks),
      surfaceLayerTextureAssetIds,
    },
  }
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundSplatSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const currentState = runtimeGroundSplats.get(sceneId) ?? null
  const groundSurfaceChunks = cloneValue(
    definition.groundTileMaterialMap
      ?? definition.groundSurfaceChunks
      ?? currentState?.groundSurfaceChunks
      ?? null,
  )
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
    groundTileMaterialMap: groundSurfaceChunks,
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
    groundTileMaterialMap: cloneValue(state.groundSurfaceChunks),
    groundSplatBake: state.groundSurfaceChunks
      ? {
          revision: state.revision,
          chunkTextureMap: cloneValue(state.groundSurfaceChunks),
          tileMaterialMap: cloneValue(state.groundSurfaceChunks),
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
      const safePayload = payload ?? {
        revision: 0,
        surfaceLayerTextureAssetIds: null,
        groundSurfaceChunks: null,
        groundTileMaterialMap: null,
      }
      const tileMaterialMap = safePayload.groundTileMaterialMap ?? safePayload.groundSurfaceChunks ?? null
      if (!tileMaterialMap || Object.keys(tileMaterialMap).length <= 0) {
        runtimeGroundSplats.delete(sceneId)
        return null
      }
      const state: GroundSplatRuntimeState = {
        sceneId,
        nodeId,
        revision: Number.isFinite(safePayload.revision) ? Math.max(0, Math.trunc(safePayload.revision)) : 0,
        surfaceLayerTextureAssetIds: normalizeAssetIds(safePayload.surfaceLayerTextureAssetIds),
        groundSurfaceChunks: cloneValue(tileMaterialMap),
      }
      runtimeGroundSplats.set(sceneId, state)
      return state
    },
    getSceneGroundSplat(sceneId: string): GroundSplatRuntimeState | null {
      return runtimeGroundSplats.get(sceneId) ?? null
    },
  },
})
