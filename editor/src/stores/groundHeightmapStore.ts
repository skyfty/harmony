import { defineStore } from 'pinia'
import { createGroundHeightMap, type GroundDynamicMesh, type GroundPlanningMetadata, type SceneNode } from '@schema'
import {
  createGroundRuntimeMeshFromSidecar,
  serializeGroundHeightSidecar,
} from '@/utils/groundHeightSidecar'

const DB_NAME = 'harmony-editor-ground-heightmaps'
const DB_VERSION = 1
const STORE_SCENE_HEIGHTMAPS = 'sceneGroundHeightmaps'

const memoryWorkspaceGroundHeightmaps = new Map<string, Map<string, ArrayBuffer>>()
const runtimeWorkspaceGroundHeightmaps = new Map<string, Map<string, Map<string, GroundHeightRuntimeState>>>()
const workspaceDbPromises = new Map<string, Promise<IDBDatabase>>()
const workspaceDbInstances = new Map<string, IDBDatabase>()

export type GroundHeightRuntimeState = {
  nodeId: string
  rows: number
  columns: number
  manualHeightMap: Float64Array
  planningHeightMap: Float64Array
  planningMetadata: GroundPlanningMetadata | null
}

export type GroundRuntimeDynamicMesh = GroundDynamicMesh & {
  manualHeightMap: Float64Array
  planningHeightMap: Float64Array
}

function asGroundDynamicMesh(node: SceneNode | null | undefined): GroundDynamicMesh | null {
  const definition = node?.dynamicMesh
  if (definition?.type !== 'Ground') {
    return null
  }
  return definition
}

function getWorkspaceDbName(workspaceId: string): string {
  return `${DB_NAME}::${workspaceId}`
}

function cloneArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0)
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function getMemoryGroundHeightmaps(workspaceId: string): Map<string, ArrayBuffer> {
  let bucket = memoryWorkspaceGroundHeightmaps.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceGroundHeightmaps.set(workspaceId, bucket)
  }
  return bucket
}

function getRuntimeWorkspaceGroundHeightmaps(workspaceId: string): Map<string, Map<string, GroundHeightRuntimeState>> {
  let bucket = runtimeWorkspaceGroundHeightmaps.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    runtimeWorkspaceGroundHeightmaps.set(workspaceId, bucket)
  }
  return bucket
}

function getSceneRuntimeGroundHeightmaps(workspaceId: string, sceneId: string): Map<string, GroundHeightRuntimeState> {
  const workspaceBucket = getRuntimeWorkspaceGroundHeightmaps(workspaceId)
  let sceneBucket = workspaceBucket.get(sceneId)
  if (!sceneBucket) {
    sceneBucket = new Map()
    workspaceBucket.set(sceneId, sceneBucket)
  }
  return sceneBucket
}

function clonePlanningMetadata(metadata: GroundPlanningMetadata | null | undefined): GroundPlanningMetadata | null {
  if (!metadata) {
    return null
  }
  return {
    contourBounds: metadata.contourBounds
      ? {
          minRow: metadata.contourBounds.minRow,
          maxRow: metadata.contourBounds.maxRow,
          minColumn: metadata.contourBounds.minColumn,
          maxColumn: metadata.contourBounds.maxColumn,
        }
      : null,
    generatedAt: metadata.generatedAt,
  }
}

function createRuntimeState(nodeId: string, definition: GroundDynamicMesh): GroundHeightRuntimeState {
  const vertexCount = (definition.rows + 1) * (definition.columns + 1)
  return {
    nodeId,
    rows: definition.rows,
    columns: definition.columns,
    manualHeightMap: new Float64Array(createGroundHeightMap(definition.rows, definition.columns).buffer.slice(0, vertexCount * Float64Array.BYTES_PER_ELEMENT)),
    planningHeightMap: new Float64Array(createGroundHeightMap(definition.rows, definition.columns).buffer.slice(0, vertexCount * Float64Array.BYTES_PER_ELEMENT)),
    planningMetadata: clonePlanningMetadata(definition.planningMetadata ?? null),
  }
}

function ensureNodeRuntimeState(
  workspaceId: string,
  sceneId: string,
  nodeId: string,
  definition: GroundDynamicMesh,
): GroundHeightRuntimeState {
  const sceneBucket = getSceneRuntimeGroundHeightmaps(workspaceId, sceneId)
  const existing = sceneBucket.get(nodeId)
  if (
    existing
    && existing.rows === definition.rows
    && existing.columns === definition.columns
  ) {
    return existing
  }
  const created = createRuntimeState(nodeId, definition)
  sceneBucket.set(nodeId, created)
  return created
}

