import type { PiniaPluginContext, StateTree } from 'pinia'
import { watch, type WatchStopHandle } from 'vue'

type MaybePromise<T> = T | Promise<T>

type StorageAdapter = {
  getItem(key: string): MaybePromise<string | null>
  setItem(key: string, value: string): MaybePromise<void>
  removeItem(key: string): MaybePromise<void>
}

const isClient = typeof window !== 'undefined'
const hasIndexedDb = isClient && typeof window.indexedDB !== 'undefined'

const memoryStorage: StorageAdapter = (() => {
  const storage = new Map<string, string>()
  return {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value)
    },
    removeItem: (key) => {
      storage.delete(key)
    },
  }
})()

const PINIA_IDB_NAME = 'harmony-scene-state'
const PINIA_IDB_STORE = 'scene'
const PINIA_IDB_VERSION = 1

let piniaDbPromise: Promise<IDBDatabase> | null = null

const activeHydrations = new Set<Promise<void>>()

export function waitForPiniaHydration(): Promise<void> {
  if (activeHydrations.size === 0) {
    return Promise.resolve()
  }
  const tasks = Array.from(activeHydrations)
  return Promise.allSettled(tasks).then(() => undefined)
}

function openPiniaDatabase(): Promise<IDBDatabase> {
  if (!hasIndexedDb) {
    return Promise.reject(new Error('IndexedDB is not available'))
  }
  if (!piniaDbPromise) {
    piniaDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(PINIA_IDB_NAME, PINIA_IDB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(PINIA_IDB_STORE)) {
          db.createObjectStore(PINIA_IDB_STORE)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to open Pinia IndexedDB'))
    })
  }
  return piniaDbPromise
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

const indexedDbStorage: StorageAdapter = {
  async getItem(key: string) {
    if (!hasIndexedDb) {
      return memoryStorage.getItem(key)
    }
    const db = await openPiniaDatabase()
    const tx = db.transaction(PINIA_IDB_STORE, 'readonly')
    const store = tx.objectStore(PINIA_IDB_STORE)
    const value = await idbRequestToPromise<unknown>(store.get(key))
    if (value == null) {
      return null
    }
    return typeof value === 'string' ? value : String(value)
  },
  async setItem(key: string, value: string) {
    if (!hasIndexedDb) {
      memoryStorage.setItem(key, value)
      return
    }
    const db = await openPiniaDatabase()
    const tx = db.transaction(PINIA_IDB_STORE, 'readwrite')
    const store = tx.objectStore(PINIA_IDB_STORE)
    store.put(value, key)
  },
  async removeItem(key: string) {
    if (!hasIndexedDb) {
      memoryStorage.removeItem(key)
      return
    }
    const db = await openPiniaDatabase()
    const tx = db.transaction(PINIA_IDB_STORE, 'readwrite')
    const store = tx.objectStore(PINIA_IDB_STORE)
    store.delete(key)
  },
}

type StorageResolver = 'local' | 'session' | 'memory' | 'indexeddb' | StorageAdapter

type MigrationMap<S extends StateTree> = Record<number, (state: Partial<S>) => Partial<S>>

export interface PersistSerializer<S extends StateTree = StateTree> {
  serialize(payload: PersistPayload<S>): string
  deserialize(value: string): PersistPayload<S> | null
}

export interface PersistPayload<S extends StateTree = StateTree> {
  version: number
  state: Partial<S>
}

export interface StorePersistOptions<S extends StateTree = StateTree> {
  key?: string
  storage?: StorageResolver
  version?: number
  migrations?: MigrationMap<S> | ((state: Partial<S>, fromVersion: number, toVersion: number) => Partial<S>)
  serializer?: PersistSerializer<S>
  pick?: (keyof S | string)[]
  observePaths?: (keyof S | string)[]
  debug?: boolean
  shouldPersist?: (state: Partial<S>, previousState: Partial<S> | null) => boolean
  flushDebounce?: number
  flushEvents?: string[]
}

export interface CreatePersistPluginOptions {
  defaultStorage?: StorageResolver
  keyPrefix?: string
  storages?: Record<string, StorageAdapter>
}

const defaultSerializer: PersistSerializer = {
  serialize: (payload) => JSON.stringify(payload),
  deserialize: (value) => {
    try {
      const parsed = JSON.parse(value) as PersistPayload
      if (typeof parsed !== 'object' || parsed === null) return null
      if (typeof parsed.version !== 'number' || parsed.state === undefined) return null
      return parsed
    } catch (error) {
      console.warn('[pinia-persist] Failed to parse persisted state', error)
      return null
    }
  },
}

function resolveStorageResolver(resolver: StorageResolver | string | undefined, storages?: Record<string, StorageAdapter>): StorageAdapter | null {
  const target = resolver ?? 'local'
  if (typeof target === 'string') {
    if (storages?.[target]) return storages[target]
    if (target === 'local') return isClient ? window.localStorage : memoryStorage
    if (target === 'session') return isClient ? window.sessionStorage : memoryStorage
    if (target === 'memory') return memoryStorage
    if (target === 'indexeddb') {
      if (!hasIndexedDb) {
        console.warn('[pinia-persist] IndexedDB is not available; falling back to memory storage.')
        return memoryStorage
      }
      return indexedDbStorage
    }
    console.warn(`[pinia-persist] Unknown storage key "${target}", falling back to memory storage.`)
    return memoryStorage
  }
  return target
}

function pickFromState<S extends StateTree>(state: S, pick?: (keyof S | string)[]): Partial<S> {
  if (!pick || pick.length === 0) return state
  const result: Partial<S> = {}
  for (const path of pick) {
    assignPath(result, path as string, getPath(state, path as string))
  }
  return result
}

function getPath(obj: unknown, path: string): unknown {
  const segments = path.split('.')
  let current: any = obj
  for (const segment of segments) {
    if (current == null) return undefined
    current = current[segment]
  }
  return current
}

function assignPath<T extends Record<string, any>>(target: T, path: string, value: unknown): void {
  const segments = path.split('.')
  let current: any = target
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value
      return
    }
    if (!current[segment] || typeof current[segment] !== 'object') {
      current[segment] = {}
    }
    current = current[segment]
  })
}

function normalizePersistPaths(paths?: Array<string | number | symbol>): string[] {
  if (!paths || paths.length === 0) {
    return []
  }
  const unique = new Set<string>()
  for (const entry of paths) {
    if (entry == null) {
      continue
    }
    const normalized =
      typeof entry === 'string'
        ? entry
        : typeof entry === 'number'
          ? String(entry)
          : typeof entry === 'symbol'
            ? entry.description ?? entry.toString()
            : ''
    if (normalized) {
      unique.add(normalized)
    }
  }
  return Array.from(unique)
}

function applyStatePatch<S extends StateTree>(store: PiniaPluginContext['store'], patchedState: Partial<S>) {
  store.$patch((state) => deepMerge(state, patchedState))
}

function deepMerge(target: any, source: any): any {
  if (source === null || typeof source !== 'object') return source
  if (Array.isArray(source)) return source.slice()
  const output = target ?? {}
  for (const key of Object.keys(source)) {
    const value = source[key]
    output[key] = deepMerge(output[key], value)
  }
  return output
}

function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => cloneDeep(item)) as unknown as T
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = cloneDeep((value as Record<string, unknown>)[key])
  }
  return result as T
}

function runMigrations<S extends StateTree>(
  state: Partial<S>,
  fromVersion: number,
  toVersion: number,
  migrations?: MigrationMap<S> | ((state: Partial<S>, fromVersion: number, toVersion: number) => Partial<S>),
  debug = false,
): Partial<S> {
  if (!migrations || fromVersion === toVersion) return state
  if (typeof migrations === 'function') {
    const migrated = migrations(state, fromVersion, toVersion)
    if (debug) {
      console.info('[pinia-persist] Migrated state via handler', {
        fromVersion,
        toVersion,
        before: state,
        after: migrated,
      })
    }
    return migrated
  }

  const versions = Object.keys(migrations)
    .map((value) => Number.parseInt(value, 10))
    .filter((version) => !Number.isNaN(version) && version > fromVersion && version <= toVersion)
    .sort((a, b) => a - b)

  if (versions.length === 0) return state

  let current = state
  for (const version of versions) {
    const migrate = migrations[version]
    if (typeof migrate === 'function') {
      current = migrate(current)
      if (debug) {
        console.info('[pinia-persist] Applied migration', {
          version,
          before: state,
          after: current,
        })
      }
    }
  }

  return current
}

export function createPersistedStatePlugin(options: CreatePersistPluginOptions = {}) {
  const { defaultStorage = 'local', keyPrefix = 'pinia', storages } = options

  return ({ store, options: storeOptions }: PiniaPluginContext) => {
    const persistOptions = (storeOptions as { persist?: StorePersistOptions }).persist

    if (!persistOptions) return

    const storage = resolveStorageResolver(persistOptions.storage ?? defaultStorage, storages)
    if (!storage) return

    const key = persistOptions.key ?? `${keyPrefix}:${store.$id}`
    const version = persistOptions.version ?? 1
    const serializer = persistOptions.serializer ?? defaultSerializer
    const debug = persistOptions.debug ?? false
    const shouldPersist = persistOptions.shouldPersist ?? (() => true)
    const flushDebounce = Math.max(0, persistOptions.flushDebounce ?? 250)
    const flushEvents = persistOptions.flushEvents ?? ['visibilitychange', 'pagehide', 'beforeunload']
    const observedPaths = normalizePersistPaths(
      (persistOptions.observePaths ?? persistOptions.pick) as Array<string | number | symbol> | undefined,
    )

    let fromVersion = 0
    let lastPersistedValue: string | null = null
    let lastPersistedState: Partial<StateTree> | null = null
    let pendingPayload: PersistPayload | null = null
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let flushListenersRegistered = false
    let stopSubscription: (() => void) | null = null
    let stopObservers: (() => void) | null = null
    const watchStops: WatchStopHandle[] = []
    let hydrationPromise: Promise<void> = Promise.resolve()

    const handleFlushEvent = (event: Event) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }

      if (event.type === 'visibilitychange' && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        return
      }

      void flushPendingPayload()
    }

    const registerFlushListeners = () => {
      if (!isClient || flushEvents.length === 0 || flushListenersRegistered) {
        return
      }
      flushEvents.forEach((eventName) => {
        window.addEventListener(eventName, handleFlushEvent, { passive: true })
      })
      flushListenersRegistered = true
    }

    const removeFlushListeners = () => {
      if (!isClient || !flushListenersRegistered) {
        return
      }
      flushEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleFlushEvent)
      })
      flushListenersRegistered = false
    }

    const flushPendingPayload = async () => {
      if (!pendingPayload) return
      const payload = pendingPayload
      pendingPayload = null

      try {
        await hydrationPromise.catch(() => undefined)

        if (!shouldPersist(payload.state, lastPersistedState)) {

          return
        }

        const serialized = serializer.serialize(payload)
        if (serialized === lastPersistedValue) {
          return
        }

        storage.setItem(key, serialized)
        lastPersistedValue = serialized
        lastPersistedState = cloneDeep(payload.state)

      } catch (error) {
        if (debug) {
          console.warn(`[pinia-persist] Failed to persist store "${store.$id}"`, error)
        }
      }
    }

    const schedulePersist = (state: StateTree) => {
      const partialState = pickFromState(state, persistOptions.pick)
      pendingPayload = {
        version,
        state: partialState,
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }

      if (flushDebounce === 0) {
        void flushPendingPayload()
        return
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void flushPendingPayload()
      }, flushDebounce)
    }

    const hydrate = async () => {
      try {
        const raw = await storage.getItem(key)
        lastPersistedValue = raw ?? null
        if (!raw) {
          return
        }

        const payload = serializer.deserialize(raw)
        if (!payload) {
          return
        }

        fromVersion = payload.version ?? 0
        let stateToHydrate = payload.state ?? {}
        stateToHydrate = runMigrations(
          stateToHydrate,
          fromVersion,
          version,
          persistOptions.migrations,
          debug,
        )


        applyStatePatch(store, stateToHydrate)

        if (typeof (store as any).onPersistHydrated === 'function') {
          try {
            (store as any).onPersistHydrated(stateToHydrate)
          } catch (error) {
            if (debug) {
              console.warn('[pinia-persist] onPersistHydrated hook failed', {
                storeId: store.$id,
                error,
              })
            }
          }
        }

        lastPersistedState = cloneDeep(stateToHydrate)
      } catch (error) {
        if (debug) {
          console.warn(`[pinia-persist] Failed to hydrate store "${store.$id}"`, error)
        }
      }
    }

    const stopWatchers = () => {
      if (!watchStops.length) {
        return
      }
      watchStops.forEach((stop) => stop())
      watchStops.length = 0
    }

    const startPersistenceObservers = () => {
      if (stopObservers) {
        return
      }

      if (observedPaths.length > 0) {
        observedPaths.forEach((path) => {
          const stop = watch(
            () => getPath(store.$state as StateTree, path),
            () => {
              schedulePersist(store.$state as StateTree)
            },
            { deep: true },
          )
          watchStops.push(stop)
        })

        if (watchStops.length > 0) {
          stopObservers = () => {
            stopWatchers()
          }
          return
        }
      }

      stopSubscription = store.$subscribe(
        (_mutation, state) => {
          schedulePersist(state)
        },
        { detached: true },
      )
      stopObservers = () => {
        stopSubscription?.()
        stopSubscription = null
      }
    }

    const cleanupObservers = () => {
      if (!stopObservers) {
        return
      }
      stopObservers()
      stopObservers = null
    }

    const hydrationTask = hydrate()
    const trackedHydration = hydrationTask.catch(() => undefined)
    activeHydrations.add(trackedHydration)

    hydrationPromise = trackedHydration.finally(() => {
      activeHydrations.delete(trackedHydration)
      registerFlushListeners()
      startPersistenceObservers()
    })

    const originalDispose = store.$dispose.bind(store)
    store.$dispose = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }

      void flushPendingPayload()
      removeFlushListeners()
      cleanupObservers()
      originalDispose()
    }
  }
}
