const CACHE_INDEX_KEY = 'sceneResourceCacheIndex';
const CACHE_VERSION = 1;
const CACHE_DIRECTORY_NAME = 'scene-resource-cache';
const DEFAULT_STORAGE_LIMIT = 45 * 1024 * 1024; // 45MB soft cap
const NORMALIZED_INDEX_KEY = '__scene_resource_cache_index__';

let cacheIndex = null;
let cacheDirPath = '';
let saveTimer = null;
const pendingTasks = new Map();

function getFs() {
  if (typeof wx === 'undefined' || !wx.getFileSystemManager) {
    throw new Error('微信文件系统不可用');
  }
  return wx.getFileSystemManager();
}

function getNow() {
  return Date.now();
}

function ensureCacheDirPath() {
  if (cacheDirPath) {
    return cacheDirPath;
  }
  if (typeof wx === 'undefined' || !wx.env || !wx.env.USER_DATA_PATH) {
    throw new Error('无法获取小程序用户数据目录');
  }
  cacheDirPath = `${wx.env.USER_DATA_PATH}/${CACHE_DIRECTORY_NAME}`;
  return cacheDirPath;
}

function loadCacheIndex() {
  if (cacheIndex) {
    return cacheIndex;
  }
  let stored = null;
  try {
    stored = wx.getStorageSync ? wx.getStorageSync(CACHE_INDEX_KEY) : null;
  } catch (error) {
    stored = null;
  }
  if (!stored || stored.version !== CACHE_VERSION || typeof stored.entries !== 'object') {
    cacheIndex = { version: CACHE_VERSION, entries: {}, totalSize: 0 };
    return cacheIndex;
  }
  cacheIndex = {
    version: CACHE_VERSION,
    entries: stored.entries || {},
    totalSize: stored.totalSize || 0,
  };
  return cacheIndex;
}

function scheduleSaveIndex() {
  if (saveTimer) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (wx.setStorageSync) {
        wx.setStorageSync(CACHE_INDEX_KEY, cacheIndex);
      }
    } catch (error) {
      console.warn('保存缓存索引失败', error);
    }
  }, 30);
}

async function ensureCacheDirectory() {
  ensureCacheDirPath();
  const fs = getFs();
  await new Promise((resolve) => {
    fs.access({
      path: cacheDirPath,
      success: resolve,
      fail: () => {
        fs.mkdir({
          dirPath: cacheDirPath,
          recursive: true,
          complete: resolve,
        });
      },
    });
  });
}

function sanitizeAssetId(assetId) {
  return assetId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function inferExtension(assetId, mime) {
  if (mime) {
    if (mime === 'image/png') return '.png';
    if (mime === 'image/jpeg') return '.jpg';
    if (mime === 'image/webp') return '.webp';
    if (mime === 'image/gif') return '.gif';
    if (mime === 'image/bmp') return '.bmp';
    if (mime === 'image/vnd.radiance') return '.hdr';
    if (mime === 'image/vnd-ms.dds') return '.dds';
    if (mime === 'model/gltf-binary') return '.glb';
    if (mime === 'application/octet-stream') return '.bin';
  }
  const lower = assetId.toLowerCase();
  if (lower.endsWith('.png')) return '.png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '.jpg';
  if (lower.endsWith('.webp')) return '.webp';
  if (lower.endsWith('.gif')) return '.gif';
  if (lower.endsWith('.bmp')) return '.bmp';
  if (lower.endsWith('.hdr')) return '.hdr';
  if (lower.endsWith('.dds')) return '.dds';
  if (lower.endsWith('.tga')) return '.tga';
  if (lower.endsWith('.ktx2')) return '.ktx2';
  if (lower.endsWith('.ktx')) return '.ktx';
  if (lower.endsWith('.glb')) return '.glb';
  if (lower.endsWith('.gltf')) return '.gltf';
  if (lower.endsWith('.bin')) return '.bin';
  return '.dat';
}

function buildCacheFilePath(assetId, mime) {
  const dir = ensureCacheDirPath();
  const safeName = sanitizeAssetId(assetId);
  const extension = inferExtension(assetId, mime);
  return `${dir}/${safeName}${extension}`;
}

function getCacheEntry(assetId) {
  const index = loadCacheIndex();
  return index.entries[assetId] || null;
}

function updateCacheEntry(assetId, updater) {
  const index = loadCacheIndex();
  const current = index.entries[assetId] || null;
  const next = updater(current || null);
  if (!next) {
    if (current) {
      index.totalSize = Math.max(0, index.totalSize - (current.size || 0));
      delete index.entries[assetId];
      scheduleSaveIndex();
    }
    return;
  }
  index.entries[assetId] = next;
  index.totalSize = computeTotalSize(index.entries);
  scheduleSaveIndex();
}

function computeTotalSize(entries) {
  let total = 0;
  Object.values(entries).forEach((entry) => {
    if (entry && typeof entry.size === 'number') {
      total += entry.size;
    }
  });
  return total;
}

async function readFileSafely(filePath, encoding) {
  const fs = getFs();
  return await new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      encoding,
      success: (res) => resolve(res.data),
      fail: (error) => reject(error instanceof Error ? error : new Error(error.errMsg || String(error))),
    });
  });
}