function cacheSceneGroundHeightmapsFromSidecar(
  workspaceId: string,
  sceneId: string,
  groundNode: SceneNode | null,
  sidecar: ArrayBuffer | null,
): void {
  const sceneBucket = new Map<string, GroundHeightRuntimeState>()
  const definition = asGroundDynamicMesh(groundNode)
  if (groundNode && definition) {
    const runtimeDefinition = createGroundRuntimeMeshFromSidecar(definition, sidecar)
    sceneBucket.set(groundNode.id, {
      nodeId: groundNode.id,
      rows: runtimeDefinition.rows,
      columns: runtimeDefinition.columns,
      manualHeightMap: new Float64Array(runtimeDefinition.manualHeightMap),
      planningHeightMap: new Float64Array(runtimeDefinition.planningHeightMap),
      planningMetadata: clonePlanningMetadata(runtimeDefinition.planningMetadata ?? null),
    })
  }
  getRuntimeWorkspaceGroundHeightmaps(workspaceId).set(sceneId, sceneBucket)
}

function ensureSceneGroundHeightmap(workspaceId: string, sceneId: string, groundNode: SceneNode | null): void {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return
  }
  ensureNodeRuntimeState(workspaceId, sceneId, groundNode.id, definition)
}

function buildSceneGroundSidecar(workspaceId: string, sceneId: string, groundNode: SceneNode | null): ArrayBuffer | null {
  const definition = asGroundDynamicMesh(groundNode)
  if (!groundNode || !definition) {
    return null
  }
  return serializeGroundHeightSidecar(
    useGroundHeightmapStore().resolveGroundRuntimeMesh(workspaceId, sceneId, groundNode.id, definition),
  )
}

function openDatabase(workspaceId: string): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'))
  }
  const dbName = getWorkspaceDbName(workspaceId)
  if (!workspaceDbPromises.has(dbName)) {
    workspaceDbPromises.set(
      dbName,
      new Promise((resolve, reject) => {
        const request = window.indexedDB.open(dbName, DB_VERSION)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE_SCENE_HEIGHTMAPS)) {
            db.createObjectStore(STORE_SCENE_HEIGHTMAPS, { keyPath: 'id' })
          }
        }
        request.onsuccess = () => {
          const db = request.result
          workspaceDbInstances.set(dbName, db)
          resolve(db)
        }
        request.onerror = () => reject(request.error ?? new Error('Failed to open ground heightmap database'))
      }),
    )
  }
  return workspaceDbPromises.get(dbName) as Promise<IDBDatabase>
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function readGroundHeightSidecar(workspaceId: string, sceneId: string): Promise<ArrayBuffer | null> {
  if (!isIndexedDbAvailable()) {
    const sidecar = getMemoryGroundHeightmaps(workspaceId).get(sceneId)
    return sidecar ? cloneArrayBuffer(sidecar) : null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_SCENE_HEIGHTMAPS, 'readonly')
  const store = tx.objectStore(STORE_SCENE_HEIGHTMAPS)
  const entry = await requestToPromise<{ id: string; buffer: ArrayBuffer } | undefined>(store.get(sceneId))
  return entry?.buffer ? cloneArrayBuffer(entry.buffer) : null
}

async function writeGroundHeightSidecar(workspaceId: string, sceneId: string, sidecar: ArrayBuffer | null): Promise<void> {
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryGroundHeightmaps(workspaceId)
    if (sidecar) {
      bucket.set(sceneId, cloneArrayBuffer(sidecar))
    } else {
      bucket.delete(sceneId)
    }
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_SCENE_HEIGHTMAPS, 'readwrite')
  const store = tx.objectStore(STORE_SCENE_HEIGHTMAPS)
  if (sidecar) {
    store.put({ id: sceneId, buffer: cloneArrayBuffer(sidecar) })
  } else {
    store.delete(sceneId)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write ground height sidecar'))
    tx.onabort = () => reject(tx.error ?? new Error('Ground height sidecar write aborted'))
  })
}

async function deleteWorkspaceStorage(workspaceId: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    memoryWorkspaceGroundHeightmaps.delete(workspaceId)
    runtimeWorkspaceGroundHeightmaps.delete(workspaceId)
    return
  }
  const dbName = getWorkspaceDbName(workspaceId)
  const existing = workspaceDbInstances.get(dbName)
  if (existing) {
    existing.close()
    workspaceDbInstances.delete(dbName)
  }
  workspaceDbPromises.delete(dbName)
  await new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to delete ground heightmap workspace storage'))
    request.onblocked = () => {
      console.warn(`[GroundHeightmapStore] Deleting workspace "${workspaceId}" is blocked by another tab`)
    }
  })
  memoryWorkspaceGroundHeightmaps.delete(workspaceId)
  runtimeWorkspaceGroundHeightmaps.delete(workspaceId)
}

