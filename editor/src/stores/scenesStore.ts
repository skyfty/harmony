import { defineStore } from 'pinia'
import type { CompiledGroundManifest, GroundDynamicMesh, QuantizedTerrainDatasetRootManifest, SceneNode } from '@schema/core'
import type { ProjectAsset } from '@/types/project-asset'
import type { SceneSummary } from '@/types/scene-summary'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import { toRaw, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import type { SessionUser } from '@/types/auth'
import { useAuthStore } from '@/stores/authStore'
import { buildServerApiUrl } from '@/api/serverApiConfig'
import { exportScenePackageZip } from '@/utils/scenePackageExport'
import { ensureOptimizedGroundMeshOnDocument } from '@/utils/groundOptimizedMeshExport'
import {
  stripGroundHeightMapsFromSceneDocument,
} from '@/utils/groundHeightSidecar'
import { openPlanningImageDB, getPlanningImageLayerRecords } from '@/utils/planningImageStorage'
import { loadStoredScenesFromScenePackage } from '@/utils/scenePackageImport'
import { useGroundHeightmapStore } from './groundHeightmapStore'
import { useGroundSplatStore } from './groundSplatStore'
import { useGroundScatterStore } from './groundScatterStore'
import { useAssetCacheStore } from './assetCacheStore'
import { useSceneStore } from './sceneStore'

export type SceneWorkspaceType = 'local' | 'user'

interface SceneWorkspaceDescriptor {
  id: string
  type: SceneWorkspaceType
  label: string
  userId: string | null
  username: string | null
}

interface ScenesState {
  metadata: SceneSummary[]
  initialized: boolean
  initializing: boolean
  error: string | null
  workspaceId: string
  workspaceType: SceneWorkspaceType
  workspaceLabel: string
  workspaceUserId: string | null
  workspaceUsername: string | null
  workspaceRevision: number
}

const LOCAL_WORKSPACE_DESCRIPTOR: SceneWorkspaceDescriptor = {
  id: 'local',
  type: 'local',
  label: '本地用户',
  userId: null,
  username: null,
}

const USER_SCENE_API_PREFIX = '/api/user-scenes'
const SCENE_BUNDLE_SYNC_CONCURRENCY = 4

type UserSceneBundleSummaryDto = {
  id: string
  name: string
  projectId: string
  thumbnail: string | null
  createdAt: string
  updatedAt: string
  bundle: {
    url: string
    size: number
    etag: string
    updatedAt: string
  }
}

type ApiEnvelope<T> = {
  code: number
  data: T
  message: string
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string'
}

async function readResponseErrorMessage(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null)
    if (isApiEnvelope<unknown>(payload)) {
      return payload.message || null
    }
    if (payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string') {
      return (payload as { message: string }).message
    }
    return null
  }

  const text = await response.text().catch(() => '')
  if (!text) {
    return null
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (isApiEnvelope<unknown>(parsed)) {
      return parsed.message || null
    }
    if (parsed && typeof parsed === 'object' && typeof (parsed as { message?: unknown }).message === 'string') {
      return (parsed as { message: string }).message
    }
  } catch (_error) {
    return text
  }
  return text
}

function resolveWorkspaceDescriptor(user: SessionUser | null | undefined): SceneWorkspaceDescriptor {
  if (!user) {
    return { ...LOCAL_WORKSPACE_DESCRIPTOR }
  }
  const labelCandidate = user.displayName?.trim() || user.username?.trim()
  return {
    id: user.id,
    type: 'user',
    label: labelCandidate && labelCandidate.length ? labelCandidate : `用户 ${user.username}`,
    userId: user.id,
    username: user.username ?? null,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  iteratee: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) {
    return []
  }
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runWorker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) {
        return
      }
      const item = items[index] as T
      results[index] = await iteratee(item, index)
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()))
  return results
}

const DB_NAME = 'harmony-editor-scenes'
const DB_VERSION = 11
const STORE_METADATA = 'sceneMetadata'
const STORE_DOCUMENTS = 'sceneDocuments'
const STORE_GROUND_HEIGHTMAPS = 'sceneGroundHeightmaps'
const STORE_GROUND_SPLATS = 'sceneGroundSplats'
const STORE_GROUND_SCATTERS = 'sceneGroundScatters'
const STORE_TERRAIN_DATASET_MANIFESTS = 'sceneTerrainDatasetManifests'
const STORE_TERRAIN_DATASET_REGION_PACKS = 'sceneTerrainDatasetRegionPacks'
const STORE_COMPILED_GROUND_BUNDLES = 'sceneCompiledGroundBundles'

const memoryWorkspaceDocuments = new Map<string, Map<string, StoredSceneDocument>>()
const memoryWorkspaceGroundHeightSidecars = new Map<string, Map<string, ArrayBuffer>>()
const memoryWorkspaceGroundSplatSidecars = new Map<string, Map<string, ArrayBuffer>>()
const memoryWorkspaceGroundScatterSidecars = new Map<string, Map<string, ArrayBuffer>>()
const memoryWorkspaceTerrainDatasetManifests = new Map<string, Map<string, QuantizedTerrainDatasetRootManifest>>()
const memoryWorkspaceTerrainDatasetRegionPacks = new Map<string, Map<string, ArrayBuffer>>()
type StoredSceneCompiledGroundBundle = {
  buildKey: string
  sourceSignature: string
  manifest: CompiledGroundManifest
  files: Array<{ path: string; buffer: ArrayBuffer }>
}
const memoryWorkspaceCompiledGroundBundles = new Map<string, Map<string, StoredSceneCompiledGroundBundle>>()
const workspaceDbPromises = new Map<string, Promise<IDBDatabase>>()
const workspaceDbInstances = new Map<string, IDBDatabase>()

let authWatcherStop: WatchStopHandle | null = null
let initializationPromise: Promise<void> | null = null

function getMemoryWorkspace(workspaceId: string): Map<string, StoredSceneDocument> {
  let bucket = memoryWorkspaceDocuments.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceDocuments.set(workspaceId, bucket)
  }
  return bucket
}

function getMemoryGroundHeightSidecars(workspaceId: string): Map<string, ArrayBuffer> {
  let bucket = memoryWorkspaceGroundHeightSidecars.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceGroundHeightSidecars.set(workspaceId, bucket)
  }
  return bucket
}

function getMemoryGroundSplatSidecars(workspaceId: string): Map<string, ArrayBuffer> {
  let bucket = memoryWorkspaceGroundSplatSidecars.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceGroundSplatSidecars.set(workspaceId, bucket)
  }
  return bucket
}

function getMemoryGroundScatterSidecars(workspaceId: string): Map<string, ArrayBuffer> {
  let bucket = memoryWorkspaceGroundScatterSidecars.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceGroundScatterSidecars.set(workspaceId, bucket)
  }
  return bucket
}

function getMemoryCompiledGroundBundles(workspaceId: string): Map<string, StoredSceneCompiledGroundBundle> {
  let bucket = memoryWorkspaceCompiledGroundBundles.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceCompiledGroundBundles.set(workspaceId, bucket)
  }
  return bucket
}

function getMemoryTerrainDatasetManifests(workspaceId: string): Map<string, QuantizedTerrainDatasetRootManifest> {
  let bucket = memoryWorkspaceTerrainDatasetManifests.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceTerrainDatasetManifests.set(workspaceId, bucket)
  }
  return bucket
}

function getMemoryTerrainDatasetRegionPacks(workspaceId: string): Map<string, ArrayBuffer> {
  let bucket = memoryWorkspaceTerrainDatasetRegionPacks.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceTerrainDatasetRegionPacks.set(workspaceId, bucket)
  }
  return bucket
}

function getTerrainDatasetRegionPackStorageKey(sceneId: string, regionKey: string): string {
  return `${sceneId}:${regionKey}`
}

function getWorkspaceDbName(workspaceId: string): string {
  return `${DB_NAME}::${workspaceId}`
}

function prepareSceneDocumentForPersistence(document: StoredSceneDocument): StoredSceneDocument {
  return stripGroundTextureRuntimeUrlForPersistence(
    stripGroundSplatRuntimeDataForPersistence(
      stripGroundHeightMapsFromSceneDocument(cloneForIndexedDb(document)),
    ),
  )
}

function cloneArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0)
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  for (const node of nodes) {
    if (node.dynamicMesh?.type === 'Ground') {
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const nested = findGroundNode(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function findGroundNodeInDocument(document: StoredSceneDocument): SceneNode | null {
  return findGroundNode(document.nodes)
}

function findCatalogAssetById(document: Pick<StoredSceneDocument, 'assetCatalog'>, assetId: string): ProjectAsset | null {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalized) {
    return null
  }
  for (const list of Object.values(document.assetCatalog ?? {})) {
    if (!Array.isArray(list)) {
      continue
    }
    for (const asset of list) {
      if (asset?.id === normalized) {
        return asset
      }
    }
  }
  return null
}

function stripGroundTextureRuntimeUrlForPersistence(document: StoredSceneDocument): StoredSceneDocument {
  const groundNode = findGroundNodeInDocument(document)
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return document
  }
  const definition = groundNode.dynamicMesh as GroundDynamicMesh & {
    textureDataUrl?: string | null
  }
  if (!('textureDataUrl' in definition)) {
    return document
  }
  groundNode.dynamicMesh = {
    ...definition,
    textureDataUrl: null,
  }
  return document
}

function stripGroundSplatRuntimeDataForPersistence(document: StoredSceneDocument): StoredSceneDocument {
  const groundNode = findGroundNodeInDocument(document)
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return document
  }
  const definition = groundNode.dynamicMesh as GroundDynamicMesh
  groundNode.dynamicMesh = {
    ...definition,
    groundSurfaceChunks: null,
    groundSplatBake: definition.groundSplatBake
      ? {
          revision: Number.isFinite(definition.groundSplatBake.revision) ? Math.max(0, Math.trunc(definition.groundSplatBake.revision)) : 0,
          chunkTextureMap: null,
          surfaceLayerTextureAssetIds: definition.groundSplatBake.surfaceLayerTextureAssetIds ?? null,
        }
      : null,
  }
  return document
}

async function hydrateGroundTextureRuntimeUrl(document: StoredSceneDocument): Promise<void> {
  const groundNode = findGroundNodeInDocument(document)
  if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
    return
  }
  const definition = groundNode.dynamicMesh as GroundDynamicMesh & {
    textureAssetId?: string | null
    textureDataUrl?: string | null
    textureName?: string | null
  }
  const textureAssetId = typeof definition.textureAssetId === 'string' ? definition.textureAssetId.trim() : ''
  if (!textureAssetId) {
    return
  }
  const asset = findCatalogAssetById(document, textureAssetId)
  const assetCache = useAssetCacheStore()
  const assetDownloadUrl = typeof asset?.downloadUrl === 'string' ? asset.downloadUrl.trim() : ''
  const shouldUseAssetDownload = Boolean(asset && assetDownloadUrl && assetDownloadUrl !== textureAssetId)
  let entry = null
  try {
    entry = shouldUseAssetDownload
      ? await assetCache.ensureAssetEntry(textureAssetId, { asset: asset ?? undefined })
      : await assetCache.ensureAssetEntry(textureAssetId, { contentHash: textureAssetId })
  } catch (_error) {
    entry = await assetCache.ensureAssetEntry(textureAssetId, { contentHash: textureAssetId })
  }
  const resolvedUrl = entry?.blobUrl
    ?? entry?.downloadUrl
    ?? (assetDownloadUrl && assetDownloadUrl !== textureAssetId ? assetDownloadUrl : null)
  definition.textureDataUrl = resolvedUrl ?? null
  if ((!definition.textureName || !definition.textureName.trim()) && asset?.name) {
    definition.textureName = asset.name
  }
}

async function hydratePlanningImageReferences(document: StoredSceneDocument): Promise<void> {
  const planningImages = document.planningData?.images
  if (!Array.isArray(planningImages) || !planningImages.length) {
    return
  }

  const db = await openPlanningImageDB()
  try {
    const records = await getPlanningImageLayerRecords(db, document.id)
    if (!records.length) {
      return
    }

    const recordById = new Map(records.map((record) => [record.id, record] as const))
    for (const image of planningImages) {
      if (!image || typeof image !== 'object') {
        continue
      }
      const record = recordById.get(image.id)
      if (!record?.imageHash) {
        continue
      }
      if (!image.imageHash) {
        image.imageHash = record.imageHash
      }
      image.filename = image.filename ?? record.filename ?? null
      image.mimeType = image.mimeType ?? record.mimeType ?? null
      if (image.imageHash) {
        image.url = ''
      }
    }
  } finally {
    db.close()
  }
}

// Deeply unwrap Vue proxies so IndexedDB receives cloneable values.
function cloneForIndexedDb<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T
  }

  if (value instanceof URL) {
    return new URL(value.toString()) as T
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T
  }

  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return new DataView(value.buffer.slice(0), value.byteOffset, value.byteLength) as T
    }
    const ctor = (value as any).constructor as { new (buffer: ArrayBufferLike | ArrayLike<unknown>): any }
    return new ctor(value as any) as T
  }

  const rawObject = toRaw(value as object)
  if (seen.has(rawObject)) {
    return seen.get(rawObject)
  }

  if (rawObject instanceof Map) {
    const clone = new Map()
    seen.set(rawObject, clone)
    rawObject.forEach((mapValue, mapKey) => {
      clone.set(mapKey, cloneForIndexedDb(mapValue, seen))
    })
    return clone as unknown as T
  }

  if (rawObject instanceof Set) {
    const clone = new Set()
    seen.set(rawObject, clone)
    rawObject.forEach((setValue) => {
      clone.add(cloneForIndexedDb(setValue, seen))
    })
    return clone as unknown as T
  }

  if (Array.isArray(rawObject)) {
    const clone: unknown[] = []
    seen.set(rawObject, clone)
    rawObject.forEach((item) => {
      clone.push(cloneForIndexedDb(item, seen))
    })
    return clone as T
  }

  const clone: Record<string, unknown> = {}
  seen.set(rawObject, clone)
  Object.keys(rawObject).forEach((key) => {
    clone[key] = cloneForIndexedDb((rawObject as Record<string, unknown>)[key], seen)
  })
  return clone as T
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
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
        request.onupgradeneeded = (event) => {
          const db = request.result
          const oldVersion = event.oldVersion ?? 0
          if (!db.objectStoreNames.contains(STORE_METADATA)) {
            db.createObjectStore(STORE_METADATA, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
            db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_GROUND_HEIGHTMAPS)) {
            db.createObjectStore(STORE_GROUND_HEIGHTMAPS, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_GROUND_SPLATS)) {
            db.createObjectStore(STORE_GROUND_SPLATS, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_GROUND_SCATTERS)) {
            db.createObjectStore(STORE_GROUND_SCATTERS, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_TERRAIN_DATASET_MANIFESTS)) {
            db.createObjectStore(STORE_TERRAIN_DATASET_MANIFESTS, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_TERRAIN_DATASET_REGION_PACKS)) {
            db.createObjectStore(STORE_TERRAIN_DATASET_REGION_PACKS, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_COMPILED_GROUND_BUNDLES)) {
            db.createObjectStore(STORE_COMPILED_GROUND_BUNDLES, { keyPath: 'id' })
          }
          if (request.transaction && oldVersion < 3) {
            request.transaction.objectStore(STORE_METADATA).clear()
            request.transaction.objectStore(STORE_DOCUMENTS).clear()
            request.transaction.objectStore(STORE_GROUND_HEIGHTMAPS).clear()
            request.transaction.objectStore(STORE_GROUND_SPLATS).clear()
            request.transaction.objectStore(STORE_GROUND_SCATTERS).clear()
          }
        }
        request.onsuccess = () => {
          const db = request.result
          workspaceDbInstances.set(dbName, db)
          resolve(db)
        }
        request.onerror = () => reject(request.error ?? new Error('Failed to open scenes database'))
      }),
    )
  }
  return workspaceDbPromises.get(dbName) as Promise<IDBDatabase>
}

