import { defineStore } from 'pinia'
import type {
  GroundDynamicMesh,
  GroundSurfaceChunkTextureRef,
  GroundSurfaceChunkTextureMap,
  SceneNode,
  TerrainPaintSettings,
  TerrainPaintV3MaskTileRef,
  TerrainPaintV3Settings,
} from '@schema'
import {
  cloneTerrainPaintV3Settings,
  deserializeGroundPaintSidecar,
  formatTerrainPaintV3ChunkKey,
  formatTerrainPaintV3TileKey,
  normalizeGroundSurfaceChunkTextureMap,
  serializeGroundPaintSidecar,
  type GroundPaintSidecarPayload,
} from '@schema'

type GroundPaintRuntimeState = {
  sceneId: string
  nodeId: string
  terrainPaint: TerrainPaintSettings | null
  terrainPaintV3: TerrainPaintV3Settings | null
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
    terrainPaintV3: null,
    groundSurfaceChunks: null,
  }
  runtimeGroundPaints.set(sceneId, created)
  return created
}

function createEmptyTerrainPaintV3Settings(): TerrainPaintV3Settings {
  return cloneTerrainPaintV3Settings({
    version: 3,
    tileResolution: 128,
    tileWorldSize: 8,
    layers: [],
    chunks: {},
  })
}

function ensureTerrainPaintV3State(sceneId: string, nodeId: string): TerrainPaintV3Settings {
  const state = ensureRuntimeState(sceneId, nodeId)
  if (!state.terrainPaintV3) {
    state.terrainPaintV3 = createEmptyTerrainPaintV3Settings()
  }
  return state.terrainPaintV3
}

function replaceRuntimeState(sceneId: string, groundNode: SceneNode | null, payload: GroundPaintSidecarPayload | null): void {
  runtimeGroundPaints.delete(sceneId)
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  state.terrainPaint = payload?.terrainPaint ?? null
  state.terrainPaintV3 = payload?.terrainPaintV3 ? cloneTerrainPaintV3Settings(payload.terrainPaintV3) : null
  state.groundSurfaceChunks = normalizeGroundSurfaceChunkTextureMap(payload?.groundSurfaceChunks)
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundPaintSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  if (!state.terrainPaint && !state.terrainPaintV3 && !state.groundSurfaceChunks) {
    return null
  }
  return {
    groundNodeId: groundNode.id,
    terrainPaint: state.terrainPaint,
    terrainPaintV3: state.terrainPaintV3,
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
    terrainPaint: cloneValue(state.terrainPaint),
    terrainPaintV3: state.terrainPaintV3 ? cloneTerrainPaintV3Settings(state.terrainPaintV3) : null,
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
      // Callers transfer ownership of terrainPaint into the runtime sidecar store.
      state.terrainPaint = terrainPaint
      return state
    },
    replaceTerrainPaintV3(sceneId: string, nodeId: string, terrainPaintV3: TerrainPaintV3Settings | null): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.terrainPaintV3 = terrainPaintV3 ? cloneTerrainPaintV3Settings(terrainPaintV3) : null
      return state
    },
    replaceGroundSurfaceChunks(sceneId: string, nodeId: string, groundSurfaceChunks: GroundSurfaceChunkTextureMap | null): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.groundSurfaceChunks = normalizeGroundSurfaceChunkTextureMap(groundSurfaceChunks)
      return state
    },
    ensureTerrainPaintV3(sceneId: string, nodeId: string): TerrainPaintV3Settings {
      return ensureTerrainPaintV3State(sceneId, nodeId)
    },
    upsertTerrainPaintV3MaskTile(
      sceneId: string,
      nodeId: string,
      chunkKey: string,
      layerId: string,
      tileKey: string,
      tileRef: TerrainPaintV3MaskTileRef,
    ): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      const terrainPaintV3 = ensureTerrainPaintV3State(sceneId, nodeId)
      const normalizedChunkKey = chunkKey.trim() || formatTerrainPaintV3ChunkKey(0, 0)
      const normalizedLayerId = layerId.trim()
      const normalizedTileKey = tileKey.trim() || formatTerrainPaintV3TileKey(0, 0)
      if (!normalizedLayerId) {
        return state
      }
      const nextChunkState = terrainPaintV3.chunks[normalizedChunkKey] ?? { layers: {}, revision: 0 }
      const nextLayerState = nextChunkState.layers[normalizedLayerId] ?? { tiles: {} }
      nextLayerState.tiles[normalizedTileKey] = {
        logicalId: tileRef.logicalId.trim(),
        revision: Math.max(0, Math.trunc(tileRef.revision)),
      }
      nextChunkState.layers[normalizedLayerId] = nextLayerState
      nextChunkState.revision = Math.max(nextChunkState.revision, tileRef.revision)
      terrainPaintV3.chunks[normalizedChunkKey] = nextChunkState
      state.terrainPaintV3 = cloneTerrainPaintV3Settings(terrainPaintV3)
      return state
    },
    removeTerrainPaintV3MaskTile(
      sceneId: string,
      nodeId: string,
      chunkKey: string,
      layerId: string,
      tileKey: string,
    ): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      const terrainPaintV3 = state.terrainPaintV3 ? cloneTerrainPaintV3Settings(state.terrainPaintV3) : createEmptyTerrainPaintV3Settings()
      const normalizedChunkKey = chunkKey.trim()
      const normalizedLayerId = layerId.trim()
      const normalizedTileKey = tileKey.trim()
      const chunkState = normalizedChunkKey ? terrainPaintV3.chunks[normalizedChunkKey] : null
      const layerState = chunkState && normalizedLayerId ? chunkState.layers[normalizedLayerId] : null
      if (!chunkState || !layerState || !normalizedTileKey) {
        return state
      }
      delete layerState.tiles[normalizedTileKey]
      if (!Object.keys(layerState.tiles).length) {
        delete chunkState.layers[normalizedLayerId]
      }
      if (!Object.keys(chunkState.layers).length) {
        delete terrainPaintV3.chunks[normalizedChunkKey]
      }
      state.terrainPaintV3 = terrainPaintV3
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