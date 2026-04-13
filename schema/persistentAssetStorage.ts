export interface PersistentAssetRecord {
  key: string
  bytes: ArrayBuffer
  size: number
  mimeType: string | null
  filename: string | null
  downloadUrl: string | null
  storedAt: number
  lastAccessedAt: number
  assetId?: string | null
  contentHash?: string | null
  contentHashAlgorithm?: string | null
  serverUpdatedAt?: string | null
}

export interface PersistentAssetWritePayload {
  key: string
  bytes: ArrayBuffer
  size?: number
  mimeType?: string | null
  filename?: string | null
  downloadUrl?: string | null
  storedAt?: number
  lastAccessedAt?: number
  assetId?: string | null
  contentHash?: string | null
  contentHashAlgorithm?: string | null
  serverUpdatedAt?: string | null
}

export interface PersistentAssetStorage {
  get(key: string): Promise<PersistentAssetRecord | null>
  put(payload: PersistentAssetWritePayload): Promise<void>
  delete(key: string): Promise<void>
  touch?(key: string, lastAccessedAt?: number): Promise<void>
}

export interface PersistentAssetKeyInput {
  assetId?: string | null
  contentHash?: string | null
  keys?: Array<string | null | undefined>
}

export interface IndexedDbPersistentAssetStorageOptions {
  dbName?: string
  storeName?: string
  version?: number
  maxRecords?: number
  pruneBatch?: number
}

export interface WeChatFileSystemPersistentAssetStorageOptions {
  baseDirName?: string
}

type StoredIndexedDbAssetRecord = Omit<PersistentAssetRecord, 'bytes'> & {
  bytes: ArrayBuffer
}

type WxFileSystemManagerLike = {
  mkdirSync?: (path: string, recursive?: boolean) => void
  readFileSync?: (filePath: string, encoding?: string) => string | ArrayBuffer
  writeFileSync?: (filePath: string, data: ArrayBuffer | string, encoding?: string) => void
  unlinkSync?: (filePath: string) => void
}

const DEFAULT_IDB_DB_NAME = 'harmony-persistent-assets'
const DEFAULT_IDB_STORE_NAME = 'assets'
const DEFAULT_IDB_VERSION = 1
const DEFAULT_IDB_MAX_RECORDS = 1000
const DEFAULT_IDB_PRUNE_BATCH = 100
const DEFAULT_WX_BASE_DIR = 'harmony/assets'

export function normalizePersistentAssetKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function resolvePersistentAssetKeys(input: PersistentAssetKeyInput): string[] {
  const resolved = new Set<string>()
  const rawKeys = Array.isArray(input.keys) ? input.keys : []
  for (const item of rawKeys) {
    const normalized = normalizePersistentAssetKey(item)
    if (normalized) {
      resolved.add(normalized)
    }
  }

  const contentHash = normalizePersistentAssetKey(input.contentHash)
  if (contentHash) {
    resolved.add(contentHash)
  }

  const assetId = normalizePersistentAssetKey(input.assetId)
  if (assetId) {
    resolved.add(assetId)
  }

  return Array.from(resolved)
}