async function deleteWorkspaceStorage(workspaceId: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    memoryWorkspaceDocuments.delete(workspaceId)
    memoryWorkspaceGroundHeightSidecars.delete(workspaceId)
    memoryWorkspaceGroundSplatSidecars.delete(workspaceId)
    memoryWorkspaceGroundScatterSidecars.delete(workspaceId)
    memoryWorkspaceTerrainDatasetManifests.delete(workspaceId)
    memoryWorkspaceTerrainDatasetRegionPacks.delete(workspaceId)
    memoryWorkspaceCompiledGroundBundles.delete(workspaceId)
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
    request.onerror = () => reject(request.error ?? new Error('Failed to delete workspace storage'))
    request.onblocked = () => {
      console.warn(`[ScenesStore] Deleting workspace "${workspaceId}" is blocked by another tab`)
    }
  })
  memoryWorkspaceDocuments.delete(workspaceId)
  memoryWorkspaceGroundHeightSidecars.delete(workspaceId)
  memoryWorkspaceGroundSplatSidecars.delete(workspaceId)
  memoryWorkspaceGroundScatterSidecars.delete(workspaceId)
  memoryWorkspaceTerrainDatasetManifests.delete(workspaceId)
  memoryWorkspaceTerrainDatasetRegionPacks.delete(workspaceId)
  memoryWorkspaceCompiledGroundBundles.delete(workspaceId)
}

async function readSceneGroundHeightSidecar(workspaceId: string, sceneId: string): Promise<ArrayBuffer | null> {
  if (!isIndexedDbAvailable()) {
    const sidecar = getMemoryGroundHeightSidecars(workspaceId).get(sceneId)
    return sidecar ? cloneArrayBuffer(sidecar) : null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_GROUND_HEIGHTMAPS, 'readonly')
  const store = tx.objectStore(STORE_GROUND_HEIGHTMAPS)
  const entry = await requestToPromise<{ id: string; buffer: ArrayBuffer } | undefined>(store.get(sceneId))
  return entry?.buffer ?? null
}

async function writeSceneGroundHeightSidecar(workspaceId: string, sceneId: string, sidecar: ArrayBuffer | null): Promise<void> {
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryGroundHeightSidecars(workspaceId)
    if (sidecar) {
      bucket.set(sceneId, cloneArrayBuffer(sidecar))
    } else {
      bucket.delete(sceneId)
    }
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_GROUND_HEIGHTMAPS, 'readwrite')
  const store = tx.objectStore(STORE_GROUND_HEIGHTMAPS)
  if (sidecar) {
    store.put({ id: sceneId, buffer: cloneArrayBuffer(sidecar) })
  } else {
    store.delete(sceneId)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene ground height sidecar'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene ground height sidecar write aborted'))
  })
}

async function readSceneGroundSplatSidecar(workspaceId: string, sceneId: string): Promise<ArrayBuffer | null> {
  if (!isIndexedDbAvailable()) {
    const sidecar = getMemoryGroundSplatSidecars(workspaceId).get(sceneId)
    return sidecar ? cloneArrayBuffer(sidecar) : null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_GROUND_SPLATS, 'readonly')
  const store = tx.objectStore(STORE_GROUND_SPLATS)
  const entry = await requestToPromise<{ id: string; buffer: ArrayBuffer } | undefined>(store.get(sceneId))
  return entry?.buffer ?? null
}

async function writeSceneGroundSplatSidecar(workspaceId: string, sceneId: string, sidecar: ArrayBuffer | null): Promise<void> {
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryGroundSplatSidecars(workspaceId)
    if (sidecar) {
      bucket.set(sceneId, cloneArrayBuffer(sidecar))
    } else {
      bucket.delete(sceneId)
    }
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_GROUND_SPLATS, 'readwrite')
  const store = tx.objectStore(STORE_GROUND_SPLATS)
  if (sidecar) {
    store.put({ id: sceneId, buffer: cloneArrayBuffer(sidecar) })
  } else {
    store.delete(sceneId)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene ground splat sidecar'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene ground splat sidecar write aborted'))
  })
}

async function readSceneGroundScatterSidecar(workspaceId: string, sceneId: string): Promise<ArrayBuffer | null> {
  if (!isIndexedDbAvailable()) {
    const sidecar = getMemoryGroundScatterSidecars(workspaceId).get(sceneId)
    return sidecar ? cloneArrayBuffer(sidecar) : null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_GROUND_SCATTERS, 'readonly')
  const store = tx.objectStore(STORE_GROUND_SCATTERS)
  const entry = await requestToPromise<{ id: string; buffer: ArrayBuffer } | undefined>(store.get(sceneId))
  return entry?.buffer ?? null
}

async function writeSceneGroundScatterSidecar(workspaceId: string, sceneId: string, sidecar: ArrayBuffer | null): Promise<void> {
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryGroundScatterSidecars(workspaceId)
    if (sidecar) {
      bucket.set(sceneId, cloneArrayBuffer(sidecar))
    } else {
      bucket.delete(sceneId)
    }
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_GROUND_SCATTERS, 'readwrite')
  const store = tx.objectStore(STORE_GROUND_SCATTERS)
  if (sidecar) {
    store.put({ id: sceneId, buffer: cloneArrayBuffer(sidecar) })
  } else {
    store.delete(sceneId)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene ground scatter sidecar'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene ground scatter sidecar write aborted'))
  })
}

async function readSceneTerrainDatasetManifest(
  workspaceId: string,
  sceneId: string,
): Promise<QuantizedTerrainDatasetRootManifest | null> {
  if (!isIndexedDbAvailable()) {
    const manifest = getMemoryTerrainDatasetManifests(workspaceId).get(sceneId)
    return manifest ? cloneForIndexedDb(manifest) : null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_TERRAIN_DATASET_MANIFESTS, 'readonly')
  const store = tx.objectStore(STORE_TERRAIN_DATASET_MANIFESTS)
  const entry = await requestToPromise<{ id: string; manifest: QuantizedTerrainDatasetRootManifest } | undefined>(store.get(sceneId))
  return entry?.manifest ? cloneForIndexedDb(entry.manifest) : null
}

async function writeSceneTerrainDatasetManifest(
  workspaceId: string,
  sceneId: string,
  manifest: QuantizedTerrainDatasetRootManifest | null,
): Promise<void> {
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryTerrainDatasetManifests(workspaceId)
    if (manifest) {
      bucket.set(sceneId, cloneForIndexedDb(manifest))
    } else {
      bucket.delete(sceneId)
    }
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_TERRAIN_DATASET_MANIFESTS, 'readwrite')
  const store = tx.objectStore(STORE_TERRAIN_DATASET_MANIFESTS)
  if (manifest) {
    store.put({ id: sceneId, manifest: cloneForIndexedDb(manifest) })
  } else {
    store.delete(sceneId)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene terrain dataset manifest'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene terrain dataset manifest write aborted'))
  })
}

async function readSceneTerrainDatasetRegionPack(
  workspaceId: string,
  sceneId: string,
  regionKey: string,
): Promise<ArrayBuffer | null> {
  const storageKey = getTerrainDatasetRegionPackStorageKey(sceneId, regionKey)
  if (!isIndexedDbAvailable()) {
    const buffer = getMemoryTerrainDatasetRegionPacks(workspaceId).get(storageKey)
    return buffer ? cloneArrayBuffer(buffer) : null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_TERRAIN_DATASET_REGION_PACKS, 'readonly')
  const store = tx.objectStore(STORE_TERRAIN_DATASET_REGION_PACKS)
  const entry = await requestToPromise<{ id: string; buffer: ArrayBuffer } | undefined>(store.get(storageKey))
  return entry?.buffer ?? null
}

async function writeSceneTerrainDatasetRegionPack(
  workspaceId: string,
  sceneId: string,
  regionKey: string,
  data: ArrayBuffer | null,
): Promise<void> {
  const storageKey = getTerrainDatasetRegionPackStorageKey(sceneId, regionKey)
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryTerrainDatasetRegionPacks(workspaceId)
    if (data) {
      bucket.set(storageKey, cloneArrayBuffer(data))
    } else {
      bucket.delete(storageKey)
    }
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_TERRAIN_DATASET_REGION_PACKS, 'readwrite')
  const store = tx.objectStore(STORE_TERRAIN_DATASET_REGION_PACKS)
  if (data) {
    store.put({ id: storageKey, sceneId, regionKey, buffer: cloneArrayBuffer(data) })
  } else {
    store.delete(storageKey)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene terrain dataset region pack'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene terrain dataset region pack write aborted'))
  })
}

