import { defineStore } from 'pinia'
import type { GroundDynamicMesh, SceneNode } from '@schema/core'
import {
  deserializeGroundScatterSidecar,
  serializeGroundScatterSidecar,
  type GroundScatterSidecarPayload,
} from '@schema/core'
import {
  deleteTerrainScatterStore,
  loadTerrainScatterSnapshot,
  saveTerrainScatterSnapshot,
  type TerrainScatterStoreSnapshot,
} from '@schema/terrain-scatter'

function formatGroundScatterLog(event: string, fields: Record<string, unknown> = {}): string {
  const serializedFields = Object.entries(fields)
    .map(([key, value]) => `${key}=${formatGroundScatterLogValue(value)}`)
    .join(' | ')
  return serializedFields
    ? `[GroundScatterStore] ${event} | ${serializedFields}`
    : `[GroundScatterStore] ${event}`
}

function formatGroundScatterLogValue(value: unknown): string {
  if (value == null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatGroundScatterLogValue(entry)).join(', ')}]`
  }
  try {
    return JSON.stringify(value)
  } catch (_error) {
    return Object.prototype.toString.call(value)
  }
}

type GroundScatterRuntimeState = {
  sceneId: string
  nodeId: string
  terrainScatter: TerrainScatterStoreSnapshot | null
  lastSyncReason: string
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
    lastSyncReason: 'init',
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
    console.log(formatGroundScatterLog('replaceRuntimeState skipped', {
      sceneId,
      groundNodeId: groundNode?.id ?? null,
      hasGroundNode: Boolean(groundNode),
      hasGroundDefinition: Boolean(definition),
      hasPayload: Boolean(payload),
    }))
    return
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  state.terrainScatter = payload?.terrainScatter ?? null
  if (state.terrainScatter) {
    loadTerrainScatterSnapshot(groundNode.id, state.terrainScatter)
  } else {
    deleteTerrainScatterStore(groundNode.id)
  }
  console.log(formatGroundScatterLog('replaceRuntimeState applied', {
    sceneId,
    groundNodeId: groundNode.id,
    layerCount: state.terrainScatter?.layers?.length ?? 0,
    source: payload ? 'sidecar' : 'empty',
  }))
}

function buildPayload(sceneId: string, groundNode: SceneNode | null): GroundScatterSidecarPayload | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  const state = ensureRuntimeState(sceneId, groundNode.id)
  const terrainScatter = saveTerrainScatterSnapshot(groundNode.id) ?? state.terrainScatter ?? null
  if (!terrainScatter) {
    return null
  }
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
  console.log(formatGroundScatterLog('attach applied', {
    sceneId,
    groundNodeId: groundNode.id,
    layerCount: state.terrainScatter?.layers?.length ?? 0,
    syncReason: state.lastSyncReason,
  }))
  return groundNode
}

export const useGroundScatterStore = defineStore('groundScatter', {
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
    async hydrateSceneDocument(sceneId: string, groundNode: SceneNode | null, sidecar: ArrayBuffer | null): Promise<void> {
      replaceRuntimeState(sceneId, groundNode, sidecar ? deserializeGroundScatterSidecar(sidecar) : null)
      const runtimeState = runtimeGroundScatters.get(sceneId)
      if (runtimeState) {
        runtimeState.lastSyncReason = 'hydrate'
      }
      console.log(formatGroundScatterLog('hydrateSceneDocument', {
        sceneId,
        groundNodeId: groundNode?.id ?? null,
        hasSidecar: Boolean(sidecar),
        layerCount: runtimeState?.terrainScatter?.layers?.length ?? 0,
      }))
      this.bumpSceneRuntimeVersion(sceneId, 'hydrate')
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
        const nextReasons = { ...this.sceneRuntimeReasons }
        delete nextReasons[sceneId]
        this.sceneRuntimeReasons = nextReasons
        return
      }
      runtimeGroundScatters.forEach((state) => {
        deleteTerrainScatterStore(state.nodeId)
      })
      runtimeGroundScatters.clear()
      this.sceneRuntimeVersions = {}
      this.sceneRuntimeReasons = {}
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
    getSceneRuntimeReason(sceneId: string): string {
      return this.sceneRuntimeReasons[sceneId] ?? 'unknown'
    },
    replaceTerrainScatter(
      sceneId: string,
      nodeId: string,
      terrainScatter: TerrainScatterStoreSnapshot | null,
      options: { bumpRuntimeVersion?: boolean; reason?: string } = {},
    ): GroundScatterRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      const reason = typeof options.reason === 'string' && options.reason.trim().length > 0
        ? options.reason.trim()
        : 'unknown'
      // Callers transfer ownership of terrainScatter into the runtime sidecar store.
      state.terrainScatter = terrainScatter
      state.lastSyncReason = reason
      if (terrainScatter) {
        loadTerrainScatterSnapshot(nodeId, terrainScatter)
      } else {
        deleteTerrainScatterStore(nodeId)
      }
      console.log(formatGroundScatterLog('replaceTerrainScatter', {
        sceneId,
        nodeId,
        layerCount: terrainScatter?.layers?.length ?? 0,
        bumpRuntimeVersion: options.bumpRuntimeVersion !== false,
        reason,
      }))
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
    captureTerrainScatterSnapshot(sceneId: string, nodeId: string): GroundScatterRuntimeState {
      const state = ensureRuntimeState(sceneId, nodeId)
      state.terrainScatter = saveTerrainScatterSnapshot(nodeId) ?? null
      state.lastSyncReason = 'capture'
      console.log(formatGroundScatterLog('captureTerrainScatterSnapshot', {
        sceneId,
        nodeId,
        layerCount: state.terrainScatter?.layers?.length ?? 0,
      }))
      this.bumpSceneRuntimeVersion(sceneId, 'capture')
      return state
    },
  },
})