export function isIndexedDbPersistentAssetStorageSupported(): boolean {
  return typeof globalThis !== 'undefined'
    && typeof (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB?.open === 'function'
}

export function isWeChatFileSystemPersistentAssetStorageSupported(): boolean {
  const wxAny = (globalThis as typeof globalThis & { wx?: unknown }).wx as any
  return Boolean(wxAny && typeof wxAny.getFileSystemManager === 'function' && typeof wxAny?.env?.USER_DATA_PATH === 'string')
}

export function createNoopPersistentAssetStorage(): PersistentAssetStorage {
  return {
    async get() {
      return null
    },
    async put() {
      return
    },
    async delete() {
      return
    },
    async touch() {
      return
    },
  }
}

export function createIndexedDbPersistentAssetStorage(
  options: IndexedDbPersistentAssetStorageOptions = {},
): PersistentAssetStorage {
  const dbName = normalizePersistentAssetKey(options.dbName) ?? DEFAULT_IDB_DB_NAME
  const storeName = normalizePersistentAssetKey(options.storeName) ?? DEFAULT_IDB_STORE_NAME
  const version = Number.isFinite(options.version) && Number(options.version) > 0
    ? Number(options.version)
    : DEFAULT_IDB_VERSION
  const maxRecords = Number.isFinite(options.maxRecords) && Number(options.maxRecords) > 0
    ? Math.floor(Number(options.maxRecords))
    : DEFAULT_IDB_MAX_RECORDS
  const pruneBatch = Number.isFinite(options.pruneBatch) && Number(options.pruneBatch) > 0
    ? Math.floor(Number(options.pruneBatch))
    : DEFAULT_IDB_PRUNE_BATCH

  let dbPromise: Promise<IDBDatabase | null> | null = null

  async function openDb(): Promise<IDBDatabase | null> {
    if (!isIndexedDbPersistentAssetStorageSupported()) {
      return null
    }
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        const request = globalThis.indexedDB.open(dbName, version)
        request.onerror = () => {
          console.warn('无法打开持久化资产 IndexedDB', request.error)
          resolve(null)
        }
        request.onupgradeneeded = () => {
          const db = request.result
          let store: IDBObjectStore
          if (!db.objectStoreNames.contains(storeName)) {
            store = db.createObjectStore(storeName, { keyPath: 'key' })
          } else {
            store = request.transaction!.objectStore(storeName)
          }
          if (!store.indexNames.contains('storedAt')) {
            store.createIndex('storedAt', 'storedAt', { unique: false })
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
      })
    }
    return dbPromise
  }

  async function runOperation<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> {
    const db = await openDb()
    if (!db) {
      return null
    }
    return new Promise<T | null>((resolve) => {
      try {
        const transaction = db.transaction(storeName, mode)
        const store = transaction.objectStore(storeName)
        const request = operation(store)
        request.onerror = () => {
          console.warn('持久化资产 IndexedDB 操作失败', request.error)
          resolve(null)
        }
        transaction.oncomplete = () => resolve(request.result ?? null)
        transaction.onerror = () => {
          console.warn('持久化资产 IndexedDB 事务失败', transaction.error)
          resolve(null)
        }
        transaction.onabort = () => {
          console.warn('持久化资产 IndexedDB 事务中止', transaction.error)
          resolve(null)
        }
      } catch (error) {
        console.warn('持久化资产 IndexedDB 抛出异常', error)
        resolve(null)
      }
    })
  }

  function normalizeRecord(value: unknown): PersistentAssetRecord | null {
    if (!value || typeof value !== 'object') {
      return null
    }
    const record = value as Partial<StoredIndexedDbAssetRecord>
    const key = normalizePersistentAssetKey(record.key)
    const bytes = normalizeToArrayBuffer(record.bytes)
    if (!key || !bytes) {
      return null
    }
    const storedAt = Number(record.storedAt)
    const lastAccessedAt = Number(record.lastAccessedAt)
    return {
      key,
      bytes,
      size: Number.isFinite(record.size) && Number(record.size) >= 0 ? Number(record.size) : bytes.byteLength,
      mimeType: typeof record.mimeType === 'string' ? record.mimeType : null,
      filename: typeof record.filename === 'string' ? record.filename : null,
      downloadUrl: typeof record.downloadUrl === 'string' ? record.downloadUrl : null,
      storedAt: Number.isFinite(storedAt) ? storedAt : Date.now(),
      lastAccessedAt: Number.isFinite(lastAccessedAt) ? lastAccessedAt : Date.now(),
      assetId: typeof record.assetId === 'string' ? record.assetId : null,
      contentHash: typeof record.contentHash === 'string' ? record.contentHash : null,
      contentHashAlgorithm: typeof record.contentHashAlgorithm === 'string' ? record.contentHashAlgorithm : null,
      serverUpdatedAt: typeof record.serverUpdatedAt === 'string' ? record.serverUpdatedAt : null,
    }
  }

  async function countRecords(): Promise<number> {
    const value = await runOperation<number>('readonly', (store) => store.count())
    return Number.isFinite(value) ? Number(value) : 0
  }

  async function pruneOldest(): Promise<void> {
    const total = await countRecords()
    if (!total || total <= maxRecords) {
      return
    }
    const db = await openDb()
    if (!db) {
      return
    }
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        const index = store.index('storedAt')
        let remaining = Math.min(pruneBatch, total - maxRecords)
        const request = index.openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor || remaining <= 0) {
            return
          }
          cursor.delete()
          remaining -= 1
          cursor.continue()
        }
        request.onerror = () => {
          console.warn('持久化资产 IndexedDB 清理失败', request.error)
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => {
          console.warn('持久化资产 IndexedDB 清理事务失败', transaction.error)
          resolve()
        }
        transaction.onabort = () => {
          console.warn('持久化资产 IndexedDB 清理事务中止', transaction.error)
          resolve()
        }
      } catch (error) {
        console.warn('持久化资产 IndexedDB 清理异常', error)
        resolve()
      }
    })
  }

  return {
    async get(key: string): Promise<PersistentAssetRecord | null> {
      const normalizedKey = normalizePersistentAssetKey(key)
      if (!normalizedKey) {
        return null
      }
      const raw = await runOperation<StoredIndexedDbAssetRecord>('readonly', (store) => store.get(normalizedKey))
      return normalizeRecord(raw)
    },
    async put(payload: PersistentAssetWritePayload): Promise<void> {
      const key = normalizePersistentAssetKey(payload.key)
      const bytes = normalizeToArrayBuffer(payload.bytes)
      if (!key || !bytes) {
        return
      }
      const now = Date.now()
      await runOperation<IDBValidKey>('readwrite', (store) => store.put({
        key,
        bytes,
        size: Number.isFinite(payload.size) && Number(payload.size) >= 0 ? Number(payload.size) : bytes.byteLength,
        mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : null,
        filename: typeof payload.filename === 'string' ? payload.filename : null,
        downloadUrl: typeof payload.downloadUrl === 'string' ? payload.downloadUrl : null,
        storedAt: Number.isFinite(payload.storedAt) ? Number(payload.storedAt) : now,
        lastAccessedAt: Number.isFinite(payload.lastAccessedAt) ? Number(payload.lastAccessedAt) : now,
        assetId: typeof payload.assetId === 'string' ? payload.assetId : null,
        contentHash: typeof payload.contentHash === 'string' ? payload.contentHash : null,
        contentHashAlgorithm: typeof payload.contentHashAlgorithm === 'string' ? payload.contentHashAlgorithm : null,
        serverUpdatedAt: typeof payload.serverUpdatedAt === 'string' ? payload.serverUpdatedAt : null,
      } satisfies StoredIndexedDbAssetRecord))
      await pruneOldest()
    },
    async delete(key: string): Promise<void> {
      const normalizedKey = normalizePersistentAssetKey(key)
      if (!normalizedKey) {
        return
      }
      await runOperation<undefined>('readwrite', (store) => store.delete(normalizedKey))
    },
    async touch(key: string, lastAccessedAt?: number): Promise<void> {
      const normalizedKey = normalizePersistentAssetKey(key)
      if (!normalizedKey) {
        return
      }
      const existing = await this.get(normalizedKey)
      if (!existing) {
        return
      }
      await this.put({
        ...existing,
        lastAccessedAt: Number.isFinite(lastAccessedAt) ? Number(lastAccessedAt) : Date.now(),
      })
    },
  }
}

