import type { Object3D } from 'three'

const modelObjectCache = new Map<string, Object3D>()
const pendingLoads = new Map<string, Promise<Object3D>>()

export function getCachedModelObject(assetId: string): Object3D | null {
  return modelObjectCache.get(assetId) ?? null
}

export function getOrLoadModelObject(assetId: string, loader: () => Promise<Object3D>): Promise<Object3D> {
  const cached = modelObjectCache.get(assetId)
  if (cached) {
    return Promise.resolve(cached)
  }

  const pending = pendingLoads.get(assetId)
  if (pending) {
    return pending
  }

  const promise = loader()
    .then((object) => {
      modelObjectCache.set(assetId, object)
      pendingLoads.delete(assetId)
      return object
    })
    .catch((error) => {
      pendingLoads.delete(assetId)
      throw error
    })

  pendingLoads.set(assetId, promise)
  return promise
}

export function invalidateModelObject(assetId: string): void {
  modelObjectCache.delete(assetId)
  pendingLoads.delete(assetId)
}

export function clearModelObjectCache(): void {
  modelObjectCache.clear()
  pendingLoads.clear()
}
