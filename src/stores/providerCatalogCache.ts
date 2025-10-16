import type { ProjectDirectory } from '@/types/project-directory'
import { cloneProjectTree } from '@/stores/assetCatalog'

const DB_NAME = 'harmony-provider-catalogs'
const DB_VERSION = 1
const STORE_NAME = 'catalogs'

interface CatalogRecord {
  providerId: string
  directories: ProjectDirectory[]
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function isClient(): boolean {
  return typeof window !== 'undefined'
}

function isIndexedDbAvailable(): boolean {
  return isClient() && typeof window.indexedDB !== 'undefined'
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) {
    return null
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION)
        request.onerror = () => {
          console.warn('[catalog-cache] Failed to open IndexedDB', request.error)
          resolve(null)
        }
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'providerId' })
            store.createIndex('updatedAt', 'updatedAt', { unique: false })
          }
        }
        request.onsuccess = () => {
          const db = request.result
          db.onversionchange = () => {
            db.close()
            dbPromise = null
          }
          resolve(db)
        }
      } catch (error) {
        console.warn('[catalog-cache] Unexpected error while opening IndexedDB', error)
        resolve(null)
      }
    })
  }
  return dbPromise
}

async function runOperation<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDatabase()
  if (!db) {
    return null
  }
  return new Promise<T | null>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, mode)
      const store = transaction.objectStore(STORE_NAME)
      const request = handler(store)
      request.onerror = () => {
        console.warn('[catalog-cache] IndexedDB request failed', request.error)
        resolve(null)
      }
      transaction.oncomplete = () => {
        resolve(request.result ?? null)
      }
      transaction.onerror = () => {
        console.warn('[catalog-cache] IndexedDB transaction failed', transaction.error)
        resolve(null)
      }
      transaction.onabort = () => {
        console.warn('[catalog-cache] IndexedDB transaction aborted', transaction.error)
        resolve(null)
      }
    } catch (error) {
      console.warn('[catalog-cache] IndexedDB operation threw', error)
      resolve(null)
    }
  })
}

function serializeDirectories(directories: ProjectDirectory[]): ProjectDirectory[] {
  // clone to strip reactive proxies and avoid structured cloning issues
  return cloneProjectTree(directories)
}

function deserializeDirectories(payload: ProjectDirectory[] | undefined | null): ProjectDirectory[] | null {
  if (!payload) {
    return null
  }
  return cloneProjectTree(payload)
}

export async function loadProviderCatalog(providerId: string): Promise<ProjectDirectory[] | null> {
  const record = await runOperation<CatalogRecord | undefined>('readonly', (store) => store.get(providerId))
  if (!record) {
    return null
  }
  return deserializeDirectories(record.directories)
}

export async function storeProviderCatalog(providerId: string, directories: ProjectDirectory[]): Promise<void> {
  const normalized: CatalogRecord = {
    providerId,
    directories: serializeDirectories(directories),
    updatedAt: Date.now(),
  }
  await runOperation<IDBValidKey>('readwrite', (store) => store.put(normalized))
}

export async function deleteProviderCatalog(providerId: string): Promise<void> {
  await runOperation<undefined>('readwrite', (store) => store.delete(providerId))
}

export function clearCatalogCache(): Promise<void> {
  return runOperation<undefined>('readwrite', (store) => store.clear()).then(() => undefined)
}

export function isCatalogCacheSupported(): boolean {
  return isIndexedDbAvailable()
}
