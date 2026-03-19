import { defineStore } from 'pinia'
import type {
  GroundDynamicMesh,
  GroundSurfaceChunkTextureRef,
  GroundSurfaceChunkTextureMap,
  SceneNode,
} from '@schema'
import {
  deserializeGroundPaintSidecar,
  normalizeGroundSurfaceChunkTextureMap,
  serializeGroundPaintSidecar,
  type GroundPaintSidecarPayload,
} from '@schema'

type GroundPaintRuntimeState = {
  sceneId: string
  nodeId: string
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
    groundSurfaceChunks: null,
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
  state.groundSurfaceChunks = normalizeGroundSurfaceChunkTextureMap(payload?.groundSurfaceChunks)
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundPaintSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  const groundSurfaceChunks = normalizeGroundSurfaceChunkTextureMap(state.groundSurfaceChunks)
  const hasGroundSurfaceChunks = Object.keys(groundSurfaceChunks).length > 0
  if (!hasGroundSurfaceChunks) {
    return null
  }
  return {
    groundNodeId: groundNode.id,
    groundSurfaceChunks: hasGroundSurfaceChunks ? groundSurfaceChunks : null,
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
    terrainPaint: null,
    groundSurfaceChunks: normalizeGroundSurfaceChunkTextureMap(state.groundSurfaceChunks),
  }
  return groundNode
}

export const useGroundPaintStore = defineStore('groundPaint', {
  state: () => ({
    sceneRuntimeVersions: {} as Record<string, number>,
  }),
  actions: {
    async hydrateSceneDocument(sceneId: string, groundNode: SceneNode | null, sidecar: ArrayBuffer | null): Promise<void> {
      replaceRuntimeState(sceneId, groundNode, sidecar ? deserializeGroundPaintSidecar(sidecar) : null)
      this.sceneRuntimeVersions = {
        ...this.sceneRuntimeVersions,
        [sceneId]: (this.sceneRuntimeVersions[sceneId] ?? 0) + 1,
      }
    },
    clearSceneDocument(sceneId?: string): void {
      if (sceneId) {
        runtimeGroundPaints.delete(sceneId)
        const nextVersions = { ...this.sceneRuntimeVersions }
        delete nextVersions[sceneId]
        this.sceneRuntimeVersions = nextVersions
        return
      }
      runtimeGroundPaints.clear()
      this.sceneRuntimeVersions = {}
    },
    buildSceneDocumentSidecar(sceneId: string, groundNode: SceneNode | null): ArrayBuffer | null {
      const payload = buildPayload(sceneId, groundNode)
      return payload ? serializeGroundPaintSidecar(payload) : null
    },
    getSceneGroundPaint(sceneId: string): GroundPaintRuntimeState | null {
      return runtimeGroundPaints.get(sceneId) ?? null
    },
    getSceneRuntimeVersion(sceneId: string): number {
      return this.sceneRuntimeVersions[sceneId] ?? 0
    },
    replaceGroundSurfaceChunks(sceneId: string, nodeId: string, groundSurfaceChunks: GroundSurfaceChunkTextureMap | null): GroundPaintRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.groundSurfaceChunks = normalizeGroundSurfaceChunkTextureMap(groundSurfaceChunks)
      this.sceneRuntimeVersions = {
        ...this.sceneRuntimeVersions,
        [sceneId]: (this.sceneRuntimeVersions[sceneId] ?? 0) + 1,
      }
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
      this.sceneRuntimeVersions = {
        ...this.sceneRuntimeVersions,
        [sceneId]: (this.sceneRuntimeVersions[sceneId] ?? 0) + 1,
      }
      return state
    },
  },
})