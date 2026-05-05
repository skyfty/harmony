import { unzipSync, zipSync } from 'fflate'

import {
  createIndexedDbPersistentAssetStorage,
  createNoopPersistentAssetStorage,
  isIndexedDbPersistentAssetStorageSupported,
  type CompiledGroundManifest,
  type PersistentAssetStorage,
} from '@schema'

export type PreviewCompiledGroundPackage = {
  manifest: CompiledGroundManifest
  files: Map<string, ArrayBuffer>
}

const CACHE_FORMAT_VERSION = 1
const CACHE_KEY_PREFIX = `preview-compiled-ground:v${CACHE_FORMAT_VERSION}:`
const CACHE_MANIFEST_ENTRY = '__compiled_ground_manifest__.json'
export const PREVIEW_COMPILED_GROUND_PERSIST_MAX_BYTES = 96 * 1024 * 1024

let previewCompiledGroundCacheStorage: PersistentAssetStorage | null = null

function getPreviewCompiledGroundCacheStorage(): PersistentAssetStorage {
  if (!previewCompiledGroundCacheStorage) {
    previewCompiledGroundCacheStorage = isIndexedDbPersistentAssetStorageSupported()
      ? createIndexedDbPersistentAssetStorage({
          dbName: 'harmony-preview-compiled-ground',
          storeName: 'compiled-ground-packages',
          version: 1,
          maxRecords: 24,
          pruneBatch: 6,
        })
      : createNoopPersistentAssetStorage()
  }
  return previewCompiledGroundCacheStorage
}

function getCacheStorageKey(buildKey: string): string {
  return `${CACHE_KEY_PREFIX}${buildKey}`
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function encodeManifest(manifest: CompiledGroundManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest))
}

function decodeManifest(bytes: Uint8Array): CompiledGroundManifest | null {
  try {
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as CompiledGroundManifest
    return decoded && typeof decoded === 'object' ? decoded : null
  } catch (_error) {
    return null
  }
}

function serializePackageBytes(pkg: PreviewCompiledGroundPackage): Uint8Array {
  const archiveEntries: Record<string, Uint8Array> = {
    [CACHE_MANIFEST_ENTRY]: encodeManifest(pkg.manifest),
  }
  pkg.files.forEach((buffer, path) => {
    archiveEntries[path] = new Uint8Array(buffer)
  })
  return zipSync(archiveEntries, { level: 0 })
}

export function estimatePreviewCompiledGroundPackageBytes(pkg: PreviewCompiledGroundPackage): number {
  let total = encodeManifest(pkg.manifest).byteLength
  pkg.files.forEach((buffer) => {
    total += buffer.byteLength
  })
  return total
}

function deserializePackageBytes(bytes: ArrayBuffer): PreviewCompiledGroundPackage | null {
  try {
    const archive = unzipSync(new Uint8Array(bytes))
    const manifestBytes = archive[CACHE_MANIFEST_ENTRY] ?? null
    const manifest = manifestBytes ? decodeManifest(manifestBytes) : null
    if (!manifest) {
      return null
    }
    const files = new Map<string, ArrayBuffer>()
    Object.entries(archive).forEach(([path, entryBytes]) => {
      if (path === CACHE_MANIFEST_ENTRY) {
        return
      }
      files.set(path, toArrayBuffer(entryBytes))
    })
    return { manifest, files }
  } catch (_error) {
    return null
  }
}

export async function loadPreviewCompiledGroundPackageFromCache(
  buildKey: string,
): Promise<PreviewCompiledGroundPackage | null> {
  const normalizedBuildKey = typeof buildKey === 'string' ? buildKey.trim() : ''
  if (!normalizedBuildKey) {
    return null
  }
  const storage = getPreviewCompiledGroundCacheStorage()
  const record = await storage.get(getCacheStorageKey(normalizedBuildKey))
  if (!record?.bytes) {
    return null
  }
  const pkg = deserializePackageBytes(record.bytes)
  if (!pkg) {
    await storage.delete(record.key)
    return null
  }
  await storage.touch?.(record.key, Date.now())
  return pkg
}

export async function savePreviewCompiledGroundPackageToCache(
  buildKey: string,
  pkg: PreviewCompiledGroundPackage,
): Promise<void> {
  const normalizedBuildKey = typeof buildKey === 'string' ? buildKey.trim() : ''
  if (!normalizedBuildKey) {
    return
  }
  const storage = getPreviewCompiledGroundCacheStorage()
  const bytes = serializePackageBytes(pkg)
  const now = Date.now()
  await storage.put({
    key: getCacheStorageKey(normalizedBuildKey),
    bytes: toArrayBuffer(bytes),
    size: bytes.byteLength,
    mimeType: 'application/octet-stream',
    filename: `${normalizedBuildKey}.zip`,
    storedAt: now,
    lastAccessedAt: now,
  })
}