async function removeFileSafely(filePath) {
  const fs = getFs();
  return await new Promise((resolve) => {
    fs.unlink({
      filePath,
      complete: resolve,
    });
  });
}

async function writeFileSafely(filePath, data, encoding) {
  const fs = getFs();
  return await new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data,
      encoding,
      success: resolve,
      fail: (error) => reject(error instanceof Error ? error : new Error(error.errMsg || String(error))),
    });
  });
}

function cloneScenesMap(map) {
  return map ? { ...map } : {};
}

function ensureSceneSet(entry) {
  if (!entry.scenes || typeof entry.scenes !== 'object') {
    entry.scenes = {};
  }
  return entry.scenes;
}

function isHttpUrl(value) {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function normalizeAssetIndex(rawIndex) {
  if (!rawIndex || typeof rawIndex !== 'object') {
    return {};
  }
  const normalized = Object.create(null);
  Object.keys(rawIndex).forEach((key) => {
    normalized[key] = rawIndex[key];
  });
  return normalized;
}

function getAssetIndexEntry(bundle, assetId) {
  if (!assetId || !bundle || typeof bundle !== 'object') {
    return null;
  }
  let normalized = bundle[NORMALIZED_INDEX_KEY];
  if (!normalized) {
    normalized = normalizeAssetIndex(bundle.assetIndex);
    try {
      Object.defineProperty(bundle, NORMALIZED_INDEX_KEY, {
        value: normalized,
        configurable: true,
        enumerable: false,
        writable: false,
      });
    } catch (error) {
      bundle[NORMALIZED_INDEX_KEY] = normalized;
    }
  }
  const entry = normalized ? normalized[assetId] : undefined;
  if (entry && typeof entry === 'object') {
    return entry;
  }
  return null;
}

function collectAssetCandidateIds(bundle, assetId) {
  const ids = [];
  if (assetId) {
    ids.push(assetId);
  }
  const entry = getAssetIndexEntry(bundle, assetId);
  const source = entry?.source;
  if (source && typeof source === 'object' && typeof source.originalAssetId === 'string' && source.originalAssetId) {
    ids.push(source.originalAssetId);
  }
  return Array.from(new Set(ids));
}

function findAssetInCatalog(bundle, assetId) {
  const catalog = bundle?.assetCatalog;
  if (!catalog || typeof catalog !== 'object') {
    return null;
  }
  for (const list of Object.values(catalog)) {
    if (!Array.isArray(list)) {
      continue;
    }
    const match = list.find((entry) => entry && entry.id === assetId);
    if (match) {
      return match;
    }
  }
  return null;
}

async function downloadRemoteAsset(url) {
  if (typeof wx === 'undefined' || !wx.request) {
    throw new Error('wx.request 不可用，无法下载资源');
  }
  return await new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      success: (res) => {
        if (res.statusCode === 200 && res.data instanceof ArrayBuffer) {
          resolve({ buffer: res.data, contentType: res.header?.['content-type'] || res.header?.['Content-Type'] || null });
        } else {
          reject(new Error(`下载失败: ${res.statusCode}`));
        }
      },
      fail: (error) => {
        reject(error instanceof Error ? error : new Error(error.errMsg || String(error)));
      },
    });
  });
}

async function resolveAssetSourceDirect(bundle, assetId) {
  if (!assetId) {
    return null;
  }
  const packageMap = bundle?.packageAssetMap || {};
  const candidates = collectAssetCandidateIds(bundle, assetId);
  for (const candidate of candidates) {
    const embeddedKey = `local::${candidate}`;
    if (packageMap[embeddedKey]) {
      return { kind: 'data-url', data: packageMap[embeddedKey], assetId: candidate };
    }
    const directKey = packageMap[candidate];
    if (directKey && packageMap[`local::${directKey}`]) {
      return { kind: 'data-url', data: packageMap[`local::${directKey}`], assetId: candidate };
    }
  }
  for (const candidate of candidates) {
    const asset = findAssetInCatalog(bundle, candidate);
    if (asset?.downloadUrl) {
      return { kind: 'remote-url', data: asset.downloadUrl, assetId: candidate, name: asset.name || null, contentType: asset.contentType || null };
    }
  }
  if (isHttpUrl(assetId)) {
    return { kind: 'remote-url', data: assetId, assetId, name: null, contentType: null };
  }
  const entry = getAssetIndexEntry(bundle, assetId);
  if (entry?.source?.type === 'url') {
    return { kind: 'remote-url', data: assetId, assetId, name: null, contentType: null };
  }
  return null;
}

