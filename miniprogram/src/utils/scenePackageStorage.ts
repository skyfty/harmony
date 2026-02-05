import {
  writeScenePackageZipSync,
  readScenePackageZipSync,
  removeScenePackageZipSync,
} from '@/utils/scenePackageFs';

export type ScenePackagePointer =
  | { kind: 'wxfs'; ref: string }
  | { kind: 'idb'; ref: string };

function isWeChatFileSystemAvailable(): boolean {
  const wxAny = (typeof wx !== 'undefined' ? (wx as any) : null) as any;
  return Boolean(wxAny && typeof wxAny.getFileSystemManager === 'function' && typeof wxAny?.env?.USER_DATA_PATH === 'string');
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
}

const IDB_DB_NAME = 'harmony-scene-packages';
const IDB_STORE_NAME = 'zips';
const IDB_VERSION = 1;

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

async function idbPutZip(key: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openZipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入中止'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'));
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.put(buffer, key);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 写入失败'));
      req.onsuccess = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function idbGetZip(key: string): Promise<ArrayBuffer> {
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
      return value;
    }

    // Some browsers may give back a TypedArray view.
    if (value && typeof value === 'object' && 'buffer' in (value as any) && (value as any).buffer instanceof ArrayBuffer) {
      const view = value as any;
      return (view.buffer as ArrayBuffer).slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + (view.byteLength ?? (view.buffer as ArrayBuffer).byteLength));
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

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof Uint8Array) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  return input;
}

export async function saveScenePackageZip(bytes: ArrayBuffer | Uint8Array, projectId: string): Promise<ScenePackagePointer> {
  const buffer = toArrayBuffer(bytes);

  if (isWeChatFileSystemAvailable()) {
    const filePath = writeScenePackageZipSync(buffer, projectId);
    return { kind: 'wxfs', ref: filePath };
  }

  if (isIndexedDbAvailable()) {
    const key = String(projectId ?? '').trim() || `project-${Date.now()}`;
    await idbPutZip(key, buffer);
    return { kind: 'idb', ref: key };
  }

  throw new Error('当前环境不支持持久化大体积场景包（缺少文件系统/IndexedDB）');
}

export async function loadScenePackageZip(pointer: ScenePackagePointer): Promise<ArrayBuffer> {
  if (pointer.kind === 'wxfs') {
    return readScenePackageZipSync(pointer.ref);
  }
  return await idbGetZip(pointer.ref);
}

export async function removeScenePackageZip(pointer: ScenePackagePointer | null | undefined): Promise<void> {
  if (!pointer) return;
  try {
    if (pointer.kind === 'wxfs') {
      removeScenePackageZipSync(pointer.ref);
      return;
    }
    await idbDeleteZip(pointer.ref);
  } catch (_e) {
    // Ignore cleanup failures.
  }
}
