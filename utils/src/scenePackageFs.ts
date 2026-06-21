declare const wx: any;

type WxFileSystemManagerLike = {
  accessSync?: (path: string) => void;
  mkdirSync?: (path: string, recursive?: boolean) => void;
  readFileSync?: (filePath: string, encoding?: string) => string | ArrayBuffer;
  writeFileSync?: (filePath: string, data: string | ArrayBuffer, encoding?: string) => void;
  unlinkSync?: (filePath: string) => void;
};

export type ScenePackageCacheMetadata = {
  sourceUrl: string;
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
  fetchedAt: number;
};

function getWxFileSystemManager(): WxFileSystemManagerLike {
  const wxAny = typeof wx !== 'undefined' ? wx : null;
  if (!wxAny || typeof wxAny.getFileSystemManager !== 'function') {
    throw new Error('当前环境不支持微信文件系统（getFileSystemManager 不存在）');
  }
  return wxAny.getFileSystemManager() as WxFileSystemManagerLike;
}

function getUserDataPath(): string {
  const wxAny = typeof wx !== 'undefined' ? wx : null;
  const path = wxAny?.env?.USER_DATA_PATH;
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('无法获取 USER_DATA_PATH');
  }
  return path;
}

function normalizeToArrayBuffer(input: ArrayBuffer | Uint8Array | any): ArrayBuffer {
  if (input instanceof Uint8Array) {
    return (input.buffer as any).slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  return input as ArrayBuffer;
}

function ensureDirExistsSync(dirPath: string): void {
  const fs = getWxFileSystemManager();
  if (typeof fs.mkdirSync !== 'function') {
    throw new Error('当前环境不支持 mkdirSync');
  }
  fs.mkdirSync(dirPath, true);
}

function normalizeScenePackageCacheMetadata(
  metadata: ScenePackageCacheMetadata | null | undefined,
): ScenePackageCacheMetadata | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const sourceUrl = typeof metadata.sourceUrl === 'string' ? metadata.sourceUrl.trim() : '';
  if (!sourceUrl) {
    return null;
  }
  const etag = typeof metadata.etag === 'string' && metadata.etag.trim().length ? metadata.etag.trim() : null;
  const lastModified = typeof metadata.lastModified === 'string' && metadata.lastModified.trim().length
    ? metadata.lastModified.trim()
    : null;
  const contentLength = Number.isFinite(metadata.contentLength) && (metadata.contentLength ?? 0) >= 0
    ? Math.max(0, Math.trunc(metadata.contentLength as number))
    : null;
  const fetchedAt = Number.isFinite(metadata.fetchedAt) && (metadata.fetchedAt ?? 0) >= 0
    ? Math.max(0, Math.trunc(metadata.fetchedAt as number))
    : Date.now();
  return {
    sourceUrl,
    etag,
    lastModified,
    contentLength,
    fetchedAt,
  };
}

const SCENE_PACKAGE_DIR_NAME = 'harmony/scene-packages';
const SCENE_PACKAGE_CACHE_META_SUFFIX = '.meta.json';

