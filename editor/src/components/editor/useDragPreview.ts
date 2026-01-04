import * as THREE from 'three'

import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'

import { loadObjectFromFile } from '@schema/assetImport'
import ResourceCache from '@schema/ResourceCache'
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph'
import { getCachedModelObject, getOrLoadModelObject } from '@schema/modelObjectCache'

import { parsePrefabFile } from '@/utils/prefabDocument'
import { StoreBackedAssetCache } from '@/utils/storeBackedAssetCache'
import { CacheOnlyAssetLoader } from '@/utils/cacheOnlyAssetLoader'
import { setDragPreviewReady } from '@/utils/dragPreviewRegistry'
import { collectPrefabAssetReferences } from '@/stores/sceneStore'

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
  object.traverse((child) => {
    const meshChild = child as THREE.Mesh
    if (meshChild?.isMesh) {
      const materials = Array.isArray(meshChild.material) ? meshChild.material : [meshChild.material]
      for (const material of materials) {
        if (!material) {
          continue
        }
        material.transparent = true
        material.opacity = Math.min(0.75, material.opacity ?? 1)
        material.depthWrite = false
      }
    }
  })
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

  const clearObject = (disposeResources = true) => {
    if (dragPreviewAssetId) {
      setDragPreviewReady(dragPreviewAssetId, false)
    }
    if (dragPreviewObject && disposeResources) {
      options.disposeObjectResources(dragPreviewObject)
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

  const ensureAssetsCachedLocally = async (assetIds: string[]): Promise<boolean> => {
    if (!assetIds.length) {
      return true
    }
    const missing = assetIds.filter((id) => id && !options.assetCacheStore.hasCache(id))
    if (missing.length) {
      await Promise.all(missing.map((id) => options.assetCacheStore.loadFromIndexedDb(id)))
    }
    return assetIds.every((id) => !id || options.assetCacheStore.hasCache(id))
  }

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
        baseGroup = await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file))
        options.assetCacheStore.releaseInMemoryBlob(asset.id)
      }

      if (token !== dragPreviewLoadToken) {
        options.disposeObjectResources(baseGroup.object)
        return false
      }

      applyPreviewVisualTweaks(baseGroup.object)
      dragPreviewObject = baseGroup.object
      dragPreviewAssetId = asset.id
      group.add(baseGroup.object)

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

      const document = await parsePrefabFile(file)
      const rootNode = document.nodes?.[0] ?? null
      const dependencyAssetIds = collectPrefabAssetReferences(rootNode)

      const allCached = await ensureAssetsCachedLocally(dependencyAssetIds)
      if (!allCached) {
        pendingPreviewAssetId = null
        return false
      }

      const buildOptions: SceneGraphBuildOptions = {
        enableGround: true,
        lazyLoadMeshes: false,
      }

      const assetLoader = new CacheOnlyAssetLoader(new StoreBackedAssetCache(options.assetCacheStore as any))
      const resourceCache = new ResourceCache(document, buildOptions, assetLoader, {
        warn: (message: string) => console.warn('[DragPreview:Prefab] resource warning:', message),
        reportDownloadProgress: undefined,
      })

      const { root } = await buildSceneGraph(document, resourceCache, buildOptions)

      if (token !== dragPreviewLoadToken) {
        options.disposeObjectResources(root)
        return false
      }

      root.position.set(0, 0, 0)
      applyPreviewVisualTweaks(root)
      dragPreviewObject = root
      dragPreviewAssetId = asset.id
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