function cloneStoredCompiledGroundBundle(bundle: StoredSceneCompiledGroundBundle): StoredSceneCompiledGroundBundle {
  return {
    buildKey: bundle.buildKey,
    sourceSignature: bundle.sourceSignature,
    manifest: cloneForIndexedDb(bundle.manifest),
    files: Array.isArray(bundle.files)
      ? bundle.files.map((entry) => ({
          path: entry.path,
          buffer: cloneArrayBuffer(entry.buffer),
        }))
      : [],
  }
}

async function readSceneCompiledGroundBundle(
  workspaceId: string,
  sceneId: string,
): Promise<StoredSceneCompiledGroundBundle | null> {
  if (!isIndexedDbAvailable()) {
    const bundle = getMemoryCompiledGroundBundles(workspaceId).get(sceneId)
    return bundle ? cloneStoredCompiledGroundBundle(bundle) : null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_COMPILED_GROUND_BUNDLES, 'readonly')
  const store = tx.objectStore(STORE_COMPILED_GROUND_BUNDLES)
  const entry = await requestToPromise<{ id: string } & StoredSceneCompiledGroundBundle | undefined>(store.get(sceneId))
  return entry ? cloneStoredCompiledGroundBundle(entry) : null
}

async function writeSceneCompiledGroundBundle(
  workspaceId: string,
  sceneId: string,
  bundle: StoredSceneCompiledGroundBundle | null,
): Promise<void> {
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryCompiledGroundBundles(workspaceId)
    if (bundle) {
      bucket.set(sceneId, cloneStoredCompiledGroundBundle(bundle))
    } else {
      bucket.delete(sceneId)
    }
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_COMPILED_GROUND_BUNDLES, 'readwrite')
  const store = tx.objectStore(STORE_COMPILED_GROUND_BUNDLES)
  if (bundle) {
    store.put({
      id: sceneId,
      ...cloneStoredCompiledGroundBundle(bundle),
    })
  } else {
    store.delete(sceneId)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene compiled ground bundle'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene compiled ground bundle write aborted'))
  })
}

async function replaceWorkspaceDocuments(
  workspaceId: string,
  documents: StoredSceneDocument[],
  groundHeightSidecars: Record<string, ArrayBuffer | null> = {},
  groundSplatSidecars: Record<string, ArrayBuffer | null> = {},
  groundScatterSidecars: Record<string, ArrayBuffer | null> = {},
): Promise<void> {
  await deleteWorkspaceStorage(workspaceId)
  if (!documents.length) {
    return
  }
  await writeSceneDocuments(workspaceId, documents, groundHeightSidecars, groundSplatSidecars, groundScatterSidecars)
}

async function fetchUserScenesFromServer(authStore: ReturnType<typeof useAuthStore>): Promise<UserSceneBundleSummaryDto[] | null> {
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    return null
  }
  const url = buildServerApiUrl(USER_SCENE_API_PREFIX)
  const headers = new Headers({ Accept: 'application/json' })
  headers.set('Authorization', authorization)
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers,
    cache: 'no-cache',
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch scenes (${response.status})`)
  }
  const payloadRaw = await response.json().catch(() => null)
  const payload =
    payloadRaw && typeof payloadRaw === 'object' && 'code' in payloadRaw && 'data' in payloadRaw
      ? (payloadRaw as { data?: unknown }).data
      : payloadRaw
  const entries: unknown =
    payload && typeof payload === 'object' && Array.isArray((payload as { scenes?: unknown[] }).scenes)
      ? (payload as { scenes?: unknown[] }).scenes
      : null
  if (!Array.isArray(entries)) {
    return []
  }
  return (entries as UserSceneBundleSummaryDto[]).filter((doc): doc is UserSceneBundleSummaryDto => !!doc && typeof doc.id === 'string')
}

async function downloadSceneBundleZip(
  bundleUrl: string,
  authStore: ReturnType<typeof useAuthStore>,
  options: { etag?: string | null } = {},
): Promise<{ bytes: ArrayBuffer; etag: string | null } | null> {
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    return null
  }
  const url = buildServerApiUrl(bundleUrl)
  const headers = new Headers({ Accept: 'application/zip' })
  headers.set('Authorization', authorization)
  if (options.etag) {
    headers.set('If-None-Match', options.etag)
  }
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers,
    cache: 'no-cache',
  })
  if (response.status === 304) {
    return null
  }
  if (!response.ok) {
    throw new Error(`Failed to download scene bundle (${response.status})`)
  }
  const etag = response.headers.get('ETag')
  const bytes = await response.arrayBuffer()
  return { bytes, etag }
}

async function unpackSceneBundleIntoStores(
  zipBytes: ArrayBuffer,
  options: { allowLandformNodes?: boolean } = {},
): Promise<{ document: StoredSceneDocument; groundHeightSidecar: ArrayBuffer | null; groundSplatSidecar: ArrayBuffer | null; groundScatterSidecar: ArrayBuffer | null; terrainDatasetManifest: QuantizedTerrainDatasetRootManifest | null; terrainDatasetRegionPacks: Record<string, ArrayBuffer | null> }> {
  const pkg = await loadStoredScenesFromScenePackage(zipBytes, { allowLandformNodes: options.allowLandformNodes === true })
  const scene = pkg.scenes[0]
  if (!scene) {
    throw new Error('Scene bundle missing scene entry')
  }
  return {
    document: scene,
    groundHeightSidecar: pkg.groundHeightSidecars[scene.id] ?? null,
    groundSplatSidecar: pkg.groundSplatSidecars[scene.id] ?? null,
    groundScatterSidecar: pkg.groundScatterSidecars[scene.id] ?? null,
    terrainDatasetManifest: pkg.terrainDatasetManifests[scene.id] ?? null,
    terrainDatasetRegionPacks: pkg.terrainDatasetRegionPacks[scene.id] ?? {},
  }
}

async function uploadSceneToServer(document: StoredSceneDocument, authStore: ReturnType<typeof useAuthStore>): Promise<void> {
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    return
  }

  const bundleUrl = buildServerApiUrl(`${USER_SCENE_API_PREFIX}/${encodeURIComponent(document.id)}/bundle`)
  const bundleBlob = await exportScenePackageZip({
    project: {
      id: document.projectId,
      name: document.projectId,
      defaultSceneId: document.id,
      lastEditedSceneId: document.id,
      sceneOrder: [document.id],
    },
    scenes: [{ id: document.id, document: cloneForIndexedDb(document) }],
    planningDataMode: 'withPlanningData',
    preserveLandformNodes: true,
  })

  const filename = `${document.name || document.id}.zip`
  const form = new FormData()
  form.append('file', new File([bundleBlob], filename, { type: 'application/zip' }))

  const headers = new Headers()
  headers.set('Authorization', authorization)
  const response = await fetch(bundleUrl, {
    method: 'PUT',
    credentials: 'include',
    headers,
    body: form,
  })
  if (!response.ok) {
    const serverMessage = await readResponseErrorMessage(response)
    const detail = serverMessage ? `: ${serverMessage}` : ''
    throw new Error(`Failed to upload scene bundle (${response.status})${detail}`)
  }
}

async function removeSceneFromServer(sceneId: string, authStore: ReturnType<typeof useAuthStore>): Promise<void> {
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    return
  }
  const url = buildServerApiUrl(`${USER_SCENE_API_PREFIX}/${encodeURIComponent(sceneId)}`)
  const headers = new Headers({ Accept: 'application/json' })
  headers.set('Authorization', authorization)
  const response = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete scene (${response.status})`)
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function readAllMetadata(workspaceId: string): Promise<SceneSummary[]> {
  if (!isIndexedDbAvailable()) {
    const records: SceneSummary[] = []
    const bucket = getMemoryWorkspace(workspaceId)
    bucket.forEach((doc) => {
      records.push({
        id: doc.id,
        name: doc.name,
        projectId: doc.projectId,
        thumbnail: doc.thumbnail ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      })
    })
    return records
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_METADATA, 'readonly')
  const store = tx.objectStore(STORE_METADATA)
  const records = await requestToPromise<SceneSummary[]>(store.getAll())
  return records
}

