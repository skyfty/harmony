import { defineStore } from 'pinia'
import type {
  RoadDynamicMesh,
  RoadSurfaceChunkAssetMap,
  SceneNode,
} from '@schema'
import {
  deserializeRoadSurfaceSidecar,
  normalizeRoadSurfaceChunkAssetMap,
  serializeRoadSurfaceSidecar,
  type RoadSurfaceSidecarPayload,
} from '@schema'

type RoadSurfaceRuntimeState = {
  sceneId: string
  nodeId: string
  roadSurfaceChunks: RoadSurfaceChunkAssetMap | null
  lastSyncReason: string
}

const runtimeRoadSurfaces = new Map<string, Map<string, RoadSurfaceRuntimeState>>()

function asRoadDynamicMesh(node: SceneNode | null | undefined): RoadDynamicMesh | null {
  const dynamicMesh = node?.dynamicMesh
  if (dynamicMesh?.type !== 'Road') {
    return null
  }
  return dynamicMesh
}

function ensureSceneRuntimeState(sceneId: string): Map<string, RoadSurfaceRuntimeState> {
  const existing = runtimeRoadSurfaces.get(sceneId)
  if (existing) {
    return existing
  }
  const created = new Map<string, RoadSurfaceRuntimeState>()
  runtimeRoadSurfaces.set(sceneId, created)
  return created
}

function ensureRuntimeState(sceneId: string, nodeId: string): RoadSurfaceRuntimeState {
  const sceneState = ensureSceneRuntimeState(sceneId)
  const existing = sceneState.get(nodeId)
  if (existing) {
    return existing
  }
  const created: RoadSurfaceRuntimeState = {
    sceneId,
    nodeId,
    roadSurfaceChunks: null,
    lastSyncReason: 'init',
  }
  sceneState.set(nodeId, created)
  return created
}

function replaceRuntimeState(sceneId: string, roadNode: SceneNode | null, payload: RoadSurfaceSidecarPayload | null): void {
  const definition = asRoadDynamicMesh(roadNode)
  if (!definition || !roadNode) {
    return
  }
  const sceneState = ensureSceneRuntimeState(sceneId)
  if (!payload) {
    sceneState.delete(roadNode.id)
    if (sceneState.size === 0) {
      runtimeRoadSurfaces.delete(sceneId)
    }
    return
  }

  const state = ensureRuntimeState(sceneId, roadNode.id)
  state.roadSurfaceChunks = normalizeRoadSurfaceChunkAssetMap(payload.roadSurfaceChunks)
}

function resolveRoadSurfaceChunksForBuild(sceneId: string, roadNode: SceneNode | null): RoadSurfaceChunkAssetMap {
  const definition = asRoadDynamicMesh(roadNode)
  if (!definition || !roadNode) {
    return {}
  }
  const runtime = runtimeRoadSurfaces.get(sceneId)?.get(roadNode.id) ?? null
  if (runtime?.roadSurfaceChunks) {
    return normalizeRoadSurfaceChunkAssetMap(runtime.roadSurfaceChunks)
  }
  return normalizeRoadSurfaceChunkAssetMap(definition.roadSurfaceChunks)
}

function buildPayload(sceneId: string, roadNode: SceneNode | null): RoadSurfaceSidecarPayload | null {
  const definition = asRoadDynamicMesh(roadNode)
  if (!roadNode || !definition) {
    return null
  }

  const roadSurfaceChunks = resolveRoadSurfaceChunksForBuild(sceneId, roadNode)
  const hasRoadSurfaceChunks = Object.keys(roadSurfaceChunks).length > 0
  if (!hasRoadSurfaceChunks) {
    return null
  }
  return {
    roadNodeId: roadNode.id,
    chunkSizeMeters: Number.isFinite(definition.chunkSizeMeters) ? Math.max(1, definition.chunkSizeMeters ?? 32) : 32,
    sampleSpacingMeters: Number.isFinite(definition.sampleSpacingMeters) ? Math.max(0.05, definition.sampleSpacingMeters ?? 0.5) : 0.5,
    roadSurfaceChunks,
  }
}

export function attachRoadSurfaceRuntimeToNode(
  sceneId: string,
  roadNode: SceneNode | null | undefined,
): SceneNode | null | undefined {
  const definition = asRoadDynamicMesh(roadNode)
  const sceneState = runtimeRoadSurfaces.get(sceneId)
  const state = roadNode && sceneState ? sceneState.get(roadNode.id) ?? null : null
  if (!roadNode || !definition || !state) {
    return roadNode
  }
  roadNode.dynamicMesh = {
    ...definition,
    roadSurfaceChunks: normalizeRoadSurfaceChunkAssetMap(state.roadSurfaceChunks),
  }
  return roadNode
}

