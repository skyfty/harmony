import { defineStore } from 'pinia'
import type { SceneSummary } from '@/types/scene-summary'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import { toRaw, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import type { SessionUser } from '@/types/auth'
import { useAuthStore } from '@/stores/authStore'
import { buildServerApiUrl } from '@/api/serverApiConfig'

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
const DB_VERSION = 1
const STORE_METADATA = 'sceneMetadata'
const STORE_DOCUMENTS = 'sceneDocuments'

const memoryWorkspaceDocuments = new Map<string, Map<string, StoredSceneDocument>>()
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

function getWorkspaceDbName(workspaceId: string): string {
  return `${DB_NAME}::${workspaceId}`
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
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE_METADATA)) {
            db.createObjectStore(STORE_METADATA, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
            db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' })
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
}

async function replaceWorkspaceDocuments(workspaceId: string, documents: StoredSceneDocument[]): Promise<void> {
  await deleteWorkspaceStorage(workspaceId)
  if (!documents.length) {
    return
  }
  await writeSceneDocuments(workspaceId, documents)
}

async function fetchUserScenesFromServer(authStore: ReturnType<typeof useAuthStore>): Promise<StoredSceneDocument[] | null> {
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
  const payload = await response.json().catch(() => null)
  const entries: unknown =
    payload && typeof payload === 'object' && Array.isArray((payload as { scenes?: unknown[] }).scenes)
      ? (payload as { scenes?: unknown[] }).scenes
      : payload
  if (!Array.isArray(entries)) {
    return []
  }
  return (entries as StoredSceneDocument[]).filter((doc): doc is StoredSceneDocument => !!doc && typeof doc.id === 'string')
}

async function uploadSceneToServer(document: StoredSceneDocument, authStore: ReturnType<typeof useAuthStore>): Promise<void> {
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    return
  }
  const payload = cloneForIndexedDb(document)
  const url = buildServerApiUrl(`${USER_SCENE_API_PREFIX}/${encodeURIComponent(document.id)}`)
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })
  headers.set('Authorization', authorization)
  const response = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Failed to save scene (${response.status})`)
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

async function readSceneDocument(workspaceId: string, id: string): Promise<StoredSceneDocument | null> {
  if (!isIndexedDbAvailable()) {
    return getMemoryWorkspace(workspaceId).get(id) ?? null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_DOCUMENTS, 'readonly')
  const store = tx.objectStore(STORE_DOCUMENTS)
  const result = await requestToPromise<StoredSceneDocument | undefined>(store.get(id))
  return result ?? null
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
  const prepared = cloneForIndexedDb(document)
  if (!isIndexedDbAvailable()) {
    getMemoryWorkspace(workspaceId).set(prepared.id, prepared)
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  docs.put(prepared)
  meta.put(toMetadata(prepared))
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write scene document'))
    tx.onabort = () => reject(tx.error ?? new Error('Scene write aborted'))
  })
}

async function writeSceneDocuments(workspaceId: string, documents: StoredSceneDocument[]): Promise<void> {
  const preparedDocs = documents.map((doc) => cloneForIndexedDb(doc))
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryWorkspace(workspaceId)
    preparedDocs.forEach((doc) => bucket.set(doc.id, doc))
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  preparedDocs.forEach((document) => {
    docs.put(document)
    meta.put(toMetadata(document))
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
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  docs.delete(id)
  meta.delete(id)
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
    async loadSceneDocument(id: string): Promise<StoredSceneDocument | null> {
      try {
        return await readSceneDocument(this.workspaceId, id)
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
    async saveSceneDocuments(documents: StoredSceneDocument[]) {
      if (!documents.length) return
      await writeSceneDocuments(this.workspaceId, documents)
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
        if (options.replace) {
          await replaceWorkspaceDocuments(this.workspaceId, remoteScenes)
          this.metadata = remoteScenes.map((doc) => toMetadata(doc))
        } else {
          await writeSceneDocuments(this.workspaceId, remoteScenes)
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
