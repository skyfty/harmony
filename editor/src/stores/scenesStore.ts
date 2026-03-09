import { defineStore } from 'pinia'
import type { SceneNode } from '@schema'
import type { SceneSummary } from '@/types/scene-summary'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import { toRaw, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import type { SessionUser } from '@/types/auth'
import { useAuthStore } from '@/stores/authStore'
import { buildServerApiUrl } from '@/api/serverApiConfig'
import { exportScenePackageZip } from '@/utils/scenePackageExport'
import {
  stripGroundHeightMapsFromSceneDocument,
} from '@/utils/groundHeightSidecar'
import { loadStoredScenesFromScenePackage } from '@/utils/scenePackageImport'
import { useGroundHeightmapStore } from './groundHeightmapStore'
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

const DB_NAME = 'harmony-editor-scenes'
const DB_VERSION = 5
const STORE_METADATA = 'sceneMetadata'
const STORE_DOCUMENTS = 'sceneDocuments'
const STORE_GROUND_HEIGHTMAPS = 'sceneGroundHeightmaps'

const memoryWorkspaceDocuments = new Map<string, Map<string, StoredSceneDocument>>()
const memoryWorkspaceGroundHeightSidecars = new Map<string, Map<string, ArrayBuffer>>()
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

function getWorkspaceDbName(workspaceId: string): string {
  return `${DB_NAME}::${workspaceId}`
}

function prepareSceneDocumentForPersistence(document: StoredSceneDocument): StoredSceneDocument {
  return stripGroundHeightMapsFromSceneDocument(cloneForIndexedDb(document))
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
          if (request.transaction && oldVersion < 3) {
            request.transaction.objectStore(STORE_METADATA).clear()
            request.transaction.objectStore(STORE_DOCUMENTS).clear()
            request.transaction.objectStore(STORE_GROUND_HEIGHTMAPS).clear()
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
  return entry?.buffer ? cloneArrayBuffer(entry.buffer) : null
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

async function replaceWorkspaceDocuments(
  workspaceId: string,
  documents: StoredSceneDocument[],
  groundHeightSidecars: Record<string, ArrayBuffer | null> = {},
): Promise<void> {
  await deleteWorkspaceStorage(workspaceId)
  if (!documents.length) {
    return
  }
  await writeSceneDocuments(workspaceId, documents, groundHeightSidecars)
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

async function unpackSceneBundleIntoStores(zipBytes: ArrayBuffer): Promise<{ document: StoredSceneDocument; groundHeightSidecar: ArrayBuffer | null }> {
  const pkg = await loadStoredScenesFromScenePackage(zipBytes)
  const scene = pkg.scenes[0]
  if (!scene) {
    throw new Error('Scene bundle missing scene entry')
  }
  return {
    document: scene,
    groundHeightSidecar: pkg.groundHeightSidecars[scene.id] ?? null,
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
    scenes: [{ id: document.id, document: cloneForIndexedDb(document) }]
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
    throw new Error(`Failed to upload scene bundle (${response.status})`)
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
  if (!isIndexedDbAvailable()) {
    const document = getMemoryWorkspace(workspaceId).get(id)
    if (!document) {
      return null
    }
    const hydrated = cloneForIndexedDb(document)
    if (options.hydrateGroundRuntime) {
      const sidecar = await readSceneGroundHeightSidecar(workspaceId, hydrated.id)
      await groundHeightmapStore.hydrateSceneDocument(findGroundNodeInDocument(hydrated), sidecar)
    }
    return stripGroundHeightMapsFromSceneDocument(hydrated)
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_DOCUMENTS, 'readonly')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const result = await requestToPromise<StoredSceneDocument | undefined>(docs.get(id))
  if (!result) {
    return null
  }
  if (options.hydrateGroundRuntime) {
    const sidecar = await readSceneGroundHeightSidecar(workspaceId, result.id)
    await groundHeightmapStore.hydrateSceneDocument(findGroundNodeInDocument(result), sidecar)
  }
  return stripGroundHeightMapsFromSceneDocument(result)
}

async function resolveSceneGroundHeightSidecarForWrite(workspaceId: string, document: StoredSceneDocument): Promise<ArrayBuffer | null> {
  const sceneStore = useSceneStore()
  if (sceneStore.currentSceneId === document.id) {
    return useGroundHeightmapStore().buildSceneDocumentSidecar(findGroundNodeInDocument(document))
  }
  return await readSceneGroundHeightSidecar(workspaceId, document.id)
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

async function writeSceneDocument(workspaceId: string, document: StoredSceneDocument): Promise<void> {
  const prepared = prepareSceneDocumentForPersistence(document)
  const sidecar = await resolveSceneGroundHeightSidecarForWrite(workspaceId, document)
  if (!isIndexedDbAvailable()) {
    getMemoryWorkspace(workspaceId).set(prepared.id, prepared)
    await writeSceneGroundHeightSidecar(workspaceId, prepared.id, sidecar)
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA, STORE_GROUND_HEIGHTMAPS], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  const heightmaps = tx.objectStore(STORE_GROUND_HEIGHTMAPS)
  docs.put(prepared)
  meta.put(toMetadata(prepared))
  if (sidecar) {
    heightmaps.put({ id: prepared.id, buffer: cloneArrayBuffer(sidecar) })
  } else {
    heightmaps.delete(prepared.id)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene document'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene write aborted'))
  })
}

async function writeSceneDocuments(
  workspaceId: string,
  documents: StoredSceneDocument[],
  groundHeightSidecars: Record<string, ArrayBuffer | null> = {},
): Promise<void> {
  const preparedDocs = documents.map((doc) => ({ document: prepareSceneDocumentForPersistence(doc), source: doc }))
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryWorkspace(workspaceId)
    const sidecarBucket = getMemoryGroundHeightSidecars(workspaceId)
    preparedDocs.forEach(({ document: prepared }) => {
      bucket.set(prepared.id, prepared)
      const sidecar = groundHeightSidecars[prepared.id] ?? null
      if (sidecar) {
        sidecarBucket.set(prepared.id, cloneArrayBuffer(sidecar))
      } else {
        sidecarBucket.delete(prepared.id)
      }
    })
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA, STORE_GROUND_HEIGHTMAPS], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  const heightmaps = tx.objectStore(STORE_GROUND_HEIGHTMAPS)
  preparedDocs.forEach(({ document: prepared }) => {
    docs.put(prepared)
    meta.put(toMetadata(prepared))
    const sidecar = groundHeightSidecars[prepared.id] ?? null
    if (sidecar) {
      heightmaps.put({ id: prepared.id, buffer: cloneArrayBuffer(sidecar) })
    } else {
      heightmaps.delete(prepared.id)
    }
  })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene documents'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene batch write aborted'))
  })
}