async function readSceneDocument(
  workspaceId: string,
  id: string,
  options: { hydrateGroundRuntime?: boolean } = {},
): Promise<StoredSceneDocument | null> {
  const groundHeightmapStore = useGroundHeightmapStore()
  const groundSplatStore = useGroundSplatStore()
  const groundScatterStore = useGroundScatterStore()
  if (!isIndexedDbAvailable()) {
    const document = getMemoryWorkspace(workspaceId).get(id)
    if (!document) {
      return null
    }
    const hydrated = cloneForIndexedDb(document)
    ensureOptimizedGroundMeshOnDocument(hydrated)
    if (options.hydrateGroundRuntime) {
      const sidecar = await readSceneGroundHeightSidecar(workspaceId, hydrated.id)
      await groundHeightmapStore.hydrateSceneDocument(findGroundNodeInDocument(hydrated), sidecar)
      const splatSidecar = await readSceneGroundSplatSidecar(workspaceId, hydrated.id)
      await groundSplatStore.hydrateSceneDocument(hydrated.id, findGroundNodeInDocument(hydrated), splatSidecar)
      const scatterSidecar = await readSceneGroundScatterSidecar(workspaceId, hydrated.id)
      await groundScatterStore.hydrateSceneDocument(hydrated.id, findGroundNodeInDocument(hydrated), scatterSidecar)
    }
    await hydrateGroundTextureRuntimeUrl(hydrated)
    await hydratePlanningImageReferences(hydrated)
    return stripGroundHeightMapsFromSceneDocument(hydrated)
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_DOCUMENTS, 'readonly')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const result = await requestToPromise<StoredSceneDocument | undefined>(docs.get(id))
  if (!result) {
    return null
  }
  ensureOptimizedGroundMeshOnDocument(result)
  if (options.hydrateGroundRuntime) {
    const sidecar = await readSceneGroundHeightSidecar(workspaceId, result.id)
    await groundHeightmapStore.hydrateSceneDocument(findGroundNodeInDocument(result), sidecar)
    const splatSidecar = await readSceneGroundSplatSidecar(workspaceId, result.id)
    await groundSplatStore.hydrateSceneDocument(result.id, findGroundNodeInDocument(result), splatSidecar)
    const scatterSidecar = await readSceneGroundScatterSidecar(workspaceId, result.id)
    await groundScatterStore.hydrateSceneDocument(result.id, findGroundNodeInDocument(result), scatterSidecar)
  }
  await hydrateGroundTextureRuntimeUrl(result)
  await hydratePlanningImageReferences(result)
  return stripGroundHeightMapsFromSceneDocument(result)
}

function toMetadata(document: StoredSceneDocument): SceneSummary {
  return {
    id: document.id,
    name: document.name,
    projectId: document.projectId,
    thumbnail: document.thumbnail ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

function toMetadataWithBundleEtag(document: StoredSceneDocument, bundleEtag: string | null): SceneSummary {
  return {
    ...toMetadata(document),
    bundleEtag,
  }
}

async function readSceneBundleFromWorkspace(
  workspaceId: string,
  sceneId: string,
): Promise<{
  document: StoredSceneDocument
  groundHeightSidecar: ArrayBuffer | null
  groundSplatSidecar: ArrayBuffer | null
  groundScatterSidecar: ArrayBuffer | null
  terrainDatasetManifest: QuantizedTerrainDatasetRootManifest | null
  terrainDatasetRegionPacks: Record<string, ArrayBuffer | null>
} | null> {
  const document = await readSceneDocument(workspaceId, sceneId, { hydrateGroundRuntime: false })
  if (!document) {
    return null
  }
  const terrainDatasetManifest = await readSceneTerrainDatasetManifest(workspaceId, sceneId)
  const terrainDatasetRegionPacks: Record<string, ArrayBuffer | null> = {}
  if (terrainDatasetManifest?.regions && Array.isArray(terrainDatasetManifest.regions)) {
    for (const region of terrainDatasetManifest.regions) {
      terrainDatasetRegionPacks[region.regionKey] = await readSceneTerrainDatasetRegionPack(workspaceId, sceneId, region.regionKey)
    }
  }
  return {
    document,
    groundHeightSidecar: await readSceneGroundHeightSidecar(workspaceId, sceneId),
    groundSplatSidecar: await readSceneGroundSplatSidecar(workspaceId, sceneId),
    groundScatterSidecar: await readSceneGroundScatterSidecar(workspaceId, sceneId),
    terrainDatasetManifest,
    terrainDatasetRegionPacks,
  }
}

async function writeSceneBundleEtags(
  workspaceId: string,
  bundleEtags: Record<string, string | null>,
): Promise<void> {
  const entries = Object.entries(bundleEtags)
  if (!entries.length) {
    return
  }
  if (!isIndexedDbAvailable()) {
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_METADATA, 'readwrite')
  const store = tx.objectStore(STORE_METADATA)
  for (const [sceneId, bundleEtag] of entries) {
    const existing = await requestToPromise<SceneSummary | undefined>(store.get(sceneId))
    if (!existing) {
      continue
    }
    store.put({ ...existing, bundleEtag })
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene bundle etags'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene bundle etag write aborted'))
  })
}

async function writeSceneDocuments(
  workspaceId: string,
  documents: StoredSceneDocument[],
  groundHeightSidecars: Record<string, ArrayBuffer | null> = {},
  groundSplatSidecars: Record<string, ArrayBuffer | null> = {},
  groundScatterSidecars: Record<string, ArrayBuffer | null> = {},
  terrainDatasetManifests: Record<string, QuantizedTerrainDatasetRootManifest | null> = {},
  terrainDatasetRegionPacks: Record<string, Record<string, ArrayBuffer | null>> = {},
): Promise<void> {
  const preparedDocs = documents.map((doc) => ({ document: prepareSceneDocumentForPersistence(doc), source: doc }))
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryWorkspace(workspaceId)
    const sidecarBucket = getMemoryGroundHeightSidecars(workspaceId)
    preparedDocs.forEach(({ document: prepared }) => {
      bucket.set(prepared.id, prepared)
      const sidecar = groundHeightSidecars[prepared.id] ?? null
      const splatSidecar = groundSplatSidecars[prepared.id] ?? null
      const scatterSidecar = groundScatterSidecars[prepared.id] ?? null
      if (sidecar) {
        sidecarBucket.set(prepared.id, cloneArrayBuffer(sidecar))
      } else {
        sidecarBucket.delete(prepared.id)
      }
      if (splatSidecar) {
        getMemoryGroundSplatSidecars(workspaceId).set(prepared.id, cloneArrayBuffer(splatSidecar))
      } else {
        getMemoryGroundSplatSidecars(workspaceId).delete(prepared.id)
      }
      if (scatterSidecar) {
        getMemoryGroundScatterSidecars(workspaceId).set(prepared.id, cloneArrayBuffer(scatterSidecar))
      } else {
        getMemoryGroundScatterSidecars(workspaceId).delete(prepared.id)
      }

      const terrainManifest = terrainDatasetManifests[prepared.id] ?? null
      if (terrainManifest) {
        getMemoryTerrainDatasetManifests(workspaceId).set(prepared.id, structuredClone(terrainManifest))
      } else {
        getMemoryTerrainDatasetManifests(workspaceId).delete(prepared.id)
      }

      const regionPackBucket = getMemoryTerrainDatasetRegionPacks(workspaceId)
      Array.from(regionPackBucket.keys())
        .filter((key) => key.startsWith(`${prepared.id}:`))
        .forEach((key) => regionPackBucket.delete(key))
      const regionEntries = terrainDatasetRegionPacks[prepared.id] ?? {}
      Object.entries(regionEntries).forEach(([regionKey, regionBuffer]) => {
        if (regionBuffer) {
          regionPackBucket.set(getTerrainDatasetRegionPackStorageKey(prepared.id, regionKey), cloneArrayBuffer(regionBuffer))
        }
      })
    })
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA, STORE_GROUND_HEIGHTMAPS, STORE_GROUND_SPLATS, STORE_GROUND_SCATTERS], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  const heightmaps = tx.objectStore(STORE_GROUND_HEIGHTMAPS)
  const splats = tx.objectStore(STORE_GROUND_SPLATS)
  const dynamics = tx.objectStore(STORE_GROUND_SCATTERS)
  preparedDocs.forEach(({ document: prepared }) => {
    docs.put(prepared)
    meta.put(toMetadata(prepared))
    const sidecar = groundHeightSidecars[prepared.id] ?? null
    const splatSidecar = groundSplatSidecars[prepared.id] ?? null
    const scatterSidecar = groundScatterSidecars[prepared.id] ?? null
    if (sidecar) {
      heightmaps.put({ id: prepared.id, buffer: cloneArrayBuffer(sidecar) })
    } else {
      heightmaps.delete(prepared.id)
    }
    if (splatSidecar) {
      splats.put({ id: prepared.id, buffer: cloneArrayBuffer(splatSidecar) })
    } else {
      splats.delete(prepared.id)
    }
    if (scatterSidecar) {
      dynamics.put({ id: prepared.id, buffer: cloneArrayBuffer(scatterSidecar) })
    } else {
      dynamics.delete(prepared.id)
    }
  })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene documents'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene batch write aborted'))
  })

  for (const { document: prepared } of preparedDocs) {
    await writeSceneTerrainDatasetManifest(workspaceId, prepared.id, terrainDatasetManifests[prepared.id] ?? null)
    const regionEntries = terrainDatasetRegionPacks[prepared.id] ?? {}
    const existingRegionKeys = await (async () => {
      const dbForRegions = await openDatabase(workspaceId)
      const regionTx = dbForRegions.transaction(STORE_TERRAIN_DATASET_REGION_PACKS, 'readonly')
      const regionStore = regionTx.objectStore(STORE_TERRAIN_DATASET_REGION_PACKS)
      const keys: string[] = []
      await new Promise<void>((resolve, reject) => {
        const request = regionStore.openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve()
            return
          }
          const entry = cursor.value as { sceneId?: string; regionKey?: string } | undefined
          if (entry?.sceneId === prepared.id && typeof entry.regionKey === 'string') {
            keys.push(entry.regionKey)
          }
          cursor.continue()
        }
        request.onerror = () => reject(request.error ?? new Error('Failed to read scene terrain dataset region keys'))
        regionTx.onabort = () => reject(regionTx.error ?? new Error('Scene terrain dataset region key scan aborted'))
      })
      return keys
    })()
    for (const regionKey of existingRegionKeys) {
      if (!(regionKey in regionEntries)) {
        await writeSceneTerrainDatasetRegionPack(workspaceId, prepared.id, regionKey, null)
      }
    }
    for (const [regionKey, regionBuffer] of Object.entries(regionEntries)) {
      await writeSceneTerrainDatasetRegionPack(workspaceId, prepared.id, regionKey, regionBuffer ?? null)
    }
  }
}