async function readCachedAsset(entry) {
  if (!entry) {
    return null;
  }
  if (entry.kind === 'data-url') {
    try {
      const data = await readFileSafely(entry.filePath, 'utf8');
      return { kind: 'data-url', data, assetId: entry.assetId, name: entry.name || null, contentType: entry.mime || null };
    } catch (error) {
      await removeFileSafely(entry.filePath);
      return null;
    }
  }
  if (entry.kind === 'arraybuffer') {
    try {
      const data = await readFileSafely(entry.filePath);
      return { kind: 'arraybuffer', data, assetId: entry.assetId, name: entry.name || null, contentType: entry.mime || null };
    } catch (error) {
      await removeFileSafely(entry.filePath);
      return null;
    }
  }
  return null;
}

async function saveAssetToCache(assetId, source) {
  await ensureCacheDirectory();
  const entry = {
    assetId,
    filePath: buildCacheFilePath(assetId, source.contentType || null),
    kind: source.kind === 'data-url' ? 'data-url' : 'arraybuffer',
    mime: source.contentType || null,
    name: source.name || null,
    size: 0,
    scenes: {},
    lastAccessed: getNow(),
  };
  if (entry.kind === 'data-url') {
    const text = source.data;
    await writeFileSafely(entry.filePath, text, 'utf8');
    entry.size = typeof text === 'string' ? text.length : 0;
  } else {
    const buffer = source.data;
    await writeFileSafely(entry.filePath, buffer);
    entry.size = buffer.byteLength || 0;
  }
  updateCacheEntry(assetId, () => entry);
  return entry;
}

function addSceneReference(entry, sceneId) {
  if (!sceneId) {
    return;
  }
  const scenes = ensureSceneSet(entry);
  scenes[sceneId] = true;
  entry.lastAccessed = getNow();
  updateCacheEntry(entry.assetId, () => entry);
}

async function ensureStorageBudget(limitBytes) {
  const limit = typeof limitBytes === 'number' ? limitBytes : DEFAULT_STORAGE_LIMIT;
  const index = loadCacheIndex();
  if (index.totalSize <= limit) {
    return;
  }
  const entries = Object.values(index.entries)
    .filter((entry) => entry && typeof entry.lastAccessed === 'number')
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  for (const entry of entries) {
    if (index.totalSize <= limit) {
      break;
    }
    await removeFileSafely(entry.filePath);
    updateCacheEntry(entry.assetId, () => null);
  }
}

async function acquireAssetSource(options) {
  const { bundle, assetId, sceneId, storageLimit } = options || {};
  if (!assetId) {
    return null;
  }
  loadCacheIndex();
  await ensureCacheDirectory();
  const existingEntry = getCacheEntry(assetId);
  if (existingEntry) {
    const cached = await readCachedAsset(existingEntry);
    if (cached) {
      addSceneReference(existingEntry, sceneId || null);
      return cached;
    }
  }
  if (pendingTasks.has(assetId)) {
    const pending = pendingTasks.get(assetId);
    const result = await pending;
    if (result && sceneId) {
      const refreshedEntry = getCacheEntry(assetId);
      if (refreshedEntry) {
        addSceneReference(refreshedEntry, sceneId);
      }
    }
    return result;
  }
  const taskPromise = (async () => {
    const directSource = await resolveAssetSourceDirect(bundle || {}, assetId);
    if (!directSource) {
      return null;
    }
    let preparedSource = directSource;
    if (directSource.kind === 'remote-url') {
      const downloaded = await downloadRemoteAsset(directSource.data);
      preparedSource = {
        kind: 'arraybuffer',
        data: downloaded.buffer,
        assetId: directSource.assetId || assetId,
        name: directSource.name || null,
        contentType: downloaded.contentType || directSource.contentType || null,
      };
    }
    if (preparedSource.kind === 'data-url') {
      preparedSource = {
        ...preparedSource,
        assetId: assetId,
        name: preparedSource.name || null,
        contentType: preparedSource.contentType || null,
      };
    } else if (preparedSource.kind === 'arraybuffer') {
      preparedSource = {
        ...preparedSource,
        assetId: assetId,
      };
    }
    const storedEntry = await saveAssetToCache(assetId, preparedSource);
    if (storageLimit !== null && storageLimit !== undefined) {
      await ensureStorageBudget(storageLimit);
    } else {
      await ensureStorageBudget();
    }
    const cached = await readCachedAsset(storedEntry);
    if (cached && sceneId) {
      addSceneReference(storedEntry, sceneId);
    }
    return cached;
  })().catch((error) => {
    console.warn('缓存资源失败', assetId, error);
    return null;
  }).finally(() => {
    pendingTasks.delete(assetId);
  });
  pendingTasks.set(assetId, taskPromise);
  const result = await taskPromise;
  return result;
}

