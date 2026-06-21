declare const wx: any;

import {
  normalizeScenePackageCacheKey,
  readScenePackageCacheMetaSync,
  readScenePackageZipSync,
  removeScenePackageCacheMetaSync,
  removeScenePackageZipSync,
  resolveScenePackageCacheZipPath,
  resolveScenePackageZipPath,
  type ScenePackageCacheMetadata,
  writeScenePackageCacheMetaSyncAtPath,
  writeScenePackageZipSyncAtPath,
} from './scenePackageFs';

export type ScenePackagePointer =
  | { kind: 'wxfs'; ref: string }
  | { kind: 'idb'; ref: string };

export type ScenePackageZipEntry = {
  bytes: ArrayBuffer;
  metadata: ScenePackageCacheMetadata | null;
};

type ScenePackageZipStorageRecord = {
  bytes: ArrayBuffer;
  metadata: ScenePackageCacheMetadata | null;
};

function isWeChatFileSystemAvailable(): boolean {
  const wxAny = typeof wx !== 'undefined' ? wx : null;
  return Boolean(wxAny && typeof wxAny.getFileSystemManager === 'function' && typeof wxAny?.env?.USER_DATA_PATH === 'string');
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
}

const IDB_DB_NAME = 'harmony-scene-packages';
const IDB_STORE_NAME = 'zips';
const IDB_VERSION = 2;

function openZipDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }

    const request = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbPutZip(key: string, buffer: ArrayBuffer, metadata: ScenePackageCacheMetadata | null): Promise<void> {
  const db = await openZipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入中止'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'));
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.put({
        bytes: buffer,
        metadata: metadata ?? null,
      } satisfies ScenePackageZipStorageRecord, key);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 写入失败'));
      req.onsuccess = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function idbGetZipEntry(key: string): Promise<ScenePackageZipEntry> {
  const db = await openZipDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 读取中止'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 读取失败'));
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(key);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 读取失败'));
      req.onsuccess = () => resolve(req.result);
    });

    if (value instanceof ArrayBuffer) {
      return { bytes: value, metadata: null };
    }

    if (value && typeof value === 'object') {
      const record = value as { bytes?: unknown; buffer?: unknown; metadata?: unknown };
      if (record.bytes instanceof ArrayBuffer) {
        return {
          bytes: record.bytes,
          metadata: record.metadata && typeof record.metadata === 'object'
            ? (record.metadata as ScenePackageCacheMetadata)
            : null,
        };
      }

      if (record.buffer instanceof ArrayBuffer) {
        const view = record as { buffer: ArrayBuffer; byteOffset?: number; byteLength?: number; metadata?: unknown };
        return {
          bytes: (view.buffer as ArrayBuffer).slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + (view.byteLength ?? (view.buffer as ArrayBuffer).byteLength)),
          metadata: view.metadata && typeof view.metadata === 'object'
            ? (view.metadata as ScenePackageCacheMetadata)
            : null,
        };
      }
    }

    throw new Error('IndexedDB 中未找到场景包数据');
  } finally {
    db.close();
  }
}

async function idbDeleteZip(key: string): Promise<void> {
  const db = await openZipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 删除中止'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 删除失败'));
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.delete(key);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 删除失败'));
      req.onsuccess = () => resolve();
    });
  } finally {
    db.close();
  }
}

function toArrayBuffer(input: ArrayBuffer | Uint8Array | any): ArrayBuffer {
  if (input instanceof Uint8Array) {
    return (input.buffer as any).slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  return input as ArrayBuffer;
}

function normalizeCacheMetadata(metadata: ScenePackageCacheMetadata | null | undefined): ScenePackageCacheMetadata | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const sourceUrl = typeof metadata.sourceUrl === 'string' ? metadata.sourceUrl.trim() : '';
  if (!sourceUrl) {
    return null;
  }
  return {
    sourceUrl,
    etag: typeof metadata.etag === 'string' && metadata.etag.trim().length ? metadata.etag.trim() : null,
    lastModified: typeof metadata.lastModified === 'string' && metadata.lastModified.trim().length ? metadata.lastModified.trim() : null,
    contentLength: Number.isFinite(metadata.contentLength) && (metadata.contentLength ?? 0) >= 0
      ? Math.max(0, Math.trunc(metadata.contentLength as number))
      : null,
    fetchedAt: Number.isFinite(metadata.fetchedAt) && (metadata.fetchedAt ?? 0) >= 0
      ? Math.max(0, Math.trunc(metadata.fetchedAt as number))
      : Date.now(),
  };
}