async function removeSceneDocument(workspaceId: string, id: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    getMemoryWorkspace(workspaceId).delete(id)
    getMemoryGroundHeightSidecars(workspaceId).delete(id)
    getMemoryGroundSplatSidecars(workspaceId).delete(id)
    getMemoryGroundScatterSidecars(workspaceId).delete(id)
    getMemoryTerrainDatasetManifests(workspaceId).delete(id)
    const regionPackBucket = getMemoryTerrainDatasetRegionPacks(workspaceId)
    Array.from(regionPackBucket.keys())
      .filter((key) => key.startsWith(`${id}:`))
      .forEach((key) => regionPackBucket.delete(key))
    getMemoryCompiledGroundBundles(workspaceId).delete(id)
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([
    STORE_DOCUMENTS,
    STORE_METADATA,
    STORE_GROUND_HEIGHTMAPS,
    STORE_GROUND_SPLATS,
    STORE_GROUND_SCATTERS,
    STORE_TERRAIN_DATASET_MANIFESTS,
    STORE_TERRAIN_DATASET_REGION_PACKS,
    STORE_COMPILED_GROUND_BUNDLES,
  ], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  const heightmaps = tx.objectStore(STORE_GROUND_HEIGHTMAPS)
  const splats = tx.objectStore(STORE_GROUND_SPLATS)
  const dynamics = tx.objectStore(STORE_GROUND_SCATTERS)
  const terrainManifests = tx.objectStore(STORE_TERRAIN_DATASET_MANIFESTS)
  const terrainRegionPacks = tx.objectStore(STORE_TERRAIN_DATASET_REGION_PACKS)
  const compiledGroundBundles = tx.objectStore(STORE_COMPILED_GROUND_BUNDLES)
  docs.delete(id)
  meta.delete(id)
  heightmaps.delete(id)
  splats.delete(id)
  dynamics.delete(id)
  terrainManifests.delete(id)
  compiledGroundBundles.delete(id)
  const regionPackKeys = await requestToPromise<IDBValidKey[]>(terrainRegionPacks.getAllKeys())
  regionPackKeys
    .filter((key): key is string => typeof key === 'string' && key.startsWith(`${id}:`))
    .forEach((key) => terrainRegionPacks.delete(key))
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete scene document'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene delete aborted'))
  })
}

