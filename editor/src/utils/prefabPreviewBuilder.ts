import * as THREE from 'three'
import { AssetLoader } from '@schema/assetCache'
import ResourceCache from '@schema/ResourceCache'
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph'
import type { ProjectAsset } from '@/types/project-asset'
import { ASSET_THUMBNAIL_HEIGHT, ASSET_THUMBNAIL_WIDTH, createThumbnailFromCanvas } from '@/utils/assetThumbnail'
import { normalizePrefabSceneDocument } from '@/utils/prefabDocument'
import { collectPrefabAssetReferences } from '@/stores/prefabActions'
import { CacheOnlyAssetLoader } from '@/utils/cacheOnlyAssetLoader'
import { StoreBackedAssetCache } from '@/utils/storeBackedAssetCache'
import type { SceneNode } from '@schema'
import type { AssetCacheEntry } from '@schema/assetCache'
import {
  clampSceneNodeInstanceLayout,
  getInstanceLayoutCount,
  resolveInstanceLayoutTemplateAssetId,
  buildInstanceLayoutLocalMatrices,
} from '@schema/instanceLayout'
import { getCachedModelObject } from '@schema/modelObjectCache'
import { hashString } from '@schema/stableSerialize'
import { PinnedLruCache, cloneObject3DShared } from '@/utils/prefabPreviewCache'
import { readServerDownloadBaseUrl } from '@/api/serverApiConfig'
import {
  buildFloorPreviewObjectFromNode,
  buildWallPreviewObjectFromNode,
  createPreviewMaterialOverrideOptions,
} from '@/utils/wallFloorPreviewBuilder'

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

function collectWallFloorPreviewNodes(root: SceneNode | null | undefined): SceneNode[] {
  const nodes: SceneNode[] = []
  const stack: SceneNode[] = root ? [root] : []
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.dynamicMesh?.type === 'Wall' || node.dynamicMesh?.type === 'Floor') {
      nodes.push(node)
    }
    if (Array.isArray(node.children) && node.children.length) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]
        if (child) {
          stack.push(child)
        }
      }
    }
  }
  return nodes
}

function findNodeRootObject(root: THREE.Object3D, nodeId: string): THREE.Object3D | null {
  let matched: THREE.Object3D | null = null
  root.traverse((object) => {
    if (matched) {
      return
    }
    const currentNodeId = (object as any).userData?.nodeId as string | undefined
    if (currentNodeId !== nodeId) {
      return
    }
    const parentNodeId = (object.parent as any)?.userData?.nodeId as string | undefined
    if (parentNodeId === nodeId) {
      return
    }
    matched = object
  })
  return matched
}

function extractChildNodeRoots(nodeObject: THREE.Object3D, nodeId: string): THREE.Object3D[] {
  const childNodeRoots: THREE.Object3D[] = []
  for (const child of [...nodeObject.children]) {
    const childNodeId = (child as any).userData?.nodeId as string | undefined
    if (!childNodeId || childNodeId === nodeId) {
      continue
    }
    nodeObject.remove(child)
    childNodeRoots.push(child)
  }
  return childNodeRoots
}

function replaceNodeRootObject(root: THREE.Object3D, currentObject: THREE.Object3D, replacement: THREE.Object3D): THREE.Object3D {
  const currentNodeId = (currentObject as any).userData?.nodeId as string | undefined
  const childNodeRoots = currentNodeId ? extractChildNodeRoots(currentObject, currentNodeId) : []
  childNodeRoots.forEach((child) => replacement.add(child))

  const parent = currentObject.parent
  if (!parent) {
    return replacement
  }

  const index = parent.children.indexOf(currentObject)
  parent.remove(currentObject)
  parent.add(replacement)
  const insertedIndex = parent.children.indexOf(replacement)
  if (index >= 0 && insertedIndex >= 0 && insertedIndex !== index) {
    parent.children.splice(insertedIndex, 1)
    parent.children.splice(index, 0, replacement)
  }
  return root
}

function createFileFromAssetEntry(assetId: string, entry: AssetCacheEntry | null): File | null {
  if (!entry?.blob) {
    return null
  }
  const fileName = typeof entry.filename === 'string' && entry.filename.trim().length ? entry.filename.trim() : assetId
  const mimeType = entry.mimeType ?? entry.blob.type ?? 'application/octet-stream'
  try {
    return new File([entry.blob], fileName, { type: mimeType })
  } catch (_error) {
    return null
  }
}