function collectMaterialAssetIds(material) {
  const ids = [];
  if (!material || typeof material !== 'object') {
    return ids;
  }
  const textures = material.textures || {};
  Object.values(textures).forEach((ref) => {
    if (ref && typeof ref === 'object' && typeof ref.assetId === 'string' && ref.assetId) {
      ids.push(ref.assetId);
    }
  });
  return ids;
}

function collectNodeAssetIds(node) {
  const ids = [];
  if (!node || typeof node !== 'object') {
    return ids;
  }
  if (typeof node.sourceAssetId === 'string' && node.sourceAssetId) {
    ids.push(node.sourceAssetId);
  }
  if (Array.isArray(node.materials)) {
    node.materials.forEach((material) => {
      ids.push(...collectMaterialAssetIds(material));
    });
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => {
      ids.push(...collectNodeAssetIds(child));
    });
  }
  return ids;
}

function dedupeAssetIds(ids) {
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length)));
}

function collectSceneAssetIds(bundle) {
  const ids = [];
  const materials = Array.isArray(bundle?.materials) ? bundle.materials : [];
  materials.forEach((material) => {
    ids.push(...collectMaterialAssetIds(material));
  });
  const nodes = Array.isArray(bundle?.nodes) ? bundle.nodes : [];
  nodes.forEach((node) => {
    ids.push(...collectNodeAssetIds(node));
  });
  return dedupeAssetIds(ids);
}

async function preloadSceneResources(sceneId, bundle, options) {
  const assetIds = collectSceneAssetIds(bundle);
  const total = assetIds.length;
  const progress = {
    total,
    completed: 0,
    failed: 0,
    cancelled: false,
  };
  const onProgress = options?.onProgress;
  for (const assetId of assetIds) {
    if (options?.shouldCancel?.()) {
      progress.cancelled = true;
      onProgress?.({ assetId, status: 'cancelled', ...progress });
      break;
    }
    onProgress?.({ assetId, status: 'start', ...progress });
    try {
      const result = await acquireAssetSource({ bundle, assetId, sceneId });
      if (result) {
        progress.completed += 1;
        onProgress?.({ assetId, status: 'success', ...progress });
      } else {
        progress.failed += 1;
        onProgress?.({ assetId, status: 'skip', ...progress });
      }
    } catch (error) {
      progress.failed += 1;
      onProgress?.({ assetId, status: 'error', error, ...progress });
    }
  }
  return progress;
}

async function releaseSceneResources(sceneId) {
  if (!sceneId) {
    return;
  }
  const index = loadCacheIndex();
  const entries = index.entries;
  const assetIds = Object.keys(entries);
  for (const assetId of assetIds) {
    const entry = entries[assetId];
    if (!entry) {
      continue;
    }
    const scenes = ensureSceneSet(entry);
    if (scenes[sceneId]) {
      delete scenes[sceneId];
      if (!Object.keys(scenes).length) {
        await removeFileSafely(entry.filePath);
        updateCacheEntry(assetId, () => null);
      } else {
        entry.scenes = scenes;
        updateCacheEntry(assetId, () => entry);
      }
    }
  }
}

async function clearCache() {
  const index = loadCacheIndex();
  const entries = Object.values(index.entries);
  for (const entry of entries) {
    if (entry?.filePath) {
      await removeFileSafely(entry.filePath);
    }
  }
  cacheIndex = { version: CACHE_VERSION, entries: {}, totalSize: 0 };
  scheduleSaveIndex();
}

function getCacheStatistics() {
  const index = loadCacheIndex();
  const entryCount = Object.keys(index.entries).length;
  return {
    entryCount,
    totalSize: index.totalSize,
    directory: ensureCacheDirPath(),
  };
}

module.exports = {
  preloadSceneResources,
  acquireAssetSource,
  releaseSceneResources,
  clearCache,
  getCacheStatistics,
  collectSceneAssetIds,
};