export const useScenesStore = defineStore('scenes', {
  state: (): ScenesState => ({
    metadata: [],
    initialized: false,
    initializing: false,
    error: null,
    workspaceId: LOCAL_WORKSPACE_DESCRIPTOR.id,
    workspaceType: LOCAL_WORKSPACE_DESCRIPTOR.type,
    workspaceLabel: LOCAL_WORKSPACE_DESCRIPTOR.label,
    workspaceUserId: LOCAL_WORKSPACE_DESCRIPTOR.userId,
    workspaceUsername: LOCAL_WORKSPACE_DESCRIPTOR.username,
    workspaceRevision: 0,
  }),
  getters: {
    sortedMetadata(state): SceneSummary[] {
      return [...state.metadata].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    },
    metadataMap(state): Map<string, SceneSummary> {
      return new Map(state.metadata.map((entry) => [entry.id, entry]))
    },
  },
  actions: {
    async initialize() {
      if (this.initialized && !this.initializing) {
        this.attachAuthWatcher()
        return
      }
      if (initializationPromise) {
        await initializationPromise
        return
      }
      initializationPromise = this.bootstrapWorkspace()
      try {
        await initializationPromise
      } finally {
        initializationPromise = null
      }
    },
    async bootstrapWorkspace() {
      const authStore = useAuthStore()
      try {
        await authStore.initialize()
      } catch (error) {
        console.warn('[ScenesStore] Failed to initialize auth store', error)
      }
      const descriptor = resolveWorkspaceDescriptor(authStore.user)
      await this.switchWorkspace(descriptor, { forceReload: true, syncFromServer: false })
      this.attachAuthWatcher(authStore)
      this.initialized = true
      this.error = null
    },
    attachAuthWatcher(authStore?: ReturnType<typeof useAuthStore>) {
      if (authWatcherStop) {
        return
      }
      const store = authStore ?? useAuthStore()
      authWatcherStop = watch(
        () => store.user,
        (next, prev) => {
          const nextDescriptor = resolveWorkspaceDescriptor(next)
          const prevDescriptor = resolveWorkspaceDescriptor(prev)
          void this.handleAuthStateChange(nextDescriptor, prevDescriptor)
        },
      )
    },
    async handleAuthStateChange(nextDescriptor: SceneWorkspaceDescriptor, prevDescriptor: SceneWorkspaceDescriptor) {
      const workspaceChanged = nextDescriptor.id !== prevDescriptor.id || nextDescriptor.type !== prevDescriptor.type
      this.workspaceLabel = nextDescriptor.label
      this.workspaceUserId = nextDescriptor.userId
      this.workspaceUsername = nextDescriptor.username
      if (!workspaceChanged) {
        return
      }
      try {
        await this.switchWorkspace(nextDescriptor, {
          forceReload: true,
          syncFromServer: false,
        })
      } catch (error) {
        console.error('[ScenesStore] handleAuthStateChange failed', error)
      }
      if (prevDescriptor.type === 'user' && prevDescriptor.id !== nextDescriptor.id) {
        try {
          await deleteWorkspaceStorage(prevDescriptor.id)
        } catch (error) {
          console.warn('[ScenesStore] Failed to purge previous workspace cache', error)
        }
      }
    },
    async switchWorkspace(
      descriptor: SceneWorkspaceDescriptor,
      options: { forceReload?: boolean; syncFromServer?: boolean } = {},
    ) {
      const shouldReload =
        options.forceReload ||
        descriptor.id !== this.workspaceId ||
        descriptor.type !== this.workspaceType ||
        !this.initialized
      this.workspaceLabel = descriptor.label
      this.workspaceUserId = descriptor.userId
      this.workspaceUsername = descriptor.username
      if (!shouldReload) {
        return
      }
      this.initializing = true
      try {
        const records = await readAllMetadata(descriptor.id)
        this.metadata = records
        this.workspaceId = descriptor.id
        this.workspaceType = descriptor.type
        this.workspaceRevision += 1
        this.error = null
        if (options.syncFromServer && descriptor.type === 'user') {
          await this.syncUserWorkspaceFromServer({ replace: true })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load scenes workspace'
        this.error = message
        console.error('[ScenesStore] switchWorkspace failed', error)
        throw error
      } finally {
        this.initializing = false
      }
    },
    async refreshMetadata() {
      try {
        this.replaceMetadata(await readAllMetadata(this.workspaceId))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh scenes metadata'
        this.error = message
        console.error('[ScenesStore] refreshMetadata failed', error)
      }
    },
    async refreshUserWorkspaceMetadataFromServer() {
      if (this.workspaceType !== 'user') {
        await this.refreshMetadata()
        return
      }

      const authStore = useAuthStore()
      try {
        const remoteScenes = await fetchUserScenesFromServer(authStore)
        if (!remoteScenes) {
          return
        }
        this.replaceMetadata(remoteScenes.map((entry) => ({
          id: entry.id,
          name: entry.name,
          projectId: entry.projectId,
          thumbnail: entry.thumbnail,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          bundleEtag: entry.bundle.etag ?? null,
        })))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh scenes from server'
        this.error = message
        console.error('[ScenesStore] refreshUserWorkspaceMetadataFromServer failed', error)
      }
    },
    upsertMetadata(entry: SceneSummary) {
      const next = [...this.metadata]
      const existingIndex = next.findIndex((item) => item.id === entry.id)
      if (existingIndex === -1) {
        next.push(entry)
      } else {
        next.splice(existingIndex, 1, entry)
      }
      this.replaceMetadata(next)
    },
    removeMetadata(id: string) {
      this.replaceMetadata(this.metadata.filter((item) => item.id !== id))
    },
    async loadSceneDocument(
      id: string,
      options: { hydrateGroundRuntime?: boolean } = {},
    ): Promise<StoredSceneDocument | null> {
      try {
        return await readSceneDocument(this.workspaceId, id, options)
      } catch (error) {
        console.error('[ScenesStore] loadSceneDocument failed', error)
        return null
      }
    },
    replaceMetadata(metadata: SceneSummary[]) {
      this.metadata = metadata
      this.workspaceRevision += 1
      this.error = null
    },
    async saveSceneDocument(document: StoredSceneDocument) {
      await this.saveSceneDocuments([document])
    },
    async saveSceneDocuments(
      documents: StoredSceneDocument[],
      options: {
        groundHeightSidecars?: Record<string, ArrayBuffer | null>
        groundSplatSidecars?: Record<string, ArrayBuffer | null>
        groundScatterSidecars?: Record<string, ArrayBuffer | null>
        terrainDatasetManifests?: Record<string, QuantizedTerrainDatasetRootManifest | null>
        terrainDatasetRegionPacks?: Record<string, Record<string, ArrayBuffer | null>>
      } = {},
    ) {
      if (!documents.length) return
      await writeSceneDocuments(
        this.workspaceId,
        documents,
        options.groundHeightSidecars ?? {},
        options.groundSplatSidecars ?? {},
        options.groundScatterSidecars ?? {},
        options.terrainDatasetManifests ?? {},
        options.terrainDatasetRegionPacks ?? {},
      )
      const nextMetadata = [...this.metadata]
      for (const doc of documents) {
        const nextEntry = toMetadata(doc)
        const existingIndex = nextMetadata.findIndex((item) => item.id === nextEntry.id)
        if (existingIndex === -1) {
          nextMetadata.push(nextEntry)
        } else {
          nextMetadata.splice(existingIndex, 1, nextEntry)
        }
      }
      this.replaceMetadata(nextMetadata)
      if (this.workspaceType === 'user') {
        for (const doc of documents) {
          await this.syncSceneToServer(doc)
        }
      }
      if (!this.initialized) {
        this.initialized = true
      }
    },
    async deleteScene(id: string) {
      await removeSceneDocument(this.workspaceId, id)
      this.removeMetadata(id)
      if (this.workspaceType === 'user') {
        await this.deleteSceneOnServer(id)
      }
      if (!this.initialized && this.metadata.length === 0) {
        this.initialized = true
      }
    },
    async deleteScenesLocalOnly(ids: string[]) {
      const uniqueIds = Array.from(
        new Set((ids ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
      )
      for (const id of uniqueIds) {
        await removeSceneDocument(this.workspaceId, id)
        this.removeMetadata(id)
      }
      if (!this.initialized && this.metadata.length === 0) {
        this.initialized = true
      }
    },
    async saveGroundHeightSidecar(document: StoredSceneDocument) {
      const groundHeightmapStore = useGroundHeightmapStore()
      const source = cloneForIndexedDb(document)
      const sidecar = groundHeightmapStore.buildSceneDocumentSidecar(findGroundNodeInDocument(source))
      await writeSceneGroundHeightSidecar(this.workspaceId, source.id, sidecar)
      await this.syncSceneDocumentToServer(source.id)
    },
    async loadGroundHeightSidecar(sceneId: string): Promise<ArrayBuffer | null> {
      return await readSceneGroundHeightSidecar(this.workspaceId, sceneId)
    },
    async loadGroundSplatSidecar(sceneId: string): Promise<ArrayBuffer | null> {
      return await readSceneGroundSplatSidecar(this.workspaceId, sceneId)
    },
    async loadGroundScatterSidecar(sceneId: string): Promise<ArrayBuffer | null> {
      return await readSceneGroundScatterSidecar(this.workspaceId, sceneId)
    },
    async loadGroundChunkManifest(_sceneId: string): Promise<null> {
      return null
    },
    async saveGroundChunkManifest(
      _sceneId: string,
      _manifest: unknown,
      _options: { syncServer?: boolean } = {},
    ): Promise<void> {
      return
    },
    async loadGroundChunkData(_sceneId: string, _chunkKey: string): Promise<null> {
      return null
    },
    async saveGroundChunkData(
      _sceneId: string,
      _chunkKey: string,
      _data: ArrayBuffer | null,
      _options: { syncServer?: boolean } = {},
    ): Promise<void> {
      return
    },
    async loadTerrainDatasetManifest(sceneId: string): Promise<QuantizedTerrainDatasetRootManifest | null> {
      return await readSceneTerrainDatasetManifest(this.workspaceId, sceneId)
    },
    async saveTerrainDatasetManifest(
      sceneId: string,
      manifest: QuantizedTerrainDatasetRootManifest | null,
      options: { syncServer?: boolean } = {},
    ): Promise<void> {
      await writeSceneTerrainDatasetManifest(this.workspaceId, sceneId, manifest)
      if (options.syncServer !== false) {
        await this.syncSceneDocumentToServer(sceneId)
      }
    },
    async loadTerrainDatasetRegionPack(sceneId: string, regionKey: string): Promise<ArrayBuffer | null> {
      return await readSceneTerrainDatasetRegionPack(this.workspaceId, sceneId, regionKey)
    },
    async loadCompiledGroundBundle(sceneId: string): Promise<{
      buildKey: string
      sourceSignature: string
      manifest: CompiledGroundManifest
      files: Record<string, ArrayBuffer>
    } | null> {
      const bundle = await readSceneCompiledGroundBundle(this.workspaceId, sceneId)
      if (!bundle) {
        return null
      }
      return {
        buildKey: bundle.buildKey,
        sourceSignature: bundle.sourceSignature,
        manifest: bundle.manifest,
        files: Object.fromEntries(bundle.files.map((entry) => [entry.path, entry.buffer])),
      }
    },
    async saveCompiledGroundBundle(
      sceneId: string,
      bundle: {
        buildKey: string
        sourceSignature: string
        manifest: CompiledGroundManifest
        files: Record<string, ArrayBuffer>
      } | null,
    ): Promise<void> {
      if (!bundle) {
        await writeSceneCompiledGroundBundle(this.workspaceId, sceneId, null)
        return
      }
      await writeSceneCompiledGroundBundle(this.workspaceId, sceneId, {
        buildKey: bundle.buildKey,
        sourceSignature: bundle.sourceSignature,
        manifest: bundle.manifest,
        files: Object.entries(bundle.files).map(([path, buffer]) => ({
          path,
          buffer,
        })),
      })
    },
    async saveTerrainDatasetRegionPack(
      sceneId: string,
      regionKey: string,
      data: ArrayBuffer | null,
      options: { syncServer?: boolean } = {},
    ): Promise<void> {
      await writeSceneTerrainDatasetRegionPack(this.workspaceId, sceneId, regionKey, data)
      if (options.syncServer !== false) {
        await this.syncSceneDocumentToServer(sceneId)
      }
    },
    async replaceTerrainDatasetBundle(
      sceneId: string,
      manifest: QuantizedTerrainDatasetRootManifest | null,
      regionPacks: Record<string, ArrayBuffer | null> = {},
      options: { syncServer?: boolean } = {},
    ): Promise<void> {
      const existingManifest = await readSceneTerrainDatasetManifest(this.workspaceId, sceneId)
      const existingRegionKeys = new Set(
        Array.isArray(existingManifest?.regions)
          ? existingManifest.regions
              .map((region) => (typeof region?.regionKey === 'string' ? region.regionKey.trim() : ''))
              .filter((regionKey) => regionKey.length > 0)
          : [],
      )
      const nextRegionKeys = new Set(
        Object.keys(regionPacks)
          .map((regionKey) => regionKey.trim())
          .filter((regionKey) => regionKey.length > 0),
      )

      await writeSceneTerrainDatasetManifest(this.workspaceId, sceneId, manifest)
      const writeRegionPackBatch = async (entries: Array<[string, ArrayBuffer | null]>) => {
        const batchSize = 8
        for (let index = 0; index < entries.length; index += batchSize) {
          await Promise.all(entries.slice(index, index + batchSize).map(([regionKey, buffer]) => (
            writeSceneTerrainDatasetRegionPack(this.workspaceId, sceneId, regionKey, buffer)
          )))
        }
      }
      await writeRegionPackBatch(Array.from(existingRegionKeys)
        .filter((regionKey) => !nextRegionKeys.has(regionKey))
        .map((regionKey) => [regionKey, null]))
      await writeRegionPackBatch(Object.entries(regionPacks).map(([regionKey, buffer]) => [regionKey, buffer ?? null]))

      if (options.syncServer !== false) {
        await this.syncSceneDocumentToServer(sceneId)
      }
    },
    async saveSceneGroundHeightSidecar(
      sceneId: string,
      sidecar: ArrayBuffer | null,
      options: { syncServer?: boolean } = {},
    ): Promise<void> {
      await writeSceneGroundHeightSidecar(this.workspaceId, sceneId, sidecar)
      if (options.syncServer !== false) {
        await this.syncSceneDocumentToServer(sceneId)
      }
    },
    async saveSceneGroundSplatSidecar(
      sceneId: string,
      sidecar: ArrayBuffer | null,
      options: { syncServer?: boolean } = {},
    ): Promise<void> {
      await writeSceneGroundSplatSidecar(this.workspaceId, sceneId, sidecar)
      if (options.syncServer !== false) {
        await this.syncSceneDocumentToServer(sceneId)
      }
    },
    async saveSceneGroundScatterSidecar(
      sceneId: string,
      sidecar: ArrayBuffer | null,
      options: { syncServer?: boolean } = {},
    ): Promise<void> {
      await writeSceneGroundScatterSidecar(this.workspaceId, sceneId, sidecar)
      if (options.syncServer !== false) {
        await this.syncSceneDocumentToServer(sceneId)
      }
    },
    async syncSceneDocumentToServer(sceneId: string) {
      if (this.workspaceType !== 'user') {
        return
      }
      const sceneStore = useSceneStore()
      const document = sceneStore.currentSceneId === sceneId
        ? sceneStore.createSceneDocumentSnapshot()
        : await this.loadSceneDocument(sceneId, { hydrateGroundRuntime: false })
      if (document) {
        await this.syncSceneToServer(document)
      }
    },
    async syncUserWorkspaceFromServer(options: { replace?: boolean } = {}) {
      if (this.workspaceType !== 'user') {
        return
      }
      const authStore = useAuthStore()
      try {
        const remoteScenes = await fetchUserScenesFromServer(authStore)
        if (!remoteScenes) {
          return
        }
        const localMetadataById = new Map(this.metadata.map((entry) => [entry.id, entry]))
        const syncResults = await mapWithConcurrency(remoteScenes, SCENE_BUNDLE_SYNC_CONCURRENCY, async (entry) => {
          const localEtag = localMetadataById.get(entry.id)?.bundleEtag ?? null
          const bundle = await downloadSceneBundleZip(entry.bundle.url, authStore, { etag: localEtag })
          if (bundle) {
            return {
              sceneId: entry.id,
              downloaded: await unpackSceneBundleIntoStores(bundle.bytes, { allowLandformNodes: true }),
              bundleEtag: bundle.etag ?? entry.bundle.etag ?? null,
            }
          }
          return {
            sceneId: entry.id,
            downloaded: null,
            bundleEtag: localEtag ?? entry.bundle.etag ?? null,
          }
        })

        const downloaded: Array<{
          document: StoredSceneDocument
          groundHeightSidecar: ArrayBuffer | null
          groundSplatSidecar: ArrayBuffer | null
          groundScatterSidecar: ArrayBuffer | null
        }> = []
        const syncedBundleEtags: Record<string, string | null> = {}
        for (const result of syncResults) {
          syncedBundleEtags[result.sceneId] = result.bundleEtag
          if (result.downloaded) {
            downloaded.push(result.downloaded)
            continue
          }
          if (!options.replace) {
            continue
          }
          const localBundle = await readSceneBundleFromWorkspace(this.workspaceId, result.sceneId)
          if (localBundle) {
            downloaded.push(localBundle)
            continue
          }
          const remoteEntry = remoteScenes.find((entry) => entry.id === result.sceneId)
          if (!remoteEntry) {
            continue
          }
          const fallbackBundle = await downloadSceneBundleZip(remoteEntry.bundle.url, authStore)
          if (!fallbackBundle) {
            continue
          }
          downloaded.push(await unpackSceneBundleIntoStores(fallbackBundle.bytes, { allowLandformNodes: true }))
          syncedBundleEtags[result.sceneId] = fallbackBundle.etag ?? remoteEntry.bundle.etag ?? null
        }

        if (options.replace) {
          await replaceWorkspaceDocuments(
            this.workspaceId,
            downloaded.map((entry) => entry.document),
            Object.fromEntries(downloaded.map((entry) => [entry.document.id, entry.groundHeightSidecar ?? null])),
            Object.fromEntries(downloaded.map((entry) => [entry.document.id, entry.groundSplatSidecar ?? null])),
            Object.fromEntries(downloaded.map((entry) => [entry.document.id, entry.groundScatterSidecar ?? null])),
          )
        } else {
          await writeSceneDocuments(
            this.workspaceId,
            downloaded.map((entry) => entry.document),
            Object.fromEntries(downloaded.map((entry) => [entry.document.id, entry.groundHeightSidecar ?? null])),
            Object.fromEntries(downloaded.map((entry) => [entry.document.id, entry.groundSplatSidecar ?? null])),
            Object.fromEntries(downloaded.map((entry) => [entry.document.id, entry.groundScatterSidecar ?? null])),
          )
        }
        await writeSceneBundleEtags(this.workspaceId, syncedBundleEtags)
        if (options.replace) {
          this.metadata = downloaded.map((entry) => toMetadataWithBundleEtag(entry.document, syncedBundleEtags[entry.document.id] ?? null))
        } else {
          await this.refreshMetadata()
        }
        this.workspaceRevision += 1
      } catch (error) {
        console.warn('[ScenesStore] syncUserWorkspaceFromServer failed', error)
      }
    },
    async syncSceneToServer(document: StoredSceneDocument) {
      if (this.workspaceType !== 'user') {
        return
      }
      const authStore = useAuthStore()
      try {
        await uploadSceneToServer(document, authStore)
      } catch (error) {
        console.warn('[ScenesStore] syncSceneToServer failed', error)
      }
    },
    async deleteSceneOnServer(sceneId: string) {
      if (this.workspaceType !== 'user') {
        return
      }
      const authStore = useAuthStore()
      try {
        await removeSceneFromServer(sceneId, authStore)
      } catch (error) {
        console.warn('[ScenesStore] deleteSceneOnServer failed', error)
      }
    },
  },
})
