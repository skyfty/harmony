import * as THREE from 'three'

import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'

import { loadObjectFromFile } from '@schema/assetImport'
import { getCachedModelObject, getOrLoadModelObject } from '@schema/modelObjectCache'
import { setDragPreviewReady } from '@/utils/dragPreviewRegistry'
import { acquirePrefabPreviewRoot, type PrefabPreviewHandle } from '@/utils/prefabPreviewBuilder'

export type DragPreviewController = {
  group: THREE.Group
  getLastPoint: () => THREE.Vector3 | null
  setPosition: (point: THREE.Vector3 | null) => void
  prepare: (assetId: string) => void
  dispose: (cancelLoad?: boolean) => void
}

type AssetCacheStoreLike = {
  hasCache: (assetId: string) => boolean
  loadFromIndexedDb: (assetId: string) => Promise<unknown>
  createFileFromCache: (assetId: string) => File | null
  releaseInMemoryBlob: (assetId: string) => void
}

type Options = {
  getProjectTree: () => ProjectDirectory[] | undefined
  assetCacheStore: AssetCacheStoreLike
  disposeObjectResources: (object: THREE.Object3D) => void
}

function findAssetMetadata(assetId: string, projectTree: ProjectDirectory[] | undefined): ProjectAsset | null {
  const search = (directories: ProjectDirectory[] | undefined): ProjectAsset | null => {
    if (!directories) {
      return null
    }
    for (const directory of directories) {
      if (directory.assets) {
        const match = directory.assets.find((asset) => asset.id === assetId)
        if (match) {
          return match
        }
      }
      if (directory.children && directory.children.length > 0) {
        const nested = search(directory.children)
        if (nested) {
          return nested
        }
      }
    }
    return null
  }

  return search(projectTree)
}

function applyPreviewVisualTweaks(object: THREE.Object3D) {
  object.position.set(0, 0, 0)
  object.rotation.set(0, 0, 0)
  object.scale.set(1, 1, 1)
  // Intentionally keep original materials for preview rendering.
  // We avoid forcing transparency/opacity so the drag preview matches the final object visually.
}

export function useDragPreview(options: Options): DragPreviewController {
  const group = new THREE.Group()
  group.visible = false
  group.name = 'DragPreview'

  let dragPreviewObject: THREE.Object3D | null = null
  let dragPreviewAssetId: string | null = null
  let pendingPreviewAssetId: string | null = null
  let dragPreviewLoadToken = 0
  let lastDragPoint: THREE.Vector3 | null = null
  let activePrefabHandle: PrefabPreviewHandle | null = null

  const clearObject = (disposeResources = true) => {
    if (dragPreviewAssetId) {
      setDragPreviewReady(dragPreviewAssetId, false)
    }
    // Release pinned prefab cache entry (if any).
    activePrefabHandle?.release()
    activePrefabHandle = null

    // NOTE: drag preview objects share geometry/material/texture by design.
    // Avoid disposing shared GPU resources here.
    if (dragPreviewObject && disposeResources) {
      // Intentionally no-op.
    }
    group.clear()
    dragPreviewObject = null
    dragPreviewAssetId = null
    group.visible = false
  }

  const dispose = (cancelLoad = true) => {
    if (cancelLoad) {
      dragPreviewLoadToken += 1
      pendingPreviewAssetId = null
    }
    lastDragPoint = null
    clearObject(true)
  }

  const setPosition = (point: THREE.Vector3 | null) => {
    lastDragPoint = point ? point.clone() : null
    if (!dragPreviewObject || !point) {
      group.visible = false
      return
    }
    group.position.copy(point)
    group.visible = true
  }

  const getLastPoint = () => (lastDragPoint ? lastDragPoint.clone() : null)

  const loadForAsset = async (asset: ProjectAsset): Promise<boolean> => {
    if (pendingPreviewAssetId === asset.id) {
      return false
    }

    pendingPreviewAssetId = asset.id
    clearObject(true)
    const token = ++dragPreviewLoadToken

    try {
      let baseGroup = getCachedModelObject(asset.id)

      if (!baseGroup) {
        let file = options.assetCacheStore.createFileFromCache(asset.id)
        if (!file) {
          await options.assetCacheStore.loadFromIndexedDb(asset.id)
          file = options.assetCacheStore.createFileFromCache(asset.id)
        }
        if (!file) {
          pendingPreviewAssetId = null
          return false
        }
        baseGroup = await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file, asset.extension ?? undefined))
        options.assetCacheStore.releaseInMemoryBlob(asset.id)
      }

      if (token !== dragPreviewLoadToken) {
        return false
      }

      // Clone to avoid mutating cached modelObjectCache entries.
      const previewObject = baseGroup.object.clone(true)
      applyPreviewVisualTweaks(previewObject)
      dragPreviewObject = previewObject
      dragPreviewAssetId = asset.id
      group.add(previewObject)

      if (lastDragPoint) {
        group.position.copy(lastDragPoint)
        group.visible = true
      } else {
        group.visible = false
      }

      pendingPreviewAssetId = null
      return true
    } catch (error) {
      if (token === dragPreviewLoadToken) {
        clearObject(true)
      }
      pendingPreviewAssetId = null
      console.warn('Failed to load drag preview object', error)
      return false
    }
  }

  const loadForPrefab = async (asset: ProjectAsset): Promise<boolean> => {
    if (pendingPreviewAssetId === asset.id) {
      return false
    }

    pendingPreviewAssetId = asset.id
    clearObject(true)
    const token = ++dragPreviewLoadToken

    try {
      let file = options.assetCacheStore.createFileFromCache(asset.id)
      if (!file) {
        await options.assetCacheStore.loadFromIndexedDb(asset.id)
        file = options.assetCacheStore.createFileFromCache(asset.id)
      }
      if (!file) {
        pendingPreviewAssetId = null
        return false
      }

      // Build (or reuse) a fully post-processed prefab preview root.
      const handle = await acquirePrefabPreviewRoot({
        assetId: asset.id,
        file,
        assetCacheStore: options.assetCacheStore,
        cacheOnly: true,
      })

      if (token !== dragPreviewLoadToken) {
        handle.release()
        return false
      }

      const root = handle.root

      root.position.set(0, 0, 0)
      applyPreviewVisualTweaks(root)
      dragPreviewObject = root
      dragPreviewAssetId = asset.id
      activePrefabHandle = handle
      group.add(root)
      setDragPreviewReady(asset.id, true)

      if (lastDragPoint) {
        group.position.copy(lastDragPoint)
        group.visible = true
      } else {
        group.visible = false
      }

      pendingPreviewAssetId = null
      return true
    } catch (error) {
      if (token === dragPreviewLoadToken) {
        clearObject(true)
      }
      pendingPreviewAssetId = null
      console.warn('Failed to load prefab drag preview object', error)
      return false
    }
  }

  const prepare = (assetId: string) => {
    const asset = findAssetMetadata(assetId, options.getProjectTree())
    if (!asset || (asset.type !== 'model' && asset.type !== 'mesh' && asset.type !== 'prefab')) {
      dispose(true)
      return
    }

    if (dragPreviewAssetId === asset.id && dragPreviewObject) {
      if (lastDragPoint) {
        group.position.copy(lastDragPoint)
        group.visible = true
      }
      return
    }

    if (pendingPreviewAssetId === asset.id) {
      return
    }

    if (asset.type === 'prefab') {
      void loadForPrefab(asset)
    } else {
      void loadForAsset(asset)
    }
  }

  return {
    group,
    getLastPoint,
    setPosition,
    prepare,
    dispose,
  }
}