async function removeSceneDocument(workspaceId: string, id: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    getMemoryWorkspace(workspaceId).delete(id)
    getMemoryGroundHeightSidecars(workspaceId).delete(id)
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA, STORE_GROUND_HEIGHTMAPS], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  const heightmaps = tx.objectStore(STORE_GROUND_HEIGHTMAPS)
  docs.delete(id)
  meta.delete(id)
  heightmaps.delete(id)
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
      await this.switchWorkspace(descriptor, { forceReload: true, syncFromServer: descriptor.type === 'user' })
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
          syncFromServer: nextDescriptor.type === 'user',
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
        const records = await readAllMetadata(this.workspaceId)
        this.metadata = records
        this.workspaceRevision += 1
        this.error = null
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh scenes metadata'
        this.error = message
        console.error('[ScenesStore] refreshMetadata failed', error)
      }
    },
    upsertMetadata(entry: SceneSummary) {
      const existingIndex = this.metadata.findIndex((item) => item.id === entry.id)
      if (existingIndex === -1) {
        this.metadata = [...this.metadata, entry]
      } else {
        this.metadata = [
          ...this.metadata.slice(0, existingIndex),
          entry,
          ...this.metadata.slice(existingIndex + 1),
        ]
      }
      this.workspaceRevision += 1
    },
    removeMetadata(id: string) {
      const next = this.metadata.filter((item) => item.id !== id)
      this.metadata = next
      this.workspaceRevision += 1
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
    async saveSceneDocument(document: StoredSceneDocument) {
      await writeSceneDocument(this.workspaceId, document)
      this.upsertMetadata(toMetadata(document))
      if (this.workspaceType === 'user') {
        await this.syncSceneToServer(document)
      }
      if (!this.initialized) {
        this.initialized = true
      }
    },
    async saveSceneDocuments(
      documents: StoredSceneDocument[],
      options: { groundHeightSidecars?: Record<string, ArrayBuffer | null> } = {},
    ) {
      if (!documents.length) return
      await writeSceneDocuments(this.workspaceId, documents, options.groundHeightSidecars ?? {})
      documents.forEach((doc) => this.upsertMetadata(toMetadata(doc)))
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
      if (this.workspaceType === 'user') {
        await this.syncSceneToServer(document)
      }
    },
    async loadGroundHeightSidecar(sceneId: string): Promise<ArrayBuffer | null> {
      return await readSceneGroundHeightSidecar(this.workspaceId, sceneId)
    },
    async saveSceneGroundHeightSidecar(sceneId: string, sidecar: ArrayBuffer | null): Promise<void> {
      await writeSceneGroundHeightSidecar(this.workspaceId, sceneId, sidecar)
      if (this.workspaceType === 'user') {
        const document = await this.loadSceneDocument(sceneId, { hydrateGroundRuntime: false })
        if (document) {
          await this.syncSceneToServer(document)
        }
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
        const downloaded: Array<{ document: StoredSceneDocument; groundHeightSidecar: ArrayBuffer | null }> = []
        for (const entry of remoteScenes) {
          const bundle = await downloadSceneBundleZip(entry.bundle.url, authStore)
          if (!bundle) {
            continue
          }
          downloaded.push(await unpackSceneBundleIntoStores(bundle.bytes))
        }

        if (options.replace) {
          await replaceWorkspaceDocuments(
            this.workspaceId,
            downloaded.map((entry) => entry.document),
            Object.fromEntries(downloaded.map((entry) => [entry.document.id, entry.groundHeightSidecar ?? null])),
          )
        } else {
          await writeSceneDocuments(
            this.workspaceId,
            downloaded.map((entry) => entry.document),
            Object.fromEntries(downloaded.map((entry) => [entry.document.id, entry.groundHeightSidecar ?? null])),
          )
        }
        if (options.replace) {
          this.metadata = downloaded.map((entry) => toMetadata(entry.document))
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
