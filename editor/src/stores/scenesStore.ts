import { defineStore } from 'pinia'
import type { SceneSummary } from '@/types/scene-summary'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import { toRaw } from 'vue'

interface ScenesState {
  metadata: SceneSummary[]
  initialized: boolean
  initializing: boolean
  error: string | null
}

const DB_NAME = 'harmony-editor-scenes'
const DB_VERSION = 1
const STORE_METADATA = 'sceneMetadata'
const STORE_DOCUMENTS = 'sceneDocuments'

const memoryDocuments = new Map<string, StoredSceneDocument>()

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

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'))
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
          db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to open scenes database'))
    })
  }
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function readAllMetadata(): Promise<SceneSummary[]> {
  if (!isIndexedDbAvailable()) {
    const records: SceneSummary[] = []
    memoryDocuments.forEach((doc) => {
      records.push({
        id: doc.id,
        name: doc.name,
        thumbnail: doc.thumbnail ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      })
    })
    return records
  }
  const db = await openDatabase()
  const tx = db.transaction(STORE_METADATA, 'readonly')
  const store = tx.objectStore(STORE_METADATA)
  const records = await requestToPromise<SceneSummary[]>(store.getAll())
  return records
}

async function readSceneDocument(id: string): Promise<StoredSceneDocument | null> {
  if (!isIndexedDbAvailable()) {
    return memoryDocuments.get(id) ?? null
  }
  const db = await openDatabase()
  const tx = db.transaction(STORE_DOCUMENTS, 'readonly')
  const store = tx.objectStore(STORE_DOCUMENTS)
  const result = await requestToPromise<StoredSceneDocument | undefined>(store.get(id))
  return result ?? null
}

function toMetadata(document: StoredSceneDocument): SceneSummary {
  return {
    id: document.id,
    name: document.name,
    thumbnail: document.thumbnail ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

async function writeSceneDocument(document: StoredSceneDocument): Promise<void> {
  const prepared = cloneForIndexedDb(document)
  if (!isIndexedDbAvailable()) {
    memoryDocuments.set(prepared.id, prepared)
    return
  }
  const db = await openDatabase()
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

async function writeSceneDocuments(documents: StoredSceneDocument[]): Promise<void> {
  const preparedDocs = documents.map((doc) => cloneForIndexedDb(doc))
  if (!isIndexedDbAvailable()) {
    preparedDocs.forEach((doc) => memoryDocuments.set(doc.id, doc))
    return
  }
  const db = await openDatabase()
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

async function removeSceneDocument(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    memoryDocuments.delete(id)
    return
  }
  const db = await openDatabase()
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
      if (this.initialized || this.initializing) {
        return
      }
      this.initializing = true
      try {
        const records = await readAllMetadata()
        this.metadata = records
        this.initialized = true
        this.error = null
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to initialize scenes store'
        this.error = message
        console.error('[ScenesStore] initialize failed', error)
      } finally {
        this.initializing = false
      }
    },
    async refreshMetadata() {
      try {
        const records = await readAllMetadata()
        this.metadata = records
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
    },
    removeMetadata(id: string) {
      const next = this.metadata.filter((item) => item.id !== id)
      this.metadata = next
    },
    async loadSceneDocument(id: string): Promise<StoredSceneDocument | null> {
      try {
        return await readSceneDocument(id)
      } catch (error) {
        console.error('[ScenesStore] loadSceneDocument failed', error)
        return null
      }
    },
    async saveSceneDocument(document: StoredSceneDocument) {
      await writeSceneDocument(document)
      this.upsertMetadata(toMetadata(document))
      if (!this.initialized) {
        this.initialized = true
      }
    },
    async saveSceneDocuments(documents: StoredSceneDocument[]) {
      if (!documents.length) return
      await writeSceneDocuments(documents)
      documents.forEach((doc) => this.upsertMetadata(toMetadata(doc)))
      if (!this.initialized) {
        this.initialized = true
      }
    },
    async deleteScene(id: string) {
      await removeSceneDocument(id)
      this.removeMetadata(id)
      if (!this.initialized && this.metadata.length === 0) {
        this.initialized = true
      }
    },
  },
})