async function upgradeWallFloorPreviewNodes(options: {
  root: THREE.Object3D
  rootNode: SceneNode | null
  resourceCache: ResourceCache
}): Promise<THREE.Object3D> {
  const previewNodes = collectWallFloorPreviewNodes(options.rootNode)
  if (!previewNodes.length) {
    return options.root
  }

  const resolveAssetFile = async (assetId: string): Promise<File | null> => {
    const entry = await options.resourceCache.acquireAssetEntry(assetId)
    return createFileFromAssetEntry(assetId, entry)
  }
  const materialOverrideOptions = createPreviewMaterialOverrideOptions(resolveAssetFile, (message) => {
    if (message) {
      console.warn('[PrefabPreviewBuilder] material warning:', message)
    }
  })

  let nextRoot = options.root
  for (const node of previewNodes) {
    const currentObject = findNodeRootObject(nextRoot, node.id)
    if (!currentObject) {
      continue
    }

    const replacement = node.dynamicMesh?.type === 'Wall'
      ? await buildWallPreviewObjectFromNode({
          node,
          resolveAssetFile,
          materialOverrideOptions,
        })
      : await buildFloorPreviewObjectFromNode({
          node,
          materialOverrideOptions,
        })

    if (!replacement) {
      continue
    }
    nextRoot = replaceNodeRootObject(nextRoot, currentObject, replacement)
  }

  return nextRoot
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
    lazyLoadMeshes: false,
    serverAssetBaseUrl: readServerDownloadBaseUrl(),
  }

  const assetLoader = createAssetLoader(assetCacheStore, cacheOnly)
  const resourceCache = new ResourceCache(document, buildOptions, assetLoader, {
    warn: (message: string) => console.warn('[PrefabPreviewBuilder] resource warning:', message),
    reportDownloadProgress: undefined,
  })

  const nodeIndex = buildNodeIndex(rootNode)
  const built = await buildSceneGraph(document, resourceCache, buildOptions)
  const upgradedRoot = await upgradeWallFloorPreviewNodes({
    root: built.root,
    rootNode,
    resourceCache,
  })

  // Apply preview-only post-processing for instance layouts after wall/floor replacement.
  applyInstanceLayoutPreview(upgradedRoot, nodeIndex)

  return { key, assetId, baseRoot: upgradedRoot }
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

function fitPreviewCamera(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(3, 3, 3)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    return
  }

  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = maxDim === 0 ? 5 : maxDim / (2 * Math.tan(fov / 2))
  const offset = distance * 1.4

  camera.position.set(center.x + offset, center.y + offset, center.z + offset)
  camera.near = Math.max(0.1, distance / 100)
  camera.far = Math.max(distance * 100, 100)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read prefab thumbnail data'))
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Failed to read prefab thumbnail data'))
    }
    reader.readAsDataURL(blob)
  })
}

export async function renderPrefabThumbnailDataUrl(options: {
  asset: ProjectAsset
  assetId: string
  file: File
  assetCacheStore: AssetCacheStoreLike
  width?: number
  height?: number
  cacheOnly?: boolean
}): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('Prefab thumbnail rendering requires a browser environment')
  }

  const width = Math.max(1, Math.round(options.width ?? ASSET_THUMBNAIL_WIDTH))
  const height = Math.max(1, Math.round(options.height ?? ASSET_THUMBNAIL_HEIGHT))
  const handle = await acquirePrefabPreviewRoot({
    assetId: options.assetId,
    file: options.file,
    assetCacheStore: options.assetCacheStore,
    cacheOnly: options.cacheOnly,
  })

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.setClearColor(0x000000, 0)
  renderer.setSize(Math.max(width * 2, 384), Math.max(height * 2, 192), false)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, renderer.domElement.width / Math.max(renderer.domElement.height, 1), 0.1, 1000)
  const ambient = new THREE.AmbientLight(0xffffff, 1.5)
  const directional = new THREE.DirectionalLight(0xffffff, 2.0)
  directional.position.set(5, 10, 7.5)
  const fillLight = new THREE.DirectionalLight(0xffffff, 1.0)
  fillLight.position.set(-5, 2, -6)

  scene.add(ambient)
  scene.add(directional)
  scene.add(fillLight)
  scene.add(handle.root)

  try {
    fitPreviewCamera(camera, handle.root)
    renderer.render(scene, camera)
    const thumbnailFile = await createThumbnailFromCanvas(options.asset, renderer.domElement, { width, height })
    return await readBlobAsDataUrl(thumbnailFile)
  } finally {
    scene.remove(handle.root)
    handle.release()
    renderer.dispose()
  }
}