export function resolveScenePackageZipPointer(projectId: string): ScenePackagePointer {
  if (isWeChatFileSystemAvailable()) {
    return { kind: 'wxfs', ref: resolveScenePackageZipPath(projectId) };
  }

  if (isIndexedDbAvailable()) {
    return { kind: 'idb', ref: String(projectId ?? '').trim() || `project-${Date.now()}` };
  }

  throw new Error('当前环境不支持持久化大体积场景包（缺少文件系统/IndexedDB）');
}

export function resolveScenePackageZipPointerByCacheKey(cacheKey: string): ScenePackagePointer {
  const normalizedKey = normalizeScenePackageCacheKey(cacheKey);
  if (isWeChatFileSystemAvailable()) {
    return { kind: 'wxfs', ref: resolveScenePackageCacheZipPath(normalizedKey) };
  }

  if (isIndexedDbAvailable()) {
    return { kind: 'idb', ref: normalizedKey };
  }

  throw new Error('当前环境不支持持久化大体积场景包（缺少文件系统/IndexedDB）');
}

export async function saveScenePackageZipAtPointer(
  bytes: ArrayBuffer | Uint8Array,
  pointer: ScenePackagePointer,
  metadata?: ScenePackageCacheMetadata | null,
): Promise<void> {
  const buffer = toArrayBuffer(bytes);
  const normalizedMetadata = normalizeCacheMetadata(metadata ?? null);
  if (pointer.kind === 'wxfs') {
    writeScenePackageZipSyncAtPath(buffer, pointer.ref);
    writeScenePackageCacheMetaSyncAtPath(normalizedMetadata, pointer.ref);
    return;
  }

  await idbPutZip(pointer.ref, buffer, normalizedMetadata);
}

export async function saveScenePackageZip(
  bytes: ArrayBuffer | Uint8Array,
  projectId: string,
  metadata?: ScenePackageCacheMetadata | null,
): Promise<ScenePackagePointer> {
  const pointer = resolveScenePackageZipPointer(projectId);
  await saveScenePackageZipAtPointer(bytes, pointer, metadata);
  return pointer;
}

export async function saveScenePackageZipByCacheKey(
  bytes: ArrayBuffer | Uint8Array,
  cacheKey: string,
  metadata?: ScenePackageCacheMetadata | null,
): Promise<ScenePackagePointer> {
  const pointer = resolveScenePackageZipPointerByCacheKey(cacheKey);
  await saveScenePackageZipAtPointer(bytes, pointer, metadata);
  return pointer;
}

export async function loadScenePackageZipEntry(pointer: ScenePackagePointer): Promise<ScenePackageZipEntry> {
  if (pointer.kind === 'wxfs') {
    return {
      bytes: readScenePackageZipSync(pointer.ref),
      metadata: readScenePackageCacheMetaSync(pointer.ref),
    };
  }
  return await idbGetZipEntry(pointer.ref);
}

export async function loadScenePackageZip(pointer: ScenePackagePointer): Promise<ArrayBuffer> {
  return (await loadScenePackageZipEntry(pointer)).bytes;
}

export async function loadScenePackageZipByCacheKey(cacheKey: string): Promise<ArrayBuffer> {
  return await loadScenePackageZip(resolveScenePackageZipPointerByCacheKey(cacheKey));
}

export async function removeScenePackageZip(pointer: ScenePackagePointer | null | undefined): Promise<void> {
  if (!pointer) return;
  try {
    if (pointer.kind === 'wxfs') {
      removeScenePackageZipSync(pointer.ref);
      removeScenePackageCacheMetaSync(pointer.ref);
      return;
    }
    await idbDeleteZip(pointer.ref);
  } catch (_e) {
    // Ignore cleanup failures.
  }
}

export async function removeScenePackageZipByCacheKey(cacheKey: string): Promise<void> {
  await removeScenePackageZip(resolveScenePackageZipPointerByCacheKey(cacheKey));
}