export function normalizeScenePackageCacheKey(rawKey: string): string {
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

export function resolveScenePackageDir(): string {
  const base = getUserDataPath().replace(/\/$/, '');
  return `${base}/${SCENE_PACKAGE_DIR_NAME}`;
}

export function resolveScenePackageZipPath(projectId: string): string {
  const safeId = String(projectId ?? '').trim() || 'project';
  const dir = resolveScenePackageDir();
  return `${dir}/${safeId}.zip`;
}

export function resolveScenePackageCacheZipPath(cacheKey: string): string {
  const safeKey = normalizeScenePackageCacheKey(cacheKey);
  const dir = resolveScenePackageDir();
  return `${dir}/${safeKey}.zip`;
}

export function resolveScenePackageCacheMetaPath(cacheKeyOrZipPath: string): string {
  const normalized = String(cacheKeyOrZipPath ?? '').trim();
  if (!normalized) {
    return `${resolveScenePackageDir()}/scene-package${SCENE_PACKAGE_CACHE_META_SUFFIX}`;
  }
  if (normalized.endsWith('.zip')) {
    return `${normalized}${SCENE_PACKAGE_CACHE_META_SUFFIX}`;
  }
  return `${resolveScenePackageCacheZipPath(normalized)}${SCENE_PACKAGE_CACHE_META_SUFFIX}`;
}

export function writeScenePackageZipSyncAtPath(bytes: ArrayBuffer | Uint8Array, filePath: string): string {
  const fs = getWxFileSystemManager();
  if (typeof fs.writeFileSync !== 'function') {
    throw new Error('当前环境不支持 writeFileSync');
  }

  const normalizedFilePath = String(filePath).replace(/\\/g, '/');
  const dirSeparatorIndex = normalizedFilePath.lastIndexOf('/');
  const dir = dirSeparatorIndex >= 0 ? normalizedFilePath.slice(0, dirSeparatorIndex) : '';
  ensureDirExistsSync(dir);
  const buffer = normalizeToArrayBuffer(bytes);
  fs.writeFileSync(normalizedFilePath, buffer as any);
  return normalizedFilePath;
}

export function writeScenePackageZipSync(bytes: ArrayBuffer | Uint8Array, projectId: string): string {
  return writeScenePackageZipSyncAtPath(bytes, resolveScenePackageZipPath(projectId));
}

export function writeScenePackageZipSyncByCacheKey(bytes: ArrayBuffer | Uint8Array, cacheKey: string): string {
  return writeScenePackageZipSyncAtPath(bytes, resolveScenePackageCacheZipPath(cacheKey));
}

export function writeScenePackageCacheMetaSyncAtPath(
  metadata: ScenePackageCacheMetadata | null | undefined,
  filePath: string,
): string | null {
  const normalized = normalizeScenePackageCacheMetadata(metadata);
  if (!normalized) {
    removeScenePackageCacheMetaSync(filePath);
    return null;
  }
  const fs = getWxFileSystemManager();
  if (typeof fs.writeFileSync !== 'function') {
    throw new Error('当前环境不支持 writeFileSync');
  }
  const normalizedFilePath = resolveScenePackageCacheMetaPath(filePath);
  const dirSeparatorIndex = normalizedFilePath.lastIndexOf('/');
  const dir = dirSeparatorIndex >= 0 ? normalizedFilePath.slice(0, dirSeparatorIndex) : '';
  ensureDirExistsSync(dir);
  fs.writeFileSync(normalizedFilePath, JSON.stringify(normalized), 'utf8');
  return normalizedFilePath;
}

export function writeScenePackageCacheMetaSyncByCacheKey(
  metadata: ScenePackageCacheMetadata | null | undefined,
  cacheKey: string,
): string | null {
  return writeScenePackageCacheMetaSyncAtPath(metadata, resolveScenePackageCacheZipPath(cacheKey));
}

export function readScenePackageZipSync(filePath: string): ArrayBuffer {
  const fs = getWxFileSystemManager();
  if (typeof fs.readFileSync !== 'function') {
    throw new Error('当前环境不支持 readFileSync');
  }
  const result = fs.readFileSync(filePath as any);
  if (result instanceof ArrayBuffer) {
    return result;
  }
  throw new Error('读取场景包失败（返回不是 ArrayBuffer）');
}

export function readScenePackageCacheMetaSync(filePath: string): ScenePackageCacheMetadata | null {
  const fs = getWxFileSystemManager();
  if (typeof fs.readFileSync !== 'function') {
    throw new Error('当前环境不支持 readFileSync');
  }
  try {
    const result = fs.readFileSync(resolveScenePackageCacheMetaPath(filePath) as any, 'utf8');
    const text = typeof result === 'string' ? result.trim() : '';
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text) as ScenePackageCacheMetadata;
    return normalizeScenePackageCacheMetadata(parsed);
  } catch (_error) {
    return null;
  }
}

export function removeScenePackageCacheMetaSync(filePath: string | null | undefined): void {
  const trimmed = typeof filePath === 'string' ? filePath.trim() : '';
  if (!trimmed) return;

  try {
    const fs = getWxFileSystemManager();
    if (typeof fs.unlinkSync === 'function') {
      fs.unlinkSync(resolveScenePackageCacheMetaPath(trimmed));
    }
  } catch (_e) {
    // Ignore cleanup failures.
  }
}

export function removeScenePackageZipSync(filePath: string | null | undefined): void {
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
  removeScenePackageCacheMetaSync(trimmed);
}
