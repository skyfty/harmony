import * as THREE from 'three'
import type ResourceCache from '@schema/ResourceCache'
import type { AssetCacheEntry } from '@schema/assetCache'
import type { SceneNodeImportMetadata } from '@harmony/schema'
import { loadObjectFromFile } from '@/utils/assetImport'

export function createFileFromEntry(assetId: string, entry: AssetCacheEntry): File | null {
  const filename = entry.filename && entry.filename.trim().length ? entry.filename : `${assetId}.glb`
  const mimeType = entry.mimeType ?? 'application/octet-stream'

  if (entry.blob instanceof File) {
    return entry.blob
  }

  if (entry.blob) {
    try {
      return new File([entry.blob], filename, { type: mimeType })
    } catch (_error) {
      /* noop */
    }
  }

  if (entry.arrayBuffer) {
    try {
      return new File([entry.arrayBuffer], filename, { type: mimeType })
    } catch (_error) {
      if (typeof Blob !== 'undefined') {
        try {
          const blob = new Blob([entry.arrayBuffer], { type: mimeType })
          return new File([blob], filename, { type: mimeType })
        } catch (_innerError) {
          /* noop */
        }
      }
    }
  }

  return null
}

export async function loadAssetObject(resourceCache: ResourceCache, assetId: string): Promise<THREE.Object3D | null> {
  if (!assetId) {
    return null
  }
  const entry = await resourceCache.acquireAssetEntry(assetId)
  if (!entry) {
    return null
  }
  const file = createFileFromEntry(assetId, entry)
  if (!file) {
    return null
  }
  try {
    const object = await loadObjectFromFile(file)
    return object
  } catch (error) {
    console.warn('[ModelAssetLoader] Failed to parse asset object', assetId, error)
    return null
  }
}

export function findObjectByPath(root: THREE.Object3D, path: number[] | null | undefined): THREE.Object3D | null {
  if (!Array.isArray(path) || !path.length) {
    return root
  }
  let current: THREE.Object3D | undefined = root
  for (const segment of path) {
    if (!current) {
      return null
    }
    const index = Number.isInteger(segment) ? segment : Number.NaN
    if (!Number.isFinite(index) || index < 0 || index >= current.children.length) {
      return null
    }
    current = current.children[index]
  }
  return current ?? null
}

export async function loadNodeObject(
  resourceCache: ResourceCache,
  assetId: string,
  metadata?: SceneNodeImportMetadata | null,
): Promise<THREE.Object3D | null> {
  const base = await loadAssetObject(resourceCache, assetId)
  if (!base) {
    return null
  }
  const target = findObjectByPath(base, metadata?.objectPath)
  if (!target) {
    return null
  }
  return target.clone(true)
}