export const useGroundHeightmapStore = defineStore('groundHeightmap', {
  actions: {
    async hydrateSceneDocument(workspaceId: string, sceneId: string, groundNode: SceneNode | null): Promise<void> {
      const sidecar = await readGroundHeightSidecar(workspaceId, sceneId)
      cacheSceneGroundHeightmapsFromSidecar(workspaceId, sceneId, groundNode, sidecar)
    },
    async saveSceneDocument(workspaceId: string, sceneId: string, groundNode: SceneNode | null): Promise<void> {
      ensureSceneGroundHeightmap(workspaceId, sceneId, groundNode)
      const sidecar = this.buildSceneDocumentSidecar(workspaceId, sceneId, groundNode)
      await writeGroundHeightSidecar(workspaceId, sceneId, sidecar)
    },
    buildSceneDocumentSidecar(workspaceId: string, sceneId: string, groundNode: SceneNode | null): ArrayBuffer | null {
      ensureSceneGroundHeightmap(workspaceId, sceneId, groundNode)
      return buildSceneGroundSidecar(workspaceId, sceneId, groundNode)
    },
    async saveSceneSidecar(workspaceId: string, sceneId: string, sidecar: ArrayBuffer | null): Promise<void> {
      await writeGroundHeightSidecar(workspaceId, sceneId, sidecar)
    },
    async loadSceneSidecar(workspaceId: string, sceneId: string): Promise<ArrayBuffer | null> {
      return await readGroundHeightSidecar(workspaceId, sceneId)
    },
    async deleteScene(workspaceId: string, sceneId: string): Promise<void> {
      getRuntimeWorkspaceGroundHeightmaps(workspaceId).delete(sceneId)
      await writeGroundHeightSidecar(workspaceId, sceneId, null)
    },
    async deleteWorkspaceStorage(workspaceId: string): Promise<void> {
      await deleteWorkspaceStorage(workspaceId)
    },
    getSceneGroundHeightmaps(workspaceId: string, sceneId: string): Map<string, GroundHeightRuntimeState> {
      return getRuntimeWorkspaceGroundHeightmaps(workspaceId).get(sceneId) ?? new Map()
    },
    getNodeGroundHeightmap(workspaceId: string, sceneId: string, nodeId: string): GroundHeightRuntimeState | null {
      return getRuntimeWorkspaceGroundHeightmaps(workspaceId).get(sceneId)?.get(nodeId) ?? null
    },
    ensureNodeGroundHeightmap(workspaceId: string, sceneId: string, nodeId: string, definition: GroundDynamicMesh): GroundHeightRuntimeState {
      return ensureNodeRuntimeState(workspaceId, sceneId, nodeId, definition)
    },
    resolveGroundRuntimeMesh(
      workspaceId: string,
      sceneId: string,
      nodeId: string,
      definition: GroundDynamicMesh,
    ): GroundRuntimeDynamicMesh {
      const state = ensureNodeRuntimeState(workspaceId, sceneId, nodeId, definition)
      return {
        ...definition,
        manualHeightMap: state.manualHeightMap,
        planningHeightMap: state.planningHeightMap,
        planningMetadata: clonePlanningMetadata(state.planningMetadata ?? definition.planningMetadata ?? null),
      }
    },
    replaceManualHeightMap(
      workspaceId: string,
      sceneId: string,
      nodeId: string,
      definition: GroundDynamicMesh,
      manualHeightMap: Float64Array,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(workspaceId, sceneId, nodeId, definition)
      state.rows = definition.rows
      state.columns = definition.columns
      state.manualHeightMap = new Float64Array(manualHeightMap)
      return state
    },
    replacePlanningHeightMap(
      workspaceId: string,
      sceneId: string,
      nodeId: string,
      definition: GroundDynamicMesh,
      planningHeightMap: Float64Array,
      planningMetadata?: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(workspaceId, sceneId, nodeId, definition)
      state.rows = definition.rows
      state.columns = definition.columns
      state.planningHeightMap = new Float64Array(planningHeightMap)
      if (planningMetadata !== undefined) {
        state.planningMetadata = clonePlanningMetadata(planningMetadata)
      }
      return state
    },
    updatePlanningMetadata(
      workspaceId: string,
      sceneId: string,
      nodeId: string,
      definition: GroundDynamicMesh,
      planningMetadata: GroundPlanningMetadata | null,
    ): GroundHeightRuntimeState {
      const state = ensureNodeRuntimeState(workspaceId, sceneId, nodeId, definition)
      state.planningMetadata = clonePlanningMetadata(planningMetadata)
      return state
    },
  },
})