import * as THREE from 'three'
import { collectAnimationClips } from './runtimeAnimationCatalog'

/**
 * 外部动画资产（动画文件）的共享运行时缓存。
 * 动画文件本身只需要动画片段（AnimationClip），不需要携带网格；
 * 解析后的 Object3D 在这里按资产 ID 缓存，供动画运行时收集 clip。
 */
const cachedObjects = new Map<string, THREE.Object3D | null>()
const pendingLoads = new Map<string, Promise<THREE.Object3D | null>>()

export function hasCachedExternalAnimationObject(assetId: string): boolean {
  return cachedObjects.has(assetId) || pendingLoads.has(assetId)
}

export function getCachedExternalAnimationObject(assetId: string): THREE.Object3D | null {
  return cachedObjects.get(assetId) ?? null
}

export function collectCachedExternalAnimationClips(assetId: string): THREE.AnimationClip[] {
  const object = cachedObjects.get(assetId)
  return object ? collectAnimationClips(object) : []
}

export function getOrLoadExternalAnimationObject(
  assetId: string,
  loader: () => Promise<THREE.Object3D | null>,
): Promise<THREE.Object3D | null> {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalized) {
    return Promise.resolve(null)
  }
  if (cachedObjects.has(normalized)) {
    return Promise.resolve(cachedObjects.get(normalized) ?? null)
  }
  const pending = pendingLoads.get(normalized)
  if (pending) {
    return pending
  }

  const promise = (async () => {
    try {
      const object = await loader()
      cachedObjects.set(normalized, object)
      return object
    } catch (error) {
      console.warn('[ExternalAnimationAsset] Failed to load external animation asset', normalized, error)
      cachedObjects.set(normalized, null)
      return null
    } finally {
      pendingLoads.delete(normalized)
    }
  })()

  pendingLoads.set(normalized, promise)
  return promise
}

export function resetExternalAnimationAssetCache(): void {
  cachedObjects.clear()
  pendingLoads.clear()
}