export function createWeChatFileSystemPersistentAssetStorage(
  options: WeChatFileSystemPersistentAssetStorageOptions = {},
): PersistentAssetStorage {
  const baseDirName = normalizePersistentAssetKey(options.baseDirName) ?? DEFAULT_WX_BASE_DIR

  function getWxFs(): WxFileSystemManagerLike {
    const wxAny = (globalThis as typeof globalThis & { wx?: unknown }).wx as any
    if (!wxAny || typeof wxAny.getFileSystemManager !== 'function') {
      throw new Error('当前环境不支持微信文件系统（getFileSystemManager 不存在）')
    }
    return wxAny.getFileSystemManager() as WxFileSystemManagerLike
  }

  function getUserDataPath(): string {
    const wxAny = (globalThis as typeof globalThis & { wx?: unknown }).wx as any
    const path = wxAny?.env?.USER_DATA_PATH
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('无法获取 USER_DATA_PATH')
    }
    return path.replace(/\/$/, '')
  }

  function resolveBaseDir(): string {
    return `${getUserDataPath()}/${baseDirName}`
  }

  function ensureDirExists(): void {
    const fs = getWxFs()
    if (typeof fs.mkdirSync !== 'function') {
      throw new Error('当前环境不支持 mkdirSync')
    }
    fs.mkdirSync(resolveBaseDir(), true)
  }

  function encodeKey(key: string): string {
    return encodeURIComponent(key).replace(/%/g, '_')
  }

  function resolveBinaryPath(key: string): string {
    return `${resolveBaseDir()}/${encodeKey(key)}.bin`
  }

  function resolveMetaPath(key: string): string {
    return `${resolveBaseDir()}/${encodeKey(key)}.json`
  }

  function readMeta(key: string): Omit<PersistentAssetRecord, 'bytes'> | null {
    const fs = getWxFs()
    if (typeof fs.readFileSync !== 'function') {
      return null
    }
    try {
      const raw = fs.readFileSync(resolveMetaPath(key), 'utf8')
      const text = typeof raw === 'string' ? raw : ''
      if (!text.trim()) {
        return null
      }
      const parsed = JSON.parse(text) as Partial<Omit<PersistentAssetRecord, 'bytes'>>
      return {
        key,
        size: Number.isFinite(parsed.size) && Number(parsed.size) >= 0 ? Number(parsed.size) : 0,
        mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : null,
        filename: typeof parsed.filename === 'string' ? parsed.filename : null,
        downloadUrl: typeof parsed.downloadUrl === 'string' ? parsed.downloadUrl : null,
        storedAt: Number.isFinite(parsed.storedAt) ? Number(parsed.storedAt) : Date.now(),
        lastAccessedAt: Number.isFinite(parsed.lastAccessedAt) ? Number(parsed.lastAccessedAt) : Date.now(),
        assetId: typeof parsed.assetId === 'string' ? parsed.assetId : null,
        contentHash: typeof parsed.contentHash === 'string' ? parsed.contentHash : null,
        contentHashAlgorithm: typeof parsed.contentHashAlgorithm === 'string' ? parsed.contentHashAlgorithm : null,
        serverUpdatedAt: typeof parsed.serverUpdatedAt === 'string' ? parsed.serverUpdatedAt : null,
      }
    } catch (_error) {
      return null
    }
  }

  function writeMeta(record: Omit<PersistentAssetRecord, 'bytes'>): void {
    const fs = getWxFs()
    if (typeof fs.writeFileSync !== 'function') {
      throw new Error('当前环境不支持 writeFileSync')
    }
    fs.writeFileSync(resolveMetaPath(record.key), JSON.stringify(record), 'utf8')
  }

  return {
    async get(key: string): Promise<PersistentAssetRecord | null> {
      const normalizedKey = normalizePersistentAssetKey(key)
      if (!normalizedKey || !isWeChatFileSystemPersistentAssetStorageSupported()) {
        return null
      }
      const fs = getWxFs()
      if (typeof fs.readFileSync !== 'function') {
        return null
      }
      try {
        const bytes = normalizeToArrayBuffer(fs.readFileSync(resolveBinaryPath(normalizedKey)))
        if (!bytes) {
          return null
        }
        const metadata = readMeta(normalizedKey)
        return {
          key: normalizedKey,
          bytes,
          size: metadata?.size ?? bytes.byteLength,
          mimeType: metadata?.mimeType ?? null,
          filename: metadata?.filename ?? null,
          downloadUrl: metadata?.downloadUrl ?? null,
          storedAt: metadata?.storedAt ?? Date.now(),
          lastAccessedAt: metadata?.lastAccessedAt ?? Date.now(),
          assetId: metadata?.assetId ?? null,
          contentHash: metadata?.contentHash ?? null,
          contentHashAlgorithm: metadata?.contentHashAlgorithm ?? null,
          serverUpdatedAt: metadata?.serverUpdatedAt ?? null,
        }
      } catch (_error) {
        return null
      }
    },
    async put(payload: PersistentAssetWritePayload): Promise<void> {
      const key = normalizePersistentAssetKey(payload.key)
      const bytes = normalizeToArrayBuffer(payload.bytes)
      if (!key || !bytes || !isWeChatFileSystemPersistentAssetStorageSupported()) {
        return
      }
      const fs = getWxFs()
      if (typeof fs.writeFileSync !== 'function') {
        return
      }
      const now = Date.now()
      ensureDirExists()
      fs.writeFileSync(resolveBinaryPath(key), bytes as any)
      writeMeta({
        key,
        size: Number.isFinite(payload.size) && Number(payload.size) >= 0 ? Number(payload.size) : bytes.byteLength,
        mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : null,
        filename: typeof payload.filename === 'string' ? payload.filename : null,
        downloadUrl: typeof payload.downloadUrl === 'string' ? payload.downloadUrl : null,
        storedAt: Number.isFinite(payload.storedAt) ? Number(payload.storedAt) : now,
        lastAccessedAt: Number.isFinite(payload.lastAccessedAt) ? Number(payload.lastAccessedAt) : now,
        assetId: typeof payload.assetId === 'string' ? payload.assetId : null,
        contentHash: typeof payload.contentHash === 'string' ? payload.contentHash : null,
        contentHashAlgorithm: typeof payload.contentHashAlgorithm === 'string' ? payload.contentHashAlgorithm : null,
        serverUpdatedAt: typeof payload.serverUpdatedAt === 'string' ? payload.serverUpdatedAt : null,
      })
    },
    async delete(key: string): Promise<void> {
      const normalizedKey = normalizePersistentAssetKey(key)
      if (!normalizedKey || !isWeChatFileSystemPersistentAssetStorageSupported()) {
        return
      }
      const fs = getWxFs()
      try {
        if (typeof fs.unlinkSync === 'function') {
          fs.unlinkSync(resolveBinaryPath(normalizedKey))
          fs.unlinkSync(resolveMetaPath(normalizedKey))
        }
      } catch (_error) {
        /* noop */
      }
    },
    async touch(key: string, lastAccessedAt?: number): Promise<void> {
      const existing = await this.get(key)
      if (!existing) {
        return
      }
      writeMeta({
        ...existing,
        lastAccessedAt: Number.isFinite(lastAccessedAt) ? Number(lastAccessedAt) : Date.now(),
      })
    },
  }
}

function normalizeToArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) {
    return value
  }
  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength)
    copy.set(value)
    return copy.buffer
  }
  if (value && typeof value === 'object' && 'buffer' in (value as any) && (value as any).buffer instanceof ArrayBuffer) {
    const view = value as { buffer: ArrayBuffer; byteOffset?: number; byteLength?: number }
    return view.buffer.slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + (view.byteLength ?? view.buffer.byteLength))
  }
  return null
}