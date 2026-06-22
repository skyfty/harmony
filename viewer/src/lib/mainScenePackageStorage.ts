export type ScenePackagePointer = { kind: 'wxfs'; ref: string } | { kind: 'idb'; ref: string };

const SCENE_PACKAGE_DIR_NAME = 'harmony/scene-packages';

function normalizeScenePackageCacheKey(rawKey: string): string {
  const trimmed = String(rawKey ?? '').trim();
  if (!trimmed) {
    return 'scene-package';
  }

  let hash = 2166136261;
  for (let index = 0; index < trimmed.length; index += 1) {
    hash ^= trimmed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const hashSuffix = (hash >>> 0).toString(36);
  const safePrefix = trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.]+|[_\.]+$/g, '')
    .slice(0, 48);

  return safePrefix ? `${safePrefix}-${hashSuffix}` : `scene-package-${hashSuffix}`;
}

function getWxFileSystemManager(): any {
  const wxAny = (typeof wx !== 'undefined' ? (wx as any) : null) as any;
  if (!wxAny || typeof wxAny.getFileSystemManager !== 'function') {
    throw new Error('当前环境不支持微信文件系统');
  }
  return wxAny.getFileSystemManager();
}

function getUserDataPath(): string {
  const wxAny = (typeof wx !== 'undefined' ? (wx as any) : null) as any;
  const path = wxAny?.env?.USER_DATA_PATH;
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('无法获取 USER_DATA_PATH');
  }
  return path;
}

function ensureDirExistsSync(dirPath: string): void {
  const fs = getWxFileSystemManager();
  if (typeof fs.mkdirSync !== 'function') {
    throw new Error('当前环境不支持 mkdirSync');
  }
  fs.mkdirSync(dirPath, true);
}

function resolveScenePackageDir(): string {
  const base = getUserDataPath().replace(/\/$/, '');
  return `${base}/${SCENE_PACKAGE_DIR_NAME}`;
}

function resolveScenePackageZipPath(projectId: string): string {
  const safeId = String(projectId ?? '').trim() || 'project';
  const dir = resolveScenePackageDir();
  return `${dir}/${safeId}.zip`;
}

function resolveScenePackageCacheZipPath(cacheKey: string): string {
  const safeKey = normalizeScenePackageCacheKey(cacheKey);
  const dir = resolveScenePackageDir();
  return `${dir}/${safeKey}.zip`;
}

function writeScenePackageZipSyncAtPath(bytes: ArrayBuffer | Uint8Array, filePath: string): string {
  const fs = getWxFileSystemManager();
  if (typeof fs.writeFileSync !== 'function') {
    throw new Error('当前环境不支持 writeFileSync');
  }

  const normalizedFilePath = String(filePath).replace(/\\/g, '/');
  const dirSeparatorIndex = normalizedFilePath.lastIndexOf('/');
  const dir = dirSeparatorIndex >= 0 ? normalizedFilePath.slice(0, dirSeparatorIndex) : '';
  ensureDirExistsSync(dir);
  const buffer = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  fs.writeFileSync(normalizedFilePath, buffer as any);
  return normalizedFilePath;
}

function readScenePackageZipSync(filePath: string): ArrayBuffer {
  const fs = getWxFileSystemManager();
  if (typeof fs.readFileSync !== 'function') {
    throw new Error('当前环境不支持 readFileSync');
  }
  const result = fs.readFileSync(filePath as any);
  if (result instanceof ArrayBuffer) {
    return result;
  }
  throw new Error('读取场景包失败');
}

function removeScenePackageZipSync(filePath: string | null | undefined): void {
  const trimmed = typeof filePath === 'string' ? filePath.trim() : '';
  if (!trimmed) return;

  try {
    const fs = getWxFileSystemManager();
    if (typeof fs.unlinkSync === 'function') {
      fs.unlinkSync(trimmed);
    }
  } catch (_e) {
    // Ignore cleanup failures.
  }
}

function isWeChatFileSystemAvailable(): boolean {
  const wxAny = (typeof wx !== 'undefined' ? (wx as any) : null) as any;
  return Boolean(wxAny && typeof wxAny.getFileSystemManager === 'function' && typeof wxAny?.env?.USER_DATA_PATH === 'string');
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
}

async function openZipDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }

    // Bump the database version so existing installations with v2+ storage
    // can open without a VersionError.
    const request = indexedDB.open('harmony-scene-packages', 2);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('zips')) {
        db.createObjectStore('zips');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbPutZip(key: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openZipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('zips', 'readwrite');
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入中止'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'));
      const store = tx.objectStore('zips');
      const req = store.put(buffer, key);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 写入失败'));
      req.onsuccess = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function idbDeleteZip(key: string): Promise<void> {
  const db = await openZipDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('zips', 'readwrite');
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 删除中止'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 删除失败'));
      const store = tx.objectStore('zips');
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

export function resolveScenePackageZipPointer(projectId: string): ScenePackagePointer {
  if (isWeChatFileSystemAvailable()) {
    return { kind: 'wxfs', ref: resolveScenePackageZipPath(projectId) };
  }
  if (isIndexedDbAvailable()) {
    return { kind: 'idb', ref: String(projectId ?? '').trim() || `project-${Date.now()}` };
  }
  throw new Error('当前环境不支持场景包持久化');
}

export function resolveScenePackageZipPointerByCacheKey(cacheKey: string): ScenePackagePointer {
  const normalizedKey = normalizeScenePackageCacheKey(cacheKey);
  if (isWeChatFileSystemAvailable()) {
    return { kind: 'wxfs', ref: resolveScenePackageCacheZipPath(normalizedKey) };
  }
  if (isIndexedDbAvailable()) {
    return { kind: 'idb', ref: normalizedKey };
  }
  throw new Error('当前环境不支持场景包持久化');
}

export async function saveScenePackageZip(bytes: ArrayBuffer | Uint8Array, projectId: string): Promise<ScenePackagePointer> {
  const pointer = resolveScenePackageZipPointer(projectId);
  const buffer = toArrayBuffer(bytes);
  if (pointer.kind === 'wxfs') {
    writeScenePackageZipSyncAtPath(buffer, pointer.ref);
    return pointer;
  }
  await idbPutZip(pointer.ref, buffer);
  return pointer;
}

export async function discardScenePackageZip(pointer: ScenePackagePointer | null | undefined): Promise<void> {
  if (!pointer) {
    return;
  }
  try {
    if (pointer.kind === 'wxfs') {
      removeScenePackageZipSync(pointer.ref);
      return;
    }
    await idbDeleteZip(pointer.ref);
  } catch (_error) {
    // Ignore cleanup failures.
  }
}

export async function loadScenePackageZip(pointer: ScenePackagePointer): Promise<ArrayBuffer> {
  if (pointer.kind === 'wxfs') {
    return readScenePackageZipSync(pointer.ref);
  }
  const db = await openZipDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('zips', 'readonly');
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 读取中止'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 读取失败'));
      const store = tx.objectStore('zips');
      const req = store.get(pointer.ref);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 读取失败'));
      req.onsuccess = () => resolve(req.result);
    });

    if (value instanceof ArrayBuffer) {
      return value;
    }

    if (value && typeof value === 'object' && 'buffer' in (value as any) && (value as any).buffer instanceof ArrayBuffer) {
      const view = value as any;
      return (view.buffer as ArrayBuffer).slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + (view.byteLength ?? (view.buffer as ArrayBuffer).byteLength));
    }

    throw new Error('IndexedDB 中未找到场景包数据');
  } finally {
    db.close();
  }
}
