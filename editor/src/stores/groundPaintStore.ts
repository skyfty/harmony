import { defineStore } from 'pinia'
import type {
  GroundDynamicMesh,
  GroundSurfaceChunkTextureRef,
  GroundSurfaceChunkTextureMap,
  SceneNode,
  TerrainPaintMaskTileRef,
  TerrainPaintSettings,
} from '@schema'
import {
  cloneTerrainPaintSettings,
  deserializeGroundPaintSidecar,
  formatTerrainPaintChunkKey,
  formatTerrainPaintTileKey,
  normalizeGroundSurfaceChunkTextureMap,
  serializeGroundPaintSidecar,
  type GroundPaintSidecarPayload,
} from '@schema'

type GroundPaintRuntimeState = {
  sceneId: string
  nodeId: string
  terrainPaint: TerrainPaintSettings | null
  groundSurfaceChunks: GroundSurfaceChunkTextureMap | null
}

const runtimeGroundPaints = new Map<string, GroundPaintRuntimeState>()

function asGroundDynamicMesh(node: SceneNode | null | undefined): GroundDynamicMesh | null {
  const dynamicMesh = node?.dynamicMesh
  if (dynamicMesh?.type !== 'Ground') {
    return null
  }
  return dynamicMesh
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
    groundSurfaceChunks: null,
  }
  runtimeGroundPaints.set(sceneId, created)
  return created
}

function createEmptyTerrainPaintSettings(): TerrainPaintSettings {
  return cloneTerrainPaintSettings({
    version: 3,
    tileResolution: 128,
    tileWorldSize: 8,
    layers: [],
    chunks: {},
  })
}

function ensureTerrainPaintState(sceneId: string, nodeId: string): TerrainPaintSettings {
  const state = ensureRuntimeState(sceneId, nodeId)
  if (!state.terrainPaint) {
    state.terrainPaint = createEmptyTerrainPaintSettings()
  }
  return state.terrainPaint
}

function replaceRuntimeState(sceneId: string, groundNode: SceneNode | null, payload: GroundPaintSidecarPayload | null): void {
  runtimeGroundPaints.delete(sceneId)
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  state.terrainPaint = payload?.terrainPaint ? cloneTerrainPaintSettings(payload.terrainPaint) : null
  state.groundSurfaceChunks = normalizeGroundSurfaceChunkTextureMap(payload?.groundSurfaceChunks)
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundPaintSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  if (!state.terrainPaint && !state.groundSurfaceChunks) {
    return null
  }
  return {
    groundNodeId: groundNode.id,
    terrainPaint: state.terrainPaint,
    groundSurfaceChunks: state.groundSurfaceChunks,
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
    terrainPaint: state.terrainPaint ? cloneTerrainPaintSettings(state.terrainPaint) : null,
    groundSurfaceChunks: normalizeGroundSurfaceChunkTextureMap(state.groundSurfaceChunks),
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
      state.terrainPaint = terrainPaint ? cloneTerrainPaintSettings(terrainPaint) : null
      return state
    },
    replaceGroundSurfaceChunks(sceneId: string, nodeId: string, groundSurfaceChunks: GroundSurfaceChunkTextureMap | null): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.groundSurfaceChunks = normalizeGroundSurfaceChunkTextureMap(groundSurfaceChunks)
      return state
    },
    ensureTerrainPaint(sceneId: string, nodeId: string): TerrainPaintSettings {
      return ensureTerrainPaintState(sceneId, nodeId)
    },
    upsertTerrainPaintMaskTile(
      sceneId: string,
      nodeId: string,
      chunkKey: string,
      layerId: string,
      tileKey: string,
      tileRef: TerrainPaintMaskTileRef,
    ): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      const terrainPaint = ensureTerrainPaintState(sceneId, nodeId)
      const normalizedChunkKey = chunkKey.trim() || formatTerrainPaintChunkKey(0, 0)
      const normalizedLayerId = layerId.trim()
      const normalizedTileKey = tileKey.trim() || formatTerrainPaintTileKey(0, 0)
      if (!normalizedLayerId) {
        return state
      }
      const nextChunkState = terrainPaint.chunks[normalizedChunkKey] ?? { layers: {}, revision: 0 }
      const nextLayerState = nextChunkState.layers[normalizedLayerId] ?? { tiles: {} }
      nextLayerState.tiles[normalizedTileKey] = {
        logicalId: tileRef.logicalId.trim(),
        revision: Math.max(0, Math.trunc(tileRef.revision)),
      }
      nextChunkState.layers[normalizedLayerId] = nextLayerState
      nextChunkState.revision = Math.max(nextChunkState.revision, tileRef.revision)
      terrainPaint.chunks[normalizedChunkKey] = nextChunkState
      state.terrainPaint = cloneTerrainPaintSettings(terrainPaint)
      return state
    },
    removeTerrainPaintMaskTile(
      sceneId: string,
      nodeId: string,
      chunkKey: string,
      layerId: string,
      tileKey: string,
    ): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      const terrainPaint = state.terrainPaint ? cloneTerrainPaintSettings(state.terrainPaint) : createEmptyTerrainPaintSettings()
      const normalizedChunkKey = chunkKey.trim()
      const normalizedLayerId = layerId.trim()
      const normalizedTileKey = tileKey.trim()
      const chunkState = normalizedChunkKey ? terrainPaint.chunks[normalizedChunkKey] : null
      const layerState = chunkState && normalizedLayerId ? chunkState.layers[normalizedLayerId] : null
      if (!chunkState || !layerState || !normalizedTileKey) {
        return state
      }
      delete layerState.tiles[normalizedTileKey]
      if (!Object.keys(layerState.tiles).length) {
        delete chunkState.layers[normalizedLayerId]
      }
      if (!Object.keys(chunkState.layers).length) {
        delete terrainPaint.chunks[normalizedChunkKey]
      }
      state.terrainPaint = terrainPaint
      return state
    },
    replaceGroundSurfaceChunk(
      sceneId: string,
      nodeId: string,
      chunkKey: string,
      chunkRef: GroundSurfaceChunkTextureRef | null,
    ): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      const nextChunks = normalizeGroundSurfaceChunkTextureMap(state.groundSurfaceChunks)
      const normalizedChunkKey = chunkKey.trim()
      if (!normalizedChunkKey) {
        return state
      }
      if (!chunkRef || !chunkRef.textureAssetId.trim()) {
        if (nextChunks) {
          delete nextChunks[normalizedChunkKey]
        }
      } else {
        nextChunks[normalizedChunkKey] = {
          textureAssetId: chunkRef.textureAssetId.trim(),
          revision: Math.max(0, Math.trunc(chunkRef.revision)),
        }
      }
      state.groundSurfaceChunks = nextChunks
      return state
    },
  },
})