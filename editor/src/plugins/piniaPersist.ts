import type { PiniaPluginContext, StateTree } from 'pinia'

type StorageAdapter = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const isClient = typeof window !== 'undefined'

const memoryStorage: StorageAdapter = (() => {
  const storage = new Map<string, string>()
  return {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }
})()

type StorageResolver = 'local' | 'session' | 'memory' | StorageAdapter

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
  debug?: boolean
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

    let fromVersion = 0

    try {
      const raw = storage.getItem(key)
      if (raw) {
        const payload = serializer.deserialize(raw)
        if (payload) {
          fromVersion = payload.version ?? 0
          let stateToHydrate = payload.state ?? {}
          stateToHydrate = runMigrations(
            stateToHydrate,
            fromVersion,
            version,
            persistOptions.migrations,
            debug,
          )
          if (debug) {
            console.info('[pinia-persist] Hydrating store', {
              key,
              fromVersion,
              toVersion: version,
              state: stateToHydrate,
            })
          }
          applyStatePatch(store, stateToHydrate)
        }
      }
    } catch (error) {
      if (debug) {
        console.warn(`[pinia-persist] Failed to hydrate store "${store.$id}"`, error)
      }
    }

    store.$subscribe(
      (_mutation, state) => {
        try {
          const partialState = pickFromState(state, persistOptions.pick)
          const payload: PersistPayload = {
            version,
            state: partialState,
          }
          storage.setItem(key, serializer.serialize(payload))
          if (debug) {
            console.info('[pinia-persist] Persisted store', { key, version, state: partialState })
          }
        } catch (error) {
          if (debug) {
            console.warn(`[pinia-persist] Failed to persist store "${store.$id}"`, error)
          }
        }
      },
      { detached: true },
    )
  }
}