export const useRoadSurfaceStore = defineStore('roadSurface', {
  state: () => ({
    sceneRuntimeVersions: {} as Record<string, number>,
    sceneRuntimeReasons: {} as Record<string, string>,
  }),
  actions: {
    bumpSceneRuntimeVersion(sceneId: string, reason = 'unknown'): void {
      this.sceneRuntimeVersions = {
        ...this.sceneRuntimeVersions,
        [sceneId]: (this.sceneRuntimeVersions[sceneId] ?? 0) + 1,
      }
      this.sceneRuntimeReasons = {
        ...this.sceneRuntimeReasons,
        [sceneId]: reason,
      }
    },
    hydrateSceneDocument(sceneId: string, roadNode: SceneNode | null, sidecar: ArrayBuffer | null): void {
      replaceRuntimeState(sceneId, roadNode, sidecar ? deserializeRoadSurfaceSidecar(sidecar) : null)
      const runtimeState = roadNode ? runtimeRoadSurfaces.get(sceneId)?.get(roadNode.id) ?? null : null
      if (runtimeState) {
        runtimeState.lastSyncReason = 'hydrate'
      }
      this.bumpSceneRuntimeVersion(sceneId, 'hydrate')
    },
    clearSceneDocument(sceneId?: string): void {
      if (sceneId) {
        runtimeRoadSurfaces.delete(sceneId)
        const nextVersions = { ...this.sceneRuntimeVersions }
        delete nextVersions[sceneId]
        this.sceneRuntimeVersions = nextVersions
        const nextReasons = { ...this.sceneRuntimeReasons }
        delete nextReasons[sceneId]
        this.sceneRuntimeReasons = nextReasons
        return
      }
      runtimeRoadSurfaces.clear()
      this.sceneRuntimeVersions = {}
      this.sceneRuntimeReasons = {}
    },
    buildSceneDocumentSidecar(sceneId: string, roadNode: SceneNode | null): ArrayBuffer | null {
      const payload = buildPayload(sceneId, roadNode)
      return payload ? serializeRoadSurfaceSidecar(payload) : null
    },
    getSceneRoadSurface(sceneId: string, nodeId?: string): RoadSurfaceRuntimeState | null {
      const sceneState = runtimeRoadSurfaces.get(sceneId)
      if (!sceneState || sceneState.size === 0) {
        return null
      }
      if (nodeId && nodeId.trim().length) {
        return sceneState.get(nodeId.trim()) ?? null
      }
      const first = sceneState.values().next()
      return first.done ? null : first.value
    },
    listSceneRoadSurfaces(sceneId: string): RoadSurfaceRuntimeState[] {
      const sceneState = runtimeRoadSurfaces.get(sceneId)
      if (!sceneState || sceneState.size === 0) {
        return []
      }
      return Array.from(sceneState.values())
    },
    getSceneRuntimeVersion(sceneId: string): number {
      return this.sceneRuntimeVersions[sceneId] ?? 0
    },
    getSceneRuntimeReason(sceneId: string): string {
      return this.sceneRuntimeReasons[sceneId] ?? 'unknown'
    },
    replaceRoadSurfaceChunks(
      sceneId: string,
      nodeId: string,
      roadSurfaceChunks: RoadSurfaceChunkAssetMap | null,
      options: { bumpRuntimeVersion?: boolean; reason?: string } = {},
    ): RoadSurfaceRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      const reason = typeof options.reason === 'string' && options.reason.trim().length > 0
        ? options.reason.trim()
        : 'unknown'
      state.roadSurfaceChunks = normalizeRoadSurfaceChunkAssetMap(roadSurfaceChunks)
      state.lastSyncReason = reason
      if (options.bumpRuntimeVersion !== false) {
        this.bumpSceneRuntimeVersion(sceneId, reason)
      } else {
        this.sceneRuntimeReasons = {
          ...this.sceneRuntimeReasons,
          [sceneId]: reason,
        }
      }
      return state
    },
    replaceRoadSurfaceChunk(
      sceneId: string,
      nodeId: string,
      chunkKey: string,
      chunkRef: RoadSurfaceChunkAssetMap[string] | null,
    ): RoadSurfaceRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      const nextChunks = normalizeRoadSurfaceChunkAssetMap(state.roadSurfaceChunks)
      const normalizedChunkKey = chunkKey.trim()
      if (!normalizedChunkKey) {
        return state
      }
      if (!chunkRef || (!chunkRef.coverageAssetId?.trim() && !chunkRef.heightAssetId?.trim())) {
        const hasInline = Boolean(chunkRef?.coverageData?.trim() || chunkRef?.heightData?.trim())
        if (hasInline && chunkRef) {
          nextChunks[normalizedChunkKey] = {
            revision: Math.max(0, Math.trunc(chunkRef.revision)),
            resolution: Math.max(1, Math.trunc(chunkRef.resolution)),
            coverageAssetId: null,
            heightAssetId: null,
            coverageData: chunkRef.coverageData?.trim() || null,
            heightData: chunkRef.heightData?.trim() || null,
          }
        } else {
          delete nextChunks[normalizedChunkKey]
        }
      } else {
        nextChunks[normalizedChunkKey] = {
          revision: Math.max(0, Math.trunc(chunkRef.revision)),
          resolution: Math.max(1, Math.trunc(chunkRef.resolution)),
          coverageAssetId: chunkRef.coverageAssetId?.trim() || null,
          heightAssetId: chunkRef.heightAssetId?.trim() || null,
          coverageData: chunkRef.coverageData?.trim() || null,
          heightData: chunkRef.heightData?.trim() || null,
        }
      }
      state.roadSurfaceChunks = nextChunks
      state.lastSyncReason = 'chunk-edit'
      this.bumpSceneRuntimeVersion(sceneId, 'chunk-edit')
      return state
    },
  },
})