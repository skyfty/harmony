import * as THREE from 'three'
import { AssetLoader } from '@schema/assetCache'
import ResourceCache from '@schema/ResourceCache'
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph'
import { normalizePrefabSceneDocument } from '@/utils/prefabDocument'
import { collectPrefabAssetReferences } from '@/stores/prefabActions'
import { CacheOnlyAssetLoader } from '@/utils/cacheOnlyAssetLoader'
import { StoreBackedAssetCache } from '@/utils/storeBackedAssetCache'
import type { SceneNode } from '@harmony/schema'
import {
  clampSceneNodeInstanceLayout,
  getInstanceLayoutCount,
  resolveInstanceLayoutTemplateAssetId,
  buildInstanceLayoutLocalMatrices,
} from '@schema/instanceLayout'
import { getCachedModelObject } from '@schema/modelObjectCache'
import { hashString } from '@schema/stableSerialize'
import { PinnedLruCache, cloneObject3DShared } from '@/utils/prefabPreviewCache'

type AssetCacheStoreLike = {
  hasCache: (assetId: string) => boolean
  loadFromIndexedDb: (assetId: string) => Promise<unknown>
  createFileFromCache: (assetId: string) => File | null
  releaseInMemoryBlob: (assetId: string) => void
}

type PrefabPreviewOptions = {
  assetId: string
  file: File
  assetCacheStore: AssetCacheStoreLike
  cacheOnly?: boolean
}

export type PrefabPreviewHandle = {
  key: string
  root: THREE.Object3D
  release: () => void
}

type CacheEntry = {
  key: string
  assetId: string
  baseRoot: THREE.Object3D
}

const DEFAULT_PREFAB_PREVIEW_CACHE_SIZE = 8

const prefabRootCache = new PinnedLruCache<string, CacheEntry>({ maxEntries: DEFAULT_PREFAB_PREVIEW_CACHE_SIZE })
const prefabInFlight = new Map<string, Promise<CacheEntry>>()

function buildNodeIndex(root: SceneNode | null | undefined): Map<string, SceneNode> {
  const index = new Map<string, SceneNode>()
  const stack: SceneNode[] = root ? [root] : []
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (typeof node.id === 'string' && node.id) {
      index.set(node.id, node)
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return index
}

const INSTANCE_LAYOUT_INTERNAL_NAME_PARTS = ['PickProxy', 'Outline', 'InstancedOutline']

function isInternalViewportObjectName(name: unknown): boolean {
  if (typeof name !== 'string') {
    return false
  }
  return INSTANCE_LAYOUT_INTERNAL_NAME_PARTS.some((part) => name.includes(part))
}

function findFirstRenderableMeshChild(root: THREE.Object3D): THREE.Mesh | null {
  const stack = [...root.children]
  while (stack.length) {
    const child = stack.pop()
    if (!child) {
      continue
    }
    if (isInternalViewportObjectName(child.name)) {
      continue
    }
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      return mesh
    }
    if (child.children?.length) {
      stack.push(...child.children)
    }
  }
  return null
}

type TemplateSubmesh = {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  meshLocalToTemplateRoot: THREE.Matrix4
}

function extractTemplateSubmeshes(templateRoot: THREE.Object3D): TemplateSubmesh[] {
  templateRoot.updateMatrixWorld(true)
  const inverseRootWorld = new THREE.Matrix4().copy(templateRoot.matrixWorld).invert()

  const submeshes: TemplateSubmesh[] = []
  templateRoot.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) {
      return
    }
    if (isInternalViewportObjectName(mesh.name)) {
      return
    }
    const meshLocalToTemplateRoot = new THREE.Matrix4().multiplyMatrices(inverseRootWorld, mesh.matrixWorld)
    submeshes.push({ geometry: mesh.geometry, material: mesh.material, meshLocalToTemplateRoot })
  })
  return submeshes
}

function extractTemplateSubmeshesForNodeObject(nodeObject: THREE.Object3D, nodeId: string): TemplateSubmesh[] {
  nodeObject.updateMatrixWorld(true)
  const inverseRootWorld = new THREE.Matrix4().copy(nodeObject.matrixWorld).invert()

  const submeshes: TemplateSubmesh[] = []
  const stack: THREE.Object3D[] = [nodeObject]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    const currentNodeId = (current as any).userData?.nodeId as string | undefined
    if (currentNodeId && currentNodeId !== nodeId) {
      continue
    }
    const mesh = current as THREE.Mesh
    if (mesh.isMesh && !isInternalViewportObjectName(mesh.name)) {
      const meshLocalToTemplateRoot = new THREE.Matrix4().multiplyMatrices(inverseRootWorld, mesh.matrixWorld)
      submeshes.push({ geometry: mesh.geometry, material: mesh.material, meshLocalToTemplateRoot })
    }
    if (current.children?.length) {
      stack.push(...current.children)
    }
  }
  return submeshes
}

function hideRenderableMeshesForNodeObject(nodeObject: THREE.Object3D, nodeId: string): void {
  const stack: THREE.Object3D[] = [nodeObject]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    const currentNodeId = (current as any).userData?.nodeId as string | undefined
    if (currentNodeId && currentNodeId !== nodeId) {
      continue
    }
    const mesh = current as THREE.Mesh
    if (mesh.isMesh && !isInternalViewportObjectName(mesh.name)) {
      mesh.visible = false
    }
    if (current.children?.length) {
      stack.push(...current.children)
    }
  }
}

async function ensureAssetsCachedLocally(assetCacheStore: AssetCacheStoreLike, assetIds: string[]): Promise<boolean> {
  if (!assetIds.length) {
    return true
  }
  const missing = assetIds.filter((id) => id && !assetCacheStore.hasCache(id))
  if (missing.length) {
    await Promise.all(missing.map((id) => assetCacheStore.loadFromIndexedDb(id)))
  }
  return assetIds.every((id) => !id || assetCacheStore.hasCache(id))
}

function createAssetLoader(assetCacheStore: AssetCacheStoreLike, cacheOnly: boolean): AssetLoader {
  const cache = new StoreBackedAssetCache(assetCacheStore as any)
  return cacheOnly ? new CacheOnlyAssetLoader(cache) : new AssetLoader(cache)
}

function applyInstanceLayoutPreview(root: THREE.Object3D, nodeIndex: Map<string, SceneNode>): void {
  const instancedGroupName = '__harmonyPreviewInstanceLayout'

  root.updateMatrixWorld(true)

  const instanceMatrix = new THREE.Matrix4()
  const composed = new THREE.Matrix4()

  root.traverse((object) => {
    const nodeId = (object as any).userData?.nodeId as string | undefined
    if (!nodeId) {
      return
    }
    const node = nodeIndex.get(nodeId)
    if (!node) {
      return
    }

    const layout = clampSceneNodeInstanceLayout((node as any).instanceLayout ?? null)
    if (!layout || layout.mode !== 'grid') {
      return
    }

    const templateAssetId = resolveInstanceLayoutTemplateAssetId(layout, (node as any).sourceAssetId ?? null)
    if (!templateAssetId) {
      return
    }

    // Prefer the node's own rendered object as template when it matches.
    const sourceAssetId = typeof (node as any).sourceAssetId === 'string' ? (node as any).sourceAssetId : null
    const templateGroup = getCachedModelObject(templateAssetId)
    const templateBounds = templateGroup?.boundingBox ?? null
    const templateRoot = templateAssetId === sourceAssetId ? object : templateGroup?.object
    if (!templateRoot) {
      return
    }

    const existingGroup = object.getObjectByName(instancedGroupName)
    if (existingGroup) {
      return
    }

    const templateSubmeshes = templateAssetId === sourceAssetId
      ? extractTemplateSubmeshesForNodeObject(object, nodeId)
      : extractTemplateSubmeshes(templateRoot)
    if (!templateSubmeshes.length) {
      return
    }

    const count = getInstanceLayoutCount(layout)
    const locals = buildInstanceLayoutLocalMatrices(layout, templateBounds ?? null).localMatrices
    const fallbackLocal = locals[0] ?? new THREE.Matrix4()

    // Hide original single-instance meshes.
    // When we instance the node's own model, hide all meshes in that node subtree (excluding child nodes).
    if (templateAssetId === sourceAssetId) {
      hideRenderableMeshesForNodeObject(object, nodeId)
    } else {
      // Fallback: hide the first mesh only to avoid hiding child node visuals.
      const hiddenMesh = findFirstRenderableMeshChild(object)
      if (hiddenMesh) {
        ;(object as any).userData.__harmonyPreviewInstanceLayoutHiddenMeshWasVisible = hiddenMesh.visible
        hiddenMesh.visible = false
      }
    }

    const instancedGroup = new THREE.Group()
    instancedGroup.name = instancedGroupName
    instancedGroup.matrixAutoUpdate = false
    instancedGroup.matrix.identity()

    for (const sub of templateSubmeshes) {
      const instanced = new THREE.InstancedMesh(sub.geometry, sub.material, count)
      instanced.frustumCulled = false
      instanced.matrixAutoUpdate = false
      instanced.matrix.identity()

      for (let i = 0; i < count; i += 1) {
        const local = locals[i] ?? fallbackLocal
        instanceMatrix.copy(local)
        composed.multiplyMatrices(instanceMatrix, sub.meshLocalToTemplateRoot)
        instanced.setMatrixAt(i, composed)
      }
      instanced.instanceMatrix.needsUpdate = true

      instancedGroup.add(instanced)
    }

    object.add(instancedGroup)
  })
}

async function buildPrefabPreviewBaseRoot(options: PrefabPreviewOptions, fileText: string): Promise<CacheEntry> {
  const { assetId, assetCacheStore } = options
  const cacheOnly = options.cacheOnly ?? false

  const fileHash = hashString(fileText)
  const key = `${assetId}:${fileHash}`

  const parsed = JSON.parse(fileText) as unknown
  const document = normalizePrefabSceneDocument(parsed)
  const rootNode = document.nodes?.[0] ?? null

  if (cacheOnly) {
    const dependencyAssetIds = collectPrefabAssetReferences(rootNode)
    const allCached = await ensureAssetsCachedLocally(assetCacheStore, dependencyAssetIds)
    if (!allCached) {
      throw new Error('Prefab dependencies are not cached')
    }
  }

  const buildOptions: SceneGraphBuildOptions = {
    enableGround: true,
    lazyLoadMeshes: false,
  }

  const assetLoader = createAssetLoader(assetCacheStore, cacheOnly)
  const resourceCache = new ResourceCache(document, buildOptions, assetLoader, {
    warn: (message: string) => console.warn('[PrefabPreviewBuilder] resource warning:', message),
    reportDownloadProgress: undefined,
  })

  const { root } = await buildSceneGraph(document, resourceCache, buildOptions)

  // Apply preview-only post-processing for instance layouts.
  const nodeIndex = buildNodeIndex(rootNode)
  applyInstanceLayoutPreview(root, nodeIndex)

  return { key, assetId, baseRoot: root }
}

export async function acquirePrefabPreviewRoot(options: PrefabPreviewOptions): Promise<PrefabPreviewHandle> {
  const fileText = await options.file.text()
  const fileHash = hashString(fileText)
  const key = `${options.assetId}:${fileHash}`

  const cached = prefabRootCache.getPinned(key)
  if (cached) {
    const clone = cloneObject3DShared(cached.value.baseRoot)
    return { key, root: clone, release: cached.release }
  }

  const inFlight = prefabInFlight.get(key)
  if (inFlight) {
    const entry = await inFlight
    const pinned = prefabRootCache.getPinned(entry.key)
    if (!pinned) {
      // Should not happen; fallback to direct clone.
      const clone = cloneObject3DShared(entry.baseRoot)
      return { key: entry.key, root: clone, release: () => {} }
    }
    const clone = cloneObject3DShared(pinned.value.baseRoot)
    return { key: entry.key, root: clone, release: pinned.release }
  }

  const promise = buildPrefabPreviewBaseRoot(options, fileText)
    .then((entry) => {
      prefabRootCache.set(entry.key, entry)
      prefabInFlight.delete(entry.key)
      return entry
    })
    .catch((error) => {
      prefabInFlight.delete(key)
      throw error
    })

  prefabInFlight.set(key, promise)
  const entry = await promise
  const pinned = prefabRootCache.getPinned(entry.key)
  if (!pinned) {
    const clone = cloneObject3DShared(entry.baseRoot)
    return { key: entry.key, root: clone, release: () => {} }
  }
  const clone = cloneObject3DShared(pinned.value.baseRoot)
  return { key: entry.key, root: clone, release: pinned.release }
}
