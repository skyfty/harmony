<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import {
  useSceneStore,
  extractProviderIdFromPackageDirectoryId,
  GROUND_NODE_ID,
  ENVIRONMENT_NODE_ID,
} from '@/stores/sceneStore'
import { useUiStore } from '@/stores/uiStore'
import { useBuildToolsStore } from '@/stores/buildToolsStore'
import { isFloorPresetFilename } from '@/utils/floorPreset'
import { isWallPresetFilename } from '@/utils/wallPreset'
import { PACKAGES_ROOT_DIRECTORY_ID, determineAssetCategoryId } from '@/stores/assetCatalog'
import type { ResourceCategory } from '@/types/resource-category'
import { fetchResourceCategories } from '@/api/resourceAssets'
import { isAssetTypeName, isRootCategoryName } from '@/utils/categoryPath'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { resourceProviders } from '@/resources/projectProviders'
import { assetProvider } from '@/resources/projectProviders/asset'
import { loadProviderCatalog, storeProviderCatalog } from '@/stores/providerCatalogCache'
import { getCachedModelObject } from '@schema/modelObjectCache'
import { dataUrlToBlob, extractExtension } from '@/utils/blob'
import type { SceneNode } from '@harmony/schema'
import { getExtensionFromMimeType, inferAssetType } from '@harmony/schema'
import { PROTAGONIST_COMPONENT_TYPE } from '@schema/components'
import type { SceneMaterialTextureRef } from '@/types/material'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import { isDragPreviewReady } from '@/utils/dragPreviewRegistry'

import UploadAssetsDialog from './UploadAssetsDialog.vue'
import AssetFilterControl from './AssetFilterControl.vue'
import type {
  SeriesFilterOption,
  SizeCategoryFilterOption,
  TagFilterOption,
} from '@/types/asset-filter'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

const PRESET_PROVIDER_ID = assetProvider.id
const galleryRoot = ref<HTMLElement | null>(null)
const galleryHovered = ref(false)

const {
  projectTree,
  activeDirectoryId,
  currentAssets,
  selectedAssetId,
  currentDirectory,
  projectPanelTreeSize,
  draggingAssetId,
  assetIndex,
  selectedNodeId,
} = storeToRefs(sceneStore)

const openedDirectories = ref<string[]>(restoreOpenedDirectories())
watch(openedDirectories, (ids, previousIds) => {
  const sanitized = sanitizeOpenedDirectories(ids, projectTree.value)
  if (!arraysEqual(sanitized, ids)) {
    openedDirectories.value = sanitized
    return
  }
  persistOpenedDirectories(sanitized)
  triggerProviderLoadForOpenedDirectories(sanitized, previousIds)
})
watch(projectTree, () => {
  const sanitized = sanitizeOpenedDirectories(openedDirectories.value, projectTree.value)
  if (!arraysEqual(sanitized, openedDirectories.value)) {
    openedDirectories.value = sanitized
    return
  }
  triggerProviderLoadForOpenedDirectories(sanitized)
})

const NODE_DRAG_MIME = 'application/x-harmony-node'
let dragPreviewEl: HTMLDivElement | null = null
let dragImageOffset: { x: number; y: number } | null = null
let dragSuppressionPreparedAssetId: string | null = null
let dragSuppressionPreparedAssetType: ProjectAsset['type'] | null = null
let dragSuppressionActive = false
let dragSuppressionSourceAssetId: string | null = null

let windowDragOverListener: ((event: DragEvent) => void) | null = null
let windowDropListener: ((event: DragEvent) => void) | null = null
let hiddenDragImageEl: HTMLDivElement | null = null
let windowPasteListener: ((event: ClipboardEvent) => void) | null = null
const addPendingAssetId = ref<string | null>(null)
const deleteDialogOpen = ref(false)
const pendingDeleteAssets = ref<ProjectAsset[]>([])
const isBatchDeletion = ref(false)
const selectedAssetIds = ref<string[]>([])
const dropActive = ref(false)
const dropProcessing = ref(false)
const dropDragDepth = ref(0)
let dropFeedbackTimer: number | null = null
const uploadDialogOpen = ref(false)

const providerLoadingState = ref<Record<string, boolean>>({})
const providerErrorState = ref<Record<string, string | null>>({})

function isProviderLoading(providerId: string): boolean {
  return !!providerLoadingState.value[providerId]
}
function setProviderLoading(providerId: string, value: boolean): void {
  providerLoadingState.value = { ...providerLoadingState.value, [providerId]: value }
}
function getProviderError(providerId: string): string | null {
  return providerErrorState.value[providerId] ?? null
}
function setProviderError(providerId: string, message: string | null): void {
  providerErrorState.value = { ...providerErrorState.value, [providerId]: message }
}

function findProviderIdForDirectoryId(directoryId: string | null): string | null {
  if (!directoryId) return null
  return extractProviderIdFromPackageDirectoryId(directoryId)
}

async function loadPackageDirectory(providerId: string, options: { force?: boolean } = {}) {
  const force = options.force ?? false
  if (isProviderLoading(providerId)) {
    return
  }
  const provider = resourceProviders.find((entry) => entry.id === providerId)
  if (!provider) {
    return
  }
  if (!force && sceneStore.isPackageLoaded(providerId)) {
    return
  }

  if (!force) {
    const cachedDirectories = await loadProviderCatalog(providerId)
    if (cachedDirectories) {
      sceneStore.setPackageDirectories(providerId, cachedDirectories)
      setProviderError(providerId, null)
      return
    }
  }

  if (typeof provider.load === 'function') {
    setProviderLoading(providerId, true)
    setProviderError(providerId, null)
    try {
      const directories = await provider.load()
      sceneStore.setPackageDirectories(providerId, directories)
      setProviderError(providerId, null)
      await storeProviderCatalog(providerId, directories)
    } catch (error) {
      setProviderError(providerId, (error as Error).message ?? 'Failed to load resources')
    } finally {
      setProviderLoading(providerId, false)
    }
    return
  }

  if (!provider.url) {
    sceneStore.setPackageDirectories(providerId, [])
    setProviderError(providerId, null)
    await storeProviderCatalog(providerId, [])
    return
  }
  setProviderLoading(providerId, true)
  setProviderError(providerId, null)
  try {
    const response = await fetch(provider.url)
    if (!response.ok) {
      throw new Error(`Failed to load resources (${response.status})`)
    }
    const payload = await response.json()
    const directories = provider.transform ? provider.transform(payload) : []
    sceneStore.setPackageDirectories(providerId, directories)
    setProviderError(providerId, null)
    await storeProviderCatalog(providerId, directories)
  } catch (error) {
    setProviderError(providerId, (error as Error).message ?? 'Failed to load resources')
  } finally {
    setProviderLoading(providerId, false)
  }
}

const presetRefreshPending = ref(false)

async function refreshPresetProviderAssets(): Promise<void> {
  if (!PRESET_PROVIDER_ID) {
    return
  }
  if (presetRefreshPending.value) {
    return
  }
  presetRefreshPending.value = true
  try {
    await loadPackageDirectory(PRESET_PROVIDER_ID, { force: true })
  } catch (error) {
    console.error('Failed to refresh preset assets', error)
  } finally {
    presetRefreshPending.value = false
  }
}

const OPENED_DIRECTORIES_STORAGE_KEY = 'harmony:project-panel:opened-directories'
function restoreOpenedDirectories(): string[] {
  if (typeof window === 'undefined') {
    return [PACKAGES_ROOT_DIRECTORY_ID]
  }
  try {
    const stored = window.localStorage.getItem(OPENED_DIRECTORIES_STORAGE_KEY)
    if (!stored) {
      return [PACKAGES_ROOT_DIRECTORY_ID]
    }
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) {
      return [PACKAGES_ROOT_DIRECTORY_ID]
    }
    const filtered = parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
    return filtered.length ? Array.from(new Set(filtered)) : [PACKAGES_ROOT_DIRECTORY_ID]
  } catch (error) {
    console.warn('Failed to restore ProjectPanel opened directories', error)
    return [PACKAGES_ROOT_DIRECTORY_ID]
  }
}

function persistOpenedDirectories(ids: string[]): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const uniqueIds = Array.from(new Set(ids))
    window.localStorage.setItem(OPENED_DIRECTORIES_STORAGE_KEY, JSON.stringify(uniqueIds))
  } catch (error) {
    console.warn('Failed to persist ProjectPanel opened directories', error)
  }
}

function triggerProviderLoadForOpenedDirectories(ids: string[], previousIds?: string[]): void {
  if (!ids.length) {
    return
  }
  const previousSet = new Set(previousIds ?? [])
  ids.forEach((id) => {
    const providerId = extractProviderIdFromPackageDirectoryId(id)
    if (!providerId) {
      return
    }
    if (!previousSet.has(id) || !sceneStore.isPackageLoaded(providerId)) {
      void loadPackageDirectory(providerId)
    }
  })
}

function collectDirectoryIds(directories: ProjectDirectory[] | undefined, bucket: Set<string>): void {
  if (!directories?.length) {
    return
  }
  directories.forEach((directory) => {
    bucket.add(directory.id)
    if (directory.children?.length) {
      collectDirectoryIds(directory.children, bucket)
    }
  })
}

function sanitizeOpenedDirectories(
  ids: string[],
  tree: ProjectDirectory[] | undefined,
): string[] {
  if (!tree?.length) {
    return [...new Set(ids)]
  }
  const available = new Set<string>()
  collectDirectoryIds(tree, available)
  return ids.filter((id, index) => available.has(id) && ids.indexOf(id) === index)
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a === b) {
    return true
  }
  if (a.length !== b.length) {
    return false
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }
  return true
}

function countDirectoryAssets(directory: ProjectDirectory | undefined): number {
  if (!directory) {
    return 0
  }
  const directCount = directory.assets?.length ?? 0
  if (!directory.children?.length) {
    return directCount
  }
  return directory.children.reduce((total, child) => total + countDirectoryAssets(child), directCount)
}

const activeProviderId = computed(() => findProviderIdForDirectoryId(activeDirectoryId.value ?? null))
const activeProviderError = computed(() => (activeProviderId.value ? getProviderError(activeProviderId.value) : null))
const activeProviderLoading = computed(() => (activeProviderId.value ? isProviderLoading(activeProviderId.value) : false))

const treePaneSize = computed(() => Math.min(Math.max(projectPanelTreeSize.value, 0), 100))
const galleryPaneSize = computed(() => Math.max(Math.round((100 - treePaneSize.value) * 100) / 100, 0))

interface SplitpanesPaneInfo {
  size: number
}

interface SplitpanesResizedEvent {
  panes: SplitpanesPaneInfo[]
}

function handleProjectSplitResized(event: SplitpanesResizedEvent) {
  const nextSize = event?.panes?.[0]?.size
  if (typeof nextSize !== 'number' || !Number.isFinite(nextSize)) {
    return
  }
  sceneStore.setProjectPanelTreeSize(nextSize)
}

async function selectAsset(asset: ProjectAsset) {
  const uiStore = useUiStore()
  const buildToolsStore = useBuildToolsStore()
  // For model-like assets, ensure the asset is downloaded/cached before selecting
  if (MODEL_ASSET_TYPES.has(asset.type)) {
    const prepared = prepareAssetForOperations(asset)
    try {
      assetCacheStore.setError(prepared.id, null)
      await ensureAssetCached(prepared)
    } catch (error) {
      const message = (error as Error).message ?? 'Failed to load asset'
      assetCacheStore.setError(prepared.id, message)
      console.error('Failed to cache asset before select', error)
      return
    }
    sceneStore.selectAsset(prepared.id)
    uiStore.setActiveSelectionContext('asset-panel')
    return
  }

  // If a wall/floor prefab preset is selected, immediately activate the corresponding
  // build tool and apply the preset. This intentionally switches context from asset-panel
  // to build-tool so the user can edit directly in the viewport.
  if (asset.type === 'prefab') {
    const extension = typeof asset.extension === 'string' ? asset.extension.trim().toLowerCase() : ''
    const filename = asset.description ?? asset.name
    const isWallPreset = extension === 'wall' || isWallPresetFilename(filename)
    const isFloorPreset = extension === 'floor' || isFloorPresetFilename(filename)
    if (isWallPreset || isFloorPreset) {
      sceneStore.selectAsset(asset.id)
      sceneStore.setSelection([])

      const activated = isWallPreset
        ? buildToolsStore.setWallBrushPresetAssetId(asset.id, { activate: true })
        : buildToolsStore.setFloorBrushPresetAssetId(asset.id, { activate: true })

      if (activated) {
        uiStore.setActiveSelectionContext(`build-tool:${isWallPreset ? 'wall' : 'floor'}`)
      } else {
        uiStore.setActiveSelectionContext('asset-panel')
      }
      return
    }
  }

  sceneStore.selectAsset(asset.id)
  uiStore.setActiveSelectionContext('asset-panel')
}

function prefabAggregateProgressState(asset: ProjectAsset) {
  if (asset.type !== 'prefab') {
    return null
  }
  const cacheId = resolveAssetCacheId(asset)
  return sceneStore.prefabAssetDownloadProgress?.[cacheId]
    ?? sceneStore.prefabAssetDownloadProgress?.[asset.id]
    ?? null
}

function isAssetDownloading(asset: ProjectAsset) {
  const aggregate = prefabAggregateProgressState(asset)
  if (aggregate?.active) {
    return true
  }
  return assetCacheStore.isDownloading(resolveAssetCacheId(asset))
}

function canDeleteAsset(asset: ProjectAsset) {
  if (asset.type === 'material') {
    return asset.gleaned !== false
  }
  if (!asset.gleaned) {
    return false
  }
  return assetCacheStore.hasCache(resolveAssetCacheId(asset)) && !isAssetDownloading(asset)
}

function assetDownloadProgress(asset: ProjectAsset) {
  const aggregate = prefabAggregateProgressState(asset)
  if (aggregate) {
    return aggregate.progress
  }
  return assetCacheStore.getProgress(resolveAssetCacheId(asset))
}

function assetDownloadError(asset: ProjectAsset) {
  const aggregate = prefabAggregateProgressState(asset)
  if (aggregate && !aggregate.active) {
    return aggregate.error
  }
  return assetCacheStore.getError(resolveAssetCacheId(asset))
}

async function ensureAssetCached(asset: ProjectAsset) {
  if (assetCacheStore.hasCache(asset.id)) {
    return
  }
  const entry = await assetCacheStore.downloaProjectAsset(asset)
  if (!assetCacheStore.hasCache(asset.id)) {
    throw new Error(entry.error ?? 'Asset download is not complete')
  }
}

const MODEL_ASSET_TYPES = new Set<ProjectAsset['type']>(['model', 'mesh'])
const MATERIAL_ASSET_TYPES = new Set<ProjectAsset['type']>(['material'])
const TEXTURE_ASSET_TYPES = new Set<ProjectAsset['type']>(['texture', 'image'])

const selectedSceneNode = computed<SceneNode | null>(() => findSceneNodeById(sceneStore.nodes, selectedNodeId.value))

function findSceneNodeById(nodes: SceneNode[] | undefined, id: string | null | undefined): SceneNode | null {
  if (!Array.isArray(nodes) || !id) {
    return null
  }
  for (const node of nodes) {
    if (!node) {
      continue
    }
    if (node.id === id) {
      return node
    }
    const child = findSceneNodeById(node.children, id)
    if (child) {
      return child
    }
  }
  return null
}

function findNodeWithParent(
  nodes: SceneNode[] | undefined,
  nodeId: string,
  parent: SceneNode | null = null,
): { node: SceneNode; parent: SceneNode | null } | null {
  if (!Array.isArray(nodes) || !nodeId) {
    return null
  }
  for (const node of nodes) {
    if (!node) {
      continue
    }
    if (node.id === nodeId) {
      return { node, parent }
    }
    if (Array.isArray(node.children) && node.children.length) {
      const nested = findNodeWithParent(node.children, nodeId, node)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function isNormalSceneNode(node: SceneNode | null): boolean {
  if (!node) {
    return false
  }
  return node.id !== GROUND_NODE_ID && node.id !== ENVIRONMENT_NODE_ID
}

function nodeSupportsMaterials(node: SceneNode | null): boolean {
  if (!node || !isNormalSceneNode(node)) {
    return false
  }
  if (node.components?.[PROTAGONIST_COMPONENT_TYPE]) {
    return false
  }
  const type = node.nodeType ?? 'Mesh'
  return type !== 'Light' && type !== 'Group'
}

function resolveModelParentNode(node: SceneNode | null): SceneNode | null {
  if (!node || (node as { isPlaceholder?: boolean }).isPlaceholder) {
    return null
  }
  if (node.nodeType === 'Group' && sceneStore.nodeAllowsChildCreation(node.id)) {
    if (node.id === GROUND_NODE_ID || node.id === ENVIRONMENT_NODE_ID) {
      return null
    }
    return node
  }

  const located = findNodeWithParent(sceneStore.nodes, node.id)
  const parentNode = located?.parent ?? null
  if (!parentNode) {
    return null
  }
  const parentPlaceholder = (parentNode as { isPlaceholder?: boolean }).isPlaceholder
  if (parentPlaceholder) {
    return null
  }
  if (!sceneStore.nodeAllowsChildCreation(parentNode.id)) {
    return null
  }
  if (parentNode.id === GROUND_NODE_ID || parentNode.id === ENVIRONMENT_NODE_ID) {
    return null
  }
  return parentNode
}

function snapNodeToParentOrigin(nodeId: string | null | undefined): void {
  if (!nodeId) {
    return
  }
  const target = findSceneNodeById(sceneStore.nodes, nodeId)
  if (!target) {
    return
  }
  const rotation = target.rotation ?? { x: 0, y: 0, z: 0 }
  const scale = target.scale ?? { x: 1, y: 1, z: 1 }
  sceneStore.updateNodeTransform({
    id: nodeId,
    position: { x: 0, y: 0, z: 0 },
    rotation,
    scale,
  })
}

function canAddAsset(asset: ProjectAsset): boolean {

  if (isAssetDownloading(asset)) {
    return false
  }

  if (asset.type === 'prefab' || MODEL_ASSET_TYPES.has(asset.type)) {
    return true
  }

  if (MATERIAL_ASSET_TYPES.has(asset.type) || TEXTURE_ASSET_TYPES.has(asset.type)) {
    const node = selectedSceneNode.value
    if (!node || !isNormalSceneNode(node)) {
      return false
    }
    return nodeSupportsMaterials(node)
  }

  return true
}

async function handleAddAsset(asset: ProjectAsset) {
  if (!canAddAsset(asset)) {
    return
  }
  if (addPendingAssetId.value === asset.id) {
    return
  }
  addPendingAssetId.value = asset.id
  let preparedAsset: ProjectAsset | null = null
  try {
    preparedAsset = prepareAssetForOperations(asset)
    assetCacheStore.setError(preparedAsset.id, null)
    const currentNode = selectedSceneNode.value
    const parentNode = resolveModelParentNode(currentNode)
    if (preparedAsset.type === 'prefab') {
      const spawnPosition = parentNode?.id ? sceneStore.getNodeWorldCenter(parentNode.id) : null
      await sceneStore.spawnPrefabWithPlaceholder(preparedAsset.id, spawnPosition, { parentId: null })
      return
    }
    await ensureAssetCached(preparedAsset)
    if (MODEL_ASSET_TYPES.has(preparedAsset.type)) {
      const node = await sceneStore.addModelNode({ asset: preparedAsset, parentId: parentNode?.id ?? undefined })
      if (!node) {
        throw new Error('Asset is not ready yet')
      }
      if (parentNode?.id) {
        snapNodeToParentOrigin(node.id)
      }
      return
    }
    if (MATERIAL_ASSET_TYPES.has(preparedAsset.type)) {
      if (!currentNode || !nodeSupportsMaterials(currentNode)) {
        throw new Error('Select a compatible node to apply the material')
      }
      const primary = currentNode.materials?.[0] ?? null
      const applied = primary
        ? sceneStore.assignNodeMaterial(currentNode.id, primary.id, preparedAsset.id)
        : Boolean(sceneStore.addNodeMaterial(currentNode.id, { materialId: preparedAsset.id }))
      if (!applied) {
        throw new Error('Failed to apply material to the selected node')
      }
      return
    }
    if (TEXTURE_ASSET_TYPES.has(preparedAsset.type)) {
      if (!currentNode || !nodeSupportsMaterials(currentNode)) {
        throw new Error('Select a compatible node to apply the texture')
      }
      const textureRef: SceneMaterialTextureRef = preparedAsset.name?.trim().length
        ? { assetId: preparedAsset.id, name: preparedAsset.name }
        : { assetId: preparedAsset.id }
      const applied = sceneStore.setNodePrimaryTexture(currentNode.id, textureRef, 'albedo')
      if (!applied) {
        throw new Error('Failed to apply texture to the selected node')
      }
      return
    }
    console.warn('Add asset action is not implemented for asset type', preparedAsset.type)
  } catch (error) {
    console.error('Failed to add asset', error)
    const cacheId = preparedAsset?.id ?? resolveAssetCacheId(asset)
    assetCacheStore.setError(cacheId, (error as Error).message ?? 'Failed to add asset')
  } finally {
    addPendingAssetId.value = null
  }
}

function refreshGallery() {
  const providerId = activeProviderId.value
  if (providerId) {
    void loadPackageDirectory(providerId, { force: true })
  }
}

function handleAssetDragStart(event: DragEvent, asset: ProjectAsset) {
  const preparedAsset = prepareAssetForOperations(asset)
  sceneStore.setDraggingAssetId(asset.id)
  assetCacheStore.touch(preparedAsset.id)

  let preview: HTMLDivElement | null = null

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify({ assetId: preparedAsset.id }))
    event.dataTransfer.dropEffect = 'copy'

    const isModelOrMesh = asset.type === 'model' || asset.type === 'mesh'
    const isCached = assetCacheStore.hasCache(preparedAsset.id)

    if (isModelOrMesh && isCached) {
      applyHiddenDragImage(event)
      dragImageOffset = null
    } else {
      preview = createDragPreview(asset)
      if (preview) {
        const rect = preview.getBoundingClientRect()
        dragImageOffset = {
          x: rect.width / 2,
          y: rect.height / 2,
        }
        event.dataTransfer.setDragImage(preview, dragImageOffset.x, dragImageOffset.y)
      } else {
        dragImageOffset = null
      }
    }
  } else {
    dragImageOffset = null
  }

  initializeDragSuppression(preparedAsset, asset.id)
}

function handleAssetDragEnd() {
  sceneStore.setDraggingAssetId(null)
  destroyDragPreview()
  detachDragSuppressionListeners()
}

function ensureHiddenDragImage(): HTMLDivElement | null {
  if (typeof document === 'undefined') {
    return null
  }
  if (!hiddenDragImageEl) {
    const placeholder = document.createElement('div')
    placeholder.style.width = '1px'
    placeholder.style.height = '1px'
    placeholder.style.opacity = '0'
    placeholder.style.position = 'absolute'
    placeholder.style.top = '-9999px'
    placeholder.style.left = '-9999px'
    placeholder.style.pointerEvents = 'none'
    document.body.appendChild(placeholder)
    hiddenDragImageEl = placeholder
  }
  return hiddenDragImageEl
}

function applyHiddenDragImage(event: DragEvent) {
  if (!event.dataTransfer) {
    return
  }
  const placeholder = ensureHiddenDragImage()
  if (!placeholder) {
    return
  }
  event.dataTransfer.setDragImage(placeholder, 0, 0)
}

function restorePreviewDragImage(event: DragEvent) {
  if (!dragPreviewEl || !dragImageOffset || !event.dataTransfer) {
    return
  }
  event.dataTransfer.setDragImage(dragPreviewEl, dragImageOffset.x, dragImageOffset.y)
}

function handleWindowDragOver(event: DragEvent) {
  if (!dragSuppressionPreparedAssetId || !dragSuppressionSourceAssetId || !dragSuppressionPreparedAssetType) {
    return
  }
  if (!event.dataTransfer) {
    return
  }
  const types = Array.from(event.dataTransfer.types ?? [])
  if (!types.includes(ASSET_DRAG_MIME)) {
    return
  }
  if (sceneStore.draggingAssetId !== dragSuppressionSourceAssetId) {
    return
  }
  if (typeof document === 'undefined') {
    return
  }
  const cachedObjectReady = dragSuppressionPreparedAssetType === 'prefab'
    ? isDragPreviewReady(dragSuppressionPreparedAssetId)
    : !!getCachedModelObject(dragSuppressionPreparedAssetId)
  if (!cachedObjectReady) {
    if (dragSuppressionActive) {
      restorePreviewDragImage(event)
      dragSuppressionActive = false
    }
    return
  }
  const currentElement = document.elementFromPoint(event.clientX, event.clientY)
  const inViewport = !!currentElement?.closest('[data-scene-viewport]')
  if (inViewport) {
    if (!dragSuppressionActive) {
      applyHiddenDragImage(event)
      dragSuppressionActive = true
    }
  } else if (dragSuppressionActive) {
    restorePreviewDragImage(event)
    dragSuppressionActive = false
  }
}

function attachDragSuppressionListeners() {
  if (typeof window === 'undefined') {
    return
  }
  if (!windowDragOverListener) {
    windowDragOverListener = (event: DragEvent) => {
      handleWindowDragOver(event)
    }
    window.addEventListener('dragover', windowDragOverListener, true)
  }
  if (!windowDropListener) {
    windowDropListener = () => {
      detachDragSuppressionListeners()
    }
    window.addEventListener('drop', windowDropListener, true)
  }
}

function detachDragSuppressionListeners() {
  if (typeof window !== 'undefined') {
    if (windowDragOverListener) {
      window.removeEventListener('dragover', windowDragOverListener, true)
      windowDragOverListener = null
    }
    if (windowDropListener) {
      window.removeEventListener('drop', windowDropListener, true)
      windowDropListener = null
    }
  }
  dragSuppressionActive = false
  dragSuppressionPreparedAssetId = null
  dragSuppressionPreparedAssetType = null
  dragSuppressionSourceAssetId = null
}

function initializeDragSuppression(preparedAsset: ProjectAsset, sourceAssetId: string) {
  detachDragSuppressionListeners()
  const supportsSuppression = preparedAsset.type === 'prefab' || MODEL_ASSET_TYPES.has(preparedAsset.type)
  const preparedAssetId = supportsSuppression ? preparedAsset.id : null
  dragSuppressionSourceAssetId = sourceAssetId
  dragSuppressionPreparedAssetId = preparedAssetId
  dragSuppressionPreparedAssetType = supportsSuppression ? preparedAsset.type : null
  dragSuppressionActive = false
  if (dragSuppressionPreparedAssetId) {
    attachDragSuppressionListeners()
  }
}

function isAssetSelected(assetId: string) {
  return selectedAssetIds.value.includes(assetId)
}

function toggleAssetSelection(asset: ProjectAsset) {
  const assetId = asset.id
  const cacheId = resolveAssetCacheId(asset)
  if (!asset.gleaned || !assetCacheStore.hasCache(cacheId) || isAssetDownloading(asset)) {
    return
  }
  if (isAssetSelected(assetId)) {
    selectedAssetIds.value = selectedAssetIds.value.filter((id) => id !== assetId)
  } else {
    selectedAssetIds.value = [...selectedAssetIds.value, assetId]
  }
}

function setSelectableAssetSelection(select: boolean) {
  const selectableIds = selectableAssetIds.value
  if (!selectableIds.length) {
    return
  }
  if (select) {
    const merged = new Set([...selectedAssetIds.value, ...selectableIds])
    selectedAssetIds.value = Array.from(merged)
  } else {
    const deselectSet = new Set(selectableIds)
    selectedAssetIds.value = selectedAssetIds.value.filter((id) => !deselectSet.has(id))
  }
}

function handleSelectAllChange(value: boolean) {
  setSelectableAssetSelection(value)
}

function openDeleteDialog(assets: ProjectAsset[], batch: boolean) {
  if (!assets.length) {
    return
  }
  const filtered = assets.filter((asset) => canDeleteAsset(asset))
  if (!filtered.length) {
    return
  }
  pendingDeleteAssets.value = filtered
  isBatchDeletion.value = batch
  deleteDialogOpen.value = true
}

function requestDeleteSelection() {
  openDeleteDialog(selectedAssets.value, true)
}

function cancelDeleteAssets() {
  deleteDialogOpen.value = false
  pendingDeleteAssets.value = []
  isBatchDeletion.value = false
}

async function performDeleteAssets() {
  const assets = pendingDeleteAssets.value
  if (!assets.length) {
    cancelDeleteAssets()
    return
  }
  try {
    const assetIds = assets.map((asset) => asset.id)
    const removedIds = await sceneStore.deleteProjectAssets(assetIds)
    if (removedIds.length) {
      sceneStore.selectAsset(null)
      searchResults.value = searchResults.value.filter((item) => !removedIds.includes(item.id))
      selectedAssetIds.value = selectedAssetIds.value.filter((id) => !removedIds.includes(id))
    }
  } catch (error) {
    console.error('Failed to delete assets', error)
  } finally {
    cancelDeleteAssets()
  }
}

function isAssetDragging(assetId: string) {
  return draggingAssetId.value === assetId
}

const categoryTree = ref<ResourceCategory[]>([])
const categoryTreeLoaded = ref(false)
const categoryTreeLoading = ref(false)
const categoryPath = ref<ResourceCategory[]>([])

interface CategoryBreadcrumbItem {
  id: string | null
  name: string
  category: ResourceCategory | null
  depth: number
  children: ResourceCategory[]
}

function collectDisplayChildren(nodes: ResourceCategory[] | undefined, bucket: ResourceCategory[]): void {
  if (!Array.isArray(nodes)) {
    return
  }
  nodes.forEach((node) => {
    if (!node) {
      return
    }
    if ((isAssetTypeName(node.name) || isRootCategoryName(node.name)) && Array.isArray(node.children) && node.children.length) {
      collectDisplayChildren(node.children, bucket)
    } else {
      bucket.push(node)
    }
  })
}

function getDisplayChildren(category: ResourceCategory | null): ResourceCategory[] {
  const bucket: ResourceCategory[] = []
  const source = category ? category.children : categoryTree.value
  collectDisplayChildren(source, bucket)
  return bucket.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

const categoryIndex = computed(() => {
  const map = new Map<string, ResourceCategory>()
  const traverse = (nodes: ResourceCategory[] | undefined) => {
    if (!Array.isArray(nodes)) {
      return
    }
    nodes.forEach((node) => {
      if (!node || typeof node.id !== 'string') {
        return
      }
      map.set(node.id, node)
      if (Array.isArray(node.children) && node.children.length) {
        traverse(node.children)
      }
    })
  }
  traverse(categoryTree.value)
  return map
})

const categoryGraph = computed(() => {
  const parentMap = new Map<string, ResourceCategory | null>()
  const descendantMap = new Map<string, Set<string>>()

  const traverse = (node: ResourceCategory, parent: ResourceCategory | null): Set<string> => {
    parentMap.set(node.id, parent)
    const descendants = new Set<string>([node.id])
    const children = getDisplayChildren(node)
    children.forEach((child) => {
      const childSet = traverse(child, node)
      childSet.forEach((id) => descendants.add(id))
    })
    descendantMap.set(node.id, descendants)
    return descendants
  }

  const roots = getDisplayChildren(null)
  roots.forEach((root) => traverse(root, null))

  return { roots, parentMap, descendantMap }
})

const categoryBreadcrumbs = computed<CategoryBreadcrumbItem[]>(() => {
  const items: CategoryBreadcrumbItem[] = []
  const graph = categoryGraph.value
  items.push({
    id: null,
  name: 'All Assets',
    category: null,
    depth: 0,
    children: graph.roots,
  })
  categoryPath.value.forEach((entry, index) => {
    const resolved = categoryIndex.value.get(entry.id) ?? entry
    items.push({
      id: resolved.id,
      name: resolved.name,
      category: resolved,
      depth: index + 1,
      children: getDisplayChildren(resolved),
    })
  })
  return items
})

function buildCategoryPathChain(category: ResourceCategory): ResourceCategory[] {
  const graph = categoryGraph.value
  const chain: ResourceCategory[] = []
  const visited = new Set<string>()
  let current: ResourceCategory | null = category
  while (current && !visited.has(current.id)) {
    chain.unshift(current)
    visited.add(current.id)
    current = graph.parentMap.get(current.id) ?? null
  }
  return chain.length ? chain : [category]
}

const activeCategoryId = computed(() => {
  const last = categoryPath.value[categoryPath.value.length - 1]
  return last?.id ?? null
})

const activeCategoryDescendants = computed(() => {
  const id = activeCategoryId.value
  if (!id) {
    return null
  }
  const graph = categoryGraph.value
  const set = graph.descendantMap.get(id)
  if (set && set.size) {
    return set
  }
  return new Set<string>([id])
})

function assetMatchesCategoryFilter(asset: ProjectAsset, allowed: Set<string>): boolean {
  const pathIds = Array.isArray(asset.categoryPath)
    ? asset.categoryPath
        .map((item) => (item && typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => !!id)
    : []
  if (pathIds.some((id) => allowed.has(id))) {
    return true
  }
  if (asset.categoryId && allowed.has(asset.categoryId)) {
    return true
  }
  return false
}

async function loadCategoryTree(options: { force?: boolean } = {}): Promise<void> {
  if (categoryTreeLoading.value) {
    return
  }
  if (categoryTreeLoaded.value && !options.force) {
    return
  }
  categoryTreeLoading.value = true
  try {
    const categories = await fetchResourceCategories()
    categoryTree.value = Array.isArray(categories) ? categories : []
    categoryTreeLoaded.value = true
  } catch (error) {
    console.error('Failed to load categories', error)
  } finally {
    categoryTreeLoading.value = false
  }
}

function handleBreadcrumbClick(index: number): void {
  if (index <= 0) {
    if (categoryPath.value.length) {
      categoryPath.value = []
    }
    return
  }
  const next = categoryPath.value.slice(0, index)
  categoryPath.value = next
}

function handleBreadcrumbChildSelect(_crumbIndex: number, category: ResourceCategory): void {
  if (!category || typeof category.id !== 'string') {
    return
  }
  categoryPath.value = buildCategoryPathChain(category)
}

function isBreadcrumbIndexActive(index: number): boolean {
  if (index === 0) {
    return categoryPath.value.length === 0
  }
  return index === categoryPath.value.length
}

function isCategoryActive(categoryId: string): boolean {
  return categoryPath.value.some((entry) => entry.id === categoryId)
}

function buildCategoryLabel(category: ResourceCategory | null): string {
  if (!category) {
  return 'All Assets'
  }
  return category.name
}

function categoryTooltip(crumb: CategoryBreadcrumbItem): string {
  return buildCategoryLabel(crumb.category)
}

onMounted(() => {
  void loadCategoryTree()
  void refreshPresetProviderAssets()
})

onMounted(() => {
  if (typeof window === 'undefined') {
    return
  }
  windowPasteListener = (event: ClipboardEvent) => {
    void handleGalleryClipboardPaste(event)
  }
  window.addEventListener('paste', windowPasteListener, true)
})

watch(categoryTree, () => {
  if (!categoryPath.value.length) {
    return
  }
  const last = categoryPath.value[categoryPath.value.length - 1]
  if (!last || !last.id) {
    categoryPath.value = []
    return
  }
  const refreshed = categoryIndex.value.get(last.id)
  if (!refreshed) {
    categoryPath.value = []
    return
  }
  const next = buildCategoryPathChain(refreshed)
  const unchanged =
    next.length === categoryPath.value.length &&
    next.every((item, idx) => item.id === categoryPath.value[idx]?.id)
  if (!unchanged) {
    categoryPath.value = next
  }
})

const searchQuery = ref<string | null>('')
const searchResults = ref<ProjectAsset[]>([])
const searchLoaded = ref(false)
const searchLoading = ref(false)
const SEARCH_DEBOUNCE_DELAY = 320
let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null

const isSearchVisible = ref(false)
const searchFieldRef = ref<unknown>(null)

const normalizedSearchQuery = computed(() => (searchQuery.value ?? '').trim())
const isSearchActive = computed(() => searchLoaded.value && normalizedSearchQuery.value.length > 0)
const baseDisplayedAssets = computed(() => (isSearchActive.value ? searchResults.value : currentAssets.value))

const categoryFilteredAssets = computed(() => {
  const base = baseDisplayedAssets.value
  const allowed = activeCategoryDescendants.value
  if (!allowed || !allowed.size) {
    return base
  }
  return base.filter((asset) => assetMatchesCategoryFilter(asset, allowed))
})

const SERIES_ID_PREFIX = 'series:id:'
const SERIES_NAME_PREFIX = 'series:name:'
const SERIES_UNASSIGNED_VALUE = '__series-unassigned__'
const SIZE_UNASSIGNED_VALUE = '__size-category-unassigned__'

const selectedSeriesValue = ref<string | null>(null)
const selectedSizeCategories = ref<string[]>([])
const tagFilterValues = ref<string[]>([])
const tagFilterPanelOpen = ref(false)
const tagFilterSearch = ref('')

const hasActiveTagFilters = computed(() => tagFilterValues.value.length > 0)
const hasActiveSeriesFilter = computed(() => selectedSeriesValue.value !== null)
const hasActiveSizeFilters = computed(() => selectedSizeCategories.value.length > 0)
const hasActiveAssetFilters = computed(
  () => hasActiveSeriesFilter.value || hasActiveSizeFilters.value || hasActiveTagFilters.value,
)

const seriesOptions = computed<SeriesFilterOption[]>(() => {
  const map = new Map<string, SeriesFilterOption>()
  categoryFilteredAssets.value.forEach((asset) => {
    const seriesId = typeof asset.seriesId === 'string' ? asset.seriesId.trim() : ''
    const seriesName = typeof asset.seriesName === 'string' ? asset.seriesName.trim() : ''
    if (seriesId.length) {
      const value = `${SERIES_ID_PREFIX}${seriesId}`
      if (!map.has(value)) {
        map.set(value, {
          value,
          label: seriesName.length ? seriesName : seriesId,
          id: seriesId,
          name: seriesName.length ? seriesName : null,
        })
      }
      return
    }
    if (seriesName.length) {
      const value = `${SERIES_NAME_PREFIX}${seriesName}`
      if (!map.has(value)) {
        map.set(value, {
          value,
          label: seriesName,
          id: null,
          name: seriesName,
        })
      }
      return
    }
    const value = SERIES_UNASSIGNED_VALUE
    if (!map.has(value)) {
      map.set(value, {
        value,
  label: 'Unassigned series',
        id: null,
        name: null,
        isUnassigned: true,
      })
    }
  })
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
})

function selectSeries(value: string | null): void {
  if (selectedSeriesValue.value === value) {
    selectedSeriesValue.value = null
    return
  }
  selectedSeriesValue.value = value
}

function assetMatchesSelectedSeries(asset: ProjectAsset, selectedValue: string | null): boolean {
  if (!selectedValue) {
    return true
  }
  if (selectedValue === SERIES_UNASSIGNED_VALUE) {
    const hasSeriesId = typeof asset.seriesId === 'string' && asset.seriesId.trim().length > 0
    const hasSeriesName = typeof asset.seriesName === 'string' && asset.seriesName.trim().length > 0
    return !hasSeriesId && !hasSeriesName
  }
  if (selectedValue.startsWith(SERIES_ID_PREFIX)) {
    const id = selectedValue.slice(SERIES_ID_PREFIX.length)
    return (asset.seriesId ?? '').trim() === id
  }
  if (selectedValue.startsWith(SERIES_NAME_PREFIX)) {
    const name = selectedValue.slice(SERIES_NAME_PREFIX.length)
    return (asset.seriesName ?? '').trim() === name
  }
  return false
}

const seriesFilteredAssets = computed(() =>
  categoryFilteredAssets.value.filter((asset) => assetMatchesSelectedSeries(asset, selectedSeriesValue.value)),
)

watch(seriesOptions, (options) => {
  if (!selectedSeriesValue.value) {
    return
  }
  const available = new Set(options.map((option) => option.value))
  if (!available.has(selectedSeriesValue.value)) {
    selectedSeriesValue.value = null
  }
})

const sizeCategoryOptions = computed<SizeCategoryFilterOption[]>(() => {
  const map = new Map<string, SizeCategoryFilterOption>()
  let hasUnassigned = false
  seriesFilteredAssets.value.forEach((asset) => {
    const size = typeof asset.sizeCategory === 'string' ? asset.sizeCategory.trim() : ''
    if (size.length) {
      if (!map.has(size)) {
        map.set(size, { value: size, label: size })
      }
    } else {
      hasUnassigned = true
    }
  })
  const sorted = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  if (hasUnassigned) {
    sorted.unshift({
      value: SIZE_UNASSIGNED_VALUE,
  label: 'Uncategorized',
      isUnassigned: true,
    })
  }
  return sorted
})

function toggleSizeCategory(value: string): void {
  if (!value) {
    return
  }
  const next = new Set(selectedSizeCategories.value)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  selectedSizeCategories.value = Array.from(next)
}

function clearSizeCategoryFilters(): void {
  if (selectedSizeCategories.value.length) {
    selectedSizeCategories.value = []
  }
}

function assetMatchesSelectedSizeCategories(asset: ProjectAsset, selectedValues: string[]): boolean {
  if (!selectedValues.length) {
    return true
  }
  const size = typeof asset.sizeCategory === 'string' ? asset.sizeCategory.trim() : ''
  if (!size.length) {
    return selectedValues.includes(SIZE_UNASSIGNED_VALUE)
  }
  return selectedValues.includes(size)
}

const sizeCategoryFilteredAssets = computed(() =>
  seriesFilteredAssets.value.filter((asset) => assetMatchesSelectedSizeCategories(asset, selectedSizeCategories.value)),
)

watch(sizeCategoryOptions, (options) => {
  if (!selectedSizeCategories.value.length) {
    return
  }
  const available = new Set(options.map((option) => option.value))
  const filtered = selectedSizeCategories.value.filter((value) => available.has(value))
  if (filtered.length !== selectedSizeCategories.value.length) {
    selectedSizeCategories.value = filtered
  }
})

function toggleTagFilter(value: string): void {
  if (!value) {
    return
  }
  const current = new Set(tagFilterValues.value)
  if (current.has(value)) {
    current.delete(value)
  } else {
    current.add(value)
  }
  tagFilterValues.value = Array.from(current)
}

function clearTagFilters(): void {
  if (!tagFilterValues.value.length) {
    return
  }
  tagFilterValues.value = []
}

function clearAllAssetFilters(): void {
  selectSeries(null)
  clearSizeCategoryFilters()
  clearTagFilters()
  tagFilterSearch.value = ''
}

function buildTagOptionsFromAssets(assets: ProjectAsset[]): TagFilterOption[] {
  const map = new Map<string, TagFilterOption>()
  assets.forEach((asset) => {
    const tagNames = Array.isArray(asset.tags) ? asset.tags : []
    const tagIds = Array.isArray(asset.tagIds) ? asset.tagIds : []
    if (tagIds.length && tagNames.length && tagIds.length === tagNames.length) {
      tagIds.forEach((id, index) => {
        const name = tagNames[index] ?? id
        if (!map.has(id)) {
          map.set(id, { value: id, label: name, id, name })
        }
      })
      return
    }
    if (tagNames.length) {
      tagNames.forEach((name) => {
        if (!map.has(name)) {
          map.set(name, { value: name, label: name, name })
        }
      })
      return
    }
    if (tagIds.length) {
      tagIds.forEach((id) => {
        if (!map.has(id)) {
          map.set(id, { value: id, label: id, id, name: id })
        }
      })
    }
  })
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

const tagOptions = computed<TagFilterOption[]>(() => buildTagOptionsFromAssets(categoryFilteredAssets.value))
const filterTagOptions = computed<TagFilterOption[]>(() => buildTagOptionsFromAssets(sizeCategoryFilteredAssets.value))

const tagOptionMap = computed(() => {
  const entries = tagOptions.value.map((option) => [option.value, option] as const)
  return new Map<string, TagFilterOption>(entries)
})

const normalizedTagFilterSearch = computed(() => tagFilterSearch.value.trim().toLowerCase())

const combinedTagOptions = computed(() => {
  const map = new Map<string, TagFilterOption>()
  filterTagOptions.value.forEach((option) => {
    if (!map.has(option.value)) {
      map.set(option.value, option)
    }
  })
  tagFilterValues.value.forEach((value) => {
    if (!map.has(value)) {
      const fallback = tagOptionMap.value.get(value) ?? { value, label: value, name: value }
      map.set(value, fallback)
    }
  })
  return Array.from(map.values())
})

const filteredTagOptions = computed(() => {
  const search = normalizedTagFilterSearch.value
  if (!search.length) {
    return combinedTagOptions.value
  }
  return combinedTagOptions.value.filter((option) => {
    const label = option.label.toLowerCase()
    const value = option.value.toLowerCase()
    const name = option.name.toLowerCase()
    return label.includes(search) || value.includes(search) || name.includes(search)
  })
})

const uploadableSelectedAssets = computed(() =>
  selectedAssets.value.filter((asset) => assetIndex.value?.[asset.id]?.source?.type === 'local'),
)

const canUploadSelection = computed(() => uploadableSelectedAssets.value.length > 0)

function assetMatchesSelectedTags(asset: ProjectAsset, selectedValues: string[]): boolean {
  if (!selectedValues.length) {
    return true
  }
  const assetIds = new Set((asset.tagIds ?? []).filter((id) => typeof id === 'string'))
  const assetNames = new Set((asset.tags ?? []).map((name) => name.toLowerCase()))
  return selectedValues.every((value) => {
    const option = tagOptionMap.value.get(value)
    if (option?.id && assetIds.has(option.id)) {
      return true
    }
    const normalizedName = (option?.name ?? value).toLowerCase()
    if (assetNames.has(normalizedName)) {
      return true
    }
    return assetIds.has(value) || assetNames.has(value.toLowerCase())
  })
}

const displayedAssets = computed(() => {
  const base = sizeCategoryFilteredAssets.value
  if (!tagFilterValues.value.length) {
    return base
  }
  return base.filter((asset) => assetMatchesSelectedTags(asset, tagFilterValues.value))
})

watch(tagOptions, (options) => {
  if (!tagFilterValues.value.length) {
    return
  }
  const available = new Set(options.map((option) => option.value))
  const filtered = tagFilterValues.value.filter((value) => available.has(value))
  if (filtered.length !== tagFilterValues.value.length) {
    tagFilterValues.value = filtered
  }
})

watch(tagFilterPanelOpen, (open) => {
  if (!open) {
    tagFilterSearch.value = ''
  }
})

const galleryDirectories = computed(() => {
  if (isSearchActive.value) {
    return []
  }
  if (activeDirectoryId.value !== PACKAGES_ROOT_DIRECTORY_ID) {
    return []
  }
  return currentDirectory.value?.children ?? []
})

function ensureDirectoryOpened(directoryId: string) {
  if (!openedDirectories.value.includes(directoryId)) {
    openedDirectories.value = [...openedDirectories.value, directoryId]
  }
}

function enterDirectory(directory: ProjectDirectory) {
  if (!directory?.id) {
    return
  }
  ensureDirectoryOpened(directory.id)
  sceneStore.setActiveDirectory(directory.id)
}

function clearDropFeedbackTimer() {
  if (typeof window === 'undefined') {
    return
  }
  if (dropFeedbackTimer !== null) {
    window.clearTimeout(dropFeedbackTimer)
    dropFeedbackTimer = null
  }
}

function showDropFeedback(kind: 'success' | 'error', message: string) {
  console.log(`[Asset Gallery] ${kind.toUpperCase()}: ${message}`)
  if (typeof window === 'undefined') {
    return
  }
  clearDropFeedbackTimer()
  dropFeedbackTimer = window.setTimeout(() => {
    dropFeedbackTimer = null
  }, 4000)
}

function openUploadDialog() {
  if (!canUploadSelection.value) {
    return
  }
  uploadDialogOpen.value = true
}

function handleUploadCompleted(payload: { successCount: number; replacementMap: Record<string, string> }) {
  const replacement = new Map<string, string>(Object.entries(payload?.replacementMap ?? {}))
  if (replacement.size) {
    selectedAssetIds.value = Array.from(new Set(selectedAssetIds.value.map((id) => replacement.get(id) ?? id)))
    const lastId = Array.from(replacement.values()).pop()
    if (lastId) {
      sceneStore.selectAsset(lastId)
    }
  }
  showDropFeedback('success', `Successfully uploaded ${payload.successCount} assets`)
}

function isInternalAssetDrag(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes(ASSET_DRAG_MIME)
}

function isAssetDropPayload(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types ?? [])
  if (types.includes('Files')) {
    return true
  }
  const stringTypes = ['text/uri-list', 'text/plain', 'text/html', 'text/x-moz-url']
  return stringTypes.some((type) => types.includes(type))
}

function extractSceneNodeDragId(event: DragEvent): string | null {
  if (!event.dataTransfer) {
    return null
  }
  const value = event.dataTransfer.getData(NODE_DRAG_MIME)
  if (typeof value === 'string' && value.trim().length) {
    return value.trim()
  }
  return null
}


const DEFAULT_PREVIEW_COLORS: Record<ProjectAsset['type'], string> = {
  model: '#455A64',
  image: '#5E35B1',
  texture: '#00897B',
  material: '#6D4C41',
  behavior: '#546E7A',
  prefab: '#7B1FA2',
  file: '#37474F',
  video: '#1E88E5',
  mesh: '#8D6E63',
  hdri: '#0097A7',
}

function resolvePreviewColor(type: ProjectAsset['type']): string {
  return DEFAULT_PREVIEW_COLORS[type] ?? DEFAULT_PREVIEW_COLORS.file
}

function getDroppedFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = []
  if (dataTransfer.files?.length) {
    Array.from(dataTransfer.files).forEach((file) => {
      if (file) {
        files.push(file)
      }
    })
  }
  if (dataTransfer.items?.length) {
    Array.from(dataTransfer.items).forEach((item) => {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) {
          files.push(file)
        }
      }
    })
  }
  return files
}


function normalizeRemoteUrl(url: string): string {
  return url.trim()
}

function deriveAssetNameFromUrl(url: string): string {
  if (!url) {
    return 'Remote Asset'
  }
  const trimmed = url.trim()
  if (trimmed.startsWith('data:')) {
    return 'Pasted Asset'
  }
  try {
    const parsed = new URL(trimmed, typeof window !== 'undefined' ? window.location.href : undefined)
    const segment = parsed.pathname.split('/').filter(Boolean).pop()
    if (segment) {
      try {
        return decodeURIComponent(segment)
      } catch (error) {
        return segment
      }
    }
  } catch (error) {
  }
  const stripped = trimmed.replace(/^https?:\/\//i, '')
  if (stripped.length) {
    const beforeQuery = stripped.split(/[?#]/)[0] ?? stripped
    return beforeQuery.length ? beforeQuery : 'Remote Asset'
  }
  return 'Remote Asset'
}

function isLikelyImageUrl(url: string): boolean {
  if (!url) {
    return false
  }
  const trimmed = url.trim()
  if (trimmed.startsWith('data:image/')) {
    return true
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return false
  }
  const inferred = inferAssetType({ nameOrUrl: trimmed, fallbackType: 'file' })
  return inferred === 'image'
}

function extractAssetUrlsFromDataTransfer(dataTransfer: DataTransfer): string[] {
  const urlSet = new Set<string>()
  const uriList = dataTransfer.getData('text/uri-list')
  if (uriList) {
    uriList
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => urlSet.add(line))
  }
  const mozUrl = dataTransfer.getData('text/x-moz-url')
  if (mozUrl) {
    const [mozUrlValue] = mozUrl.split(/[\r\n]+/)
    if (mozUrlValue) {
      urlSet.add(mozUrlValue.trim())
    }
  }
  const html = dataTransfer.getData('text/html')
  if (html && typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      doc.querySelectorAll('img, a').forEach((node) => {
        if (node instanceof HTMLImageElement && node.src) {
          urlSet.add(node.src)
        } else if (node instanceof HTMLAnchorElement && node.href) {
          urlSet.add(node.href)
        }
      })
    } catch (error) {
  console.warn('Failed to parse dropped HTML', error)
    }
  }
  const plain = dataTransfer.getData('text/plain')
  if (plain) {
    if (plain.startsWith('data:')) {
      urlSet.add(plain.trim())
    }
    const matches = plain.match(/https?:\/\/[^\s]+/g)
    if (matches) {
      matches.forEach((match) => {
        const sanitized = match.replace(/[\")'<>]+$/, '')
        urlSet.add(sanitized)
      })
    }
  }

  return Array.from(urlSet)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && (/^https?:\/\//i.test(entry) || entry.startsWith('data:')))
}

async function importLocalFile(
  file: File,
  options: { displayName?: string; type?: ProjectAsset['type'] } = {},
): Promise<ProjectAsset> {
  const type = options.type ?? inferAssetType({ mimeType: file.type ?? null, nameOrUrl: file.name ?? null, fallbackType: 'file' })
  const fallbackName = options.displayName ?? (file.name && file.name.trim().length ? file.name : 'Dropped Asset')
  const { asset } = await sceneStore.ensureLocalAssetFromFile(file, {
    type,
    name: fallbackName,
    description: fallbackName,
    previewColor: resolvePreviewColor(type),
    gleaned: true,
  })
  return asset
}

async function importDataUrlAsset(dataUrl: string): Promise<ProjectAsset> {
  const blob = dataUrlToBlob(dataUrl)
  const mimeType = blob.type && blob.type.length ? blob.type : 'application/octet-stream'
  const extension = getExtensionFromMimeType(mimeType) ?? 'bin'
  const type = inferAssetType({ mimeType, nameOrUrl: `pasted.${extension}`, fallbackType: 'file' })
  const fileName = `pasted-asset-${Date.now().toString(36)}.${extension}`
  const file = new File([blob], fileName, { type: mimeType })
  return importLocalFile(file, { displayName: fileName, type })
}

function importRemoteAssetFromUrl(url: string): ProjectAsset {
  const normalizedUrl = normalizeRemoteUrl(url)
  const assetType = inferAssetType({ nameOrUrl: normalizedUrl, fallbackType: 'file' })
  const name = deriveAssetNameFromUrl(normalizedUrl)
  const asset: ProjectAsset = {
    id: normalizedUrl,
    name,
    type: assetType,
    downloadUrl: normalizedUrl,
    previewColor: resolvePreviewColor(assetType),
    thumbnail: assetType === 'image' && isLikelyImageUrl(normalizedUrl) ? normalizedUrl : null,
    description: normalizedUrl,
    gleaned: true,
    extension: extractExtension(name) ?? null,
  }
  const categoryId = determineAssetCategoryId(asset)
  return sceneStore.registerAsset(asset, {
    categoryId,
    source: { type: 'url' },
  })
}

async function processAssetDrop(dataTransfer: DataTransfer): Promise<{ assets: ProjectAsset[]; errors: string[] }> {
  const collected = new Map<string, ProjectAsset>()
  const errors: string[] = []
  const files = getDroppedFiles(dataTransfer)
  for (const file of files) {
    try {
      const asset = await importLocalFile(file)
      collected.set(asset.id, asset)
    } catch (error) {
  const message = (error as Error).message ?? `Import failed: ${file.name}`
      errors.push(message)
    }
  }

  const urls = extractAssetUrlsFromDataTransfer(dataTransfer)
  for (const url of urls) {
    try {
      if (url.startsWith('data:')) {
        const asset = await importDataUrlAsset(url)
        collected.set(asset.id, asset)
      } else {
        const asset = importRemoteAssetFromUrl(url)
        collected.set(asset.id, asset)
      }
    } catch (error) {
  const message = (error as Error).message ?? `Import failed: ${url}`
      errors.push(message)
    }
  }

  return { assets: Array.from(collected.values()), errors }
}

const allowAssetDrop = computed(() => true)
const dropOverlayVisible = computed(() => dropActive.value || dropProcessing.value)
const dropOverlayMessage = computed(() =>
  dropProcessing.value ? 'Processing assets…' : 'Drag files, links, or scene nodes here to add assets',
)

function handleGalleryDragEnter(event: DragEvent) {
  if (!allowAssetDrop.value || dropProcessing.value) {
    return
  }
  if (!event.dataTransfer) {
    return
  }
  const draggedNodeId = extractSceneNodeDragId(event)
  const hasAssetPayload = isAssetDropPayload(event.dataTransfer)
  if (!draggedNodeId && (isInternalAssetDrag(event) || !hasAssetPayload)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dropDragDepth.value += 1
  dropActive.value = true
  event.dataTransfer.dropEffect = 'copy'
}

function handleGalleryDragOver(event: DragEvent) {
  if (!allowAssetDrop.value || dropProcessing.value) {
    return
  }
  if (!event.dataTransfer) {
    return
  }
  const draggedNodeId = extractSceneNodeDragId(event)
  const hasAssetPayload = isAssetDropPayload(event.dataTransfer)
  if (!draggedNodeId && (isInternalAssetDrag(event) || !hasAssetPayload)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dropActive.value = true
  event.dataTransfer.dropEffect = 'copy'
}

function handleGalleryDragLeave(event: DragEvent) {
  if (!allowAssetDrop.value || dropProcessing.value) {
    return
  }
  if (!event.dataTransfer) {
    return
  }
  const draggedNodeId = extractSceneNodeDragId(event)
  const hasAssetPayload = isAssetDropPayload(event.dataTransfer)
  if (!draggedNodeId && !hasAssetPayload) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dropDragDepth.value = Math.max(0, dropDragDepth.value - 1)
  if (dropDragDepth.value === 0) {
    dropActive.value = false
  }
}

async function handleGalleryDrop(event: DragEvent) {
  if (!allowAssetDrop.value || dropProcessing.value) {
    return
  }
  if (!event.dataTransfer) {
    return
  }
  const draggedNodeId = extractSceneNodeDragId(event)
  const hasAssetPayload = isAssetDropPayload(event.dataTransfer)
  if (!draggedNodeId && (isInternalAssetDrag(event) || !hasAssetPayload)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dropProcessing.value = true
  dropActive.value = false
  dropDragDepth.value = 0
  clearDropFeedbackTimer()
  try {
    if (draggedNodeId) {
      await handleSceneNodeDrop(draggedNodeId)
      return
    }
    const { assets, errors } = await processAssetDrop(event.dataTransfer)
    if (assets.length) {
      const categoryOrder = assets.map((asset) => determineAssetCategoryId(asset))
      const uniqueCategories = Array.from(new Set(categoryOrder.filter(Boolean)))
      uniqueCategories.forEach((categoryId) => {
        if (categoryId) {
          ensureDirectoryOpened(categoryId)
        }
      })
      const targetCategory = uniqueCategories.length
        ? uniqueCategories[uniqueCategories.length - 1]
        : determineAssetCategoryId(assets[assets.length - 1]!)
      if (targetCategory) {
        sceneStore.setActiveDirectory(targetCategory)
      }
      const lastAsset = assets[assets.length - 1]!
      sceneStore.selectAsset(lastAsset.id)
      selectedAssetIds.value = [lastAsset.id]
    }
    if (assets.length && errors.length) {
      showDropFeedback('error', `Successfully imported ${assets.length} assets, but ${errors.length} failed`)
    } else if (assets.length) {
      showDropFeedback('success', `Successfully imported ${assets.length} assets`)
    } else if (errors.length) {
      showDropFeedback('error', errors[0] ?? 'Failed to import assets')
    } else {
      showDropFeedback('error', 'No importable assets detected')
    }
  } catch (error) {
    console.error('Failed to process gallery drop payload', error)
    showDropFeedback('error', (error as Error).message ?? 'Failed to process drop payload')
  } finally {
    dropProcessing.value = false
  }
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target) {
    return false
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true
  }
  return target instanceof HTMLElement ? target.isContentEditable : false
}

function shouldHandleGalleryPaste(event: ClipboardEvent): boolean {
  if (!galleryRoot.value) {
    return false
  }
  const targetNode = event.target instanceof Node ? event.target : null
  if (isEditableElement(targetNode)) {
    return false
  }
  const activeElement = typeof document !== 'undefined' ? document.activeElement : null
  if (isEditableElement(activeElement)) {
    return false
  }
  if (targetNode && galleryRoot.value.contains(targetNode)) {
    return true
  }
  if (activeElement && galleryRoot.value.contains(activeElement)) {
    return true
  }
  return galleryHovered.value
}

async function handleGalleryClipboardPaste(event: ClipboardEvent): Promise<void> {
  if (!shouldHandleGalleryPaste(event)) {
    return
  }
  const serialized = event.clipboardData?.getData('text/plain')?.trim()
  if (!serialized) {
    return
  }
  const asset = await sceneStore.importPrefabAssetFromClipboard(serialized)
  if (asset) {
    event.preventDefault()
  }
}

function handleGalleryPointerEnter() {
  galleryHovered.value = true
}

function handleGalleryPointerLeave() {
  galleryHovered.value = false
}

async function handleSceneNodeDrop(nodeId: string): Promise<void> {
  if (!nodeId) {
    throw new Error('无效的节点引用')
  }
  const node = findSceneNodeById(sceneStore.nodes, nodeId)
  if (!node) {
    throw new Error('该节点已被删除或不可用')
  }
  if (!isNormalSceneNode(node)) {
    throw new Error('该节点无法保存为预制件')
  }
  await sceneStore.saveNodePrefab(nodeId)
  const label = node.name?.trim().length ? node.name.trim() : 'Prefab'
  showDropFeedback('success', `Prefab "${label}" saved to assets`)
}

const selectedAssets = computed(() =>
  selectedAssetIds.value
    .map((id) => displayedAssets.value.find((asset) => asset.id === id))
    .filter((asset): asset is ProjectAsset => !!asset && canDeleteAsset(asset)),
)
const selectableAssetIds = computed(() =>
  displayedAssets.value.filter((asset) => canDeleteAsset(asset)).map((asset) => asset.id),
)
const selectableAssetIdSet = computed(() => new Set(selectableAssetIds.value))
const selectedSelectableCount = computed(() =>
  selectedAssetIds.value.reduce((count, id) => (selectableAssetIdSet.value.has(id) ? count + 1 : count), 0),
)
const isSelectAllActive = computed(() => {
  const total = selectableAssetIds.value.length
  return total > 0 && selectedSelectableCount.value === total
})
const isSelectAllIndeterminate = computed(() => {
  const total = selectableAssetIds.value.length
  return total > 0 && selectedSelectableCount.value > 0 && selectedSelectableCount.value < total
})
const isToolbarDeleteVisible = computed(() => selectedSelectableCount.value > 0)
const deletionDialogTitle = computed(() => (isBatchDeletion.value ? 'Delete Selected Assets' : 'Delete Asset'))
const deletionConfirmLabel = computed(() => (isBatchDeletion.value ? 'Delete Assets' : 'Delete'))
const deletionSummary = computed(() => {
  if (!pendingDeleteAssets.value.length) {
    return ''
  }
  const names = pendingDeleteAssets.value.map((asset) => `“${asset.name}”`).join('、')
  const prefix = isBatchDeletion.value
    ? `Are you sure you want to delete the selected assets ${names}?`
    : `Are you sure you want to delete asset ${names}?`
  const hasMaterial = pendingDeleteAssets.value.some((asset) => asset.type === 'material')
  const hasNonMaterial = pendingDeleteAssets.value.some((asset) => asset.type !== 'material')
  const warningParts: string[] = []
  if (hasMaterial) {
    warningParts.push('reassign any objects using the material back to the default material')
  }
  if (hasNonMaterial) {
    warningParts.push('remove the asset, its placeholders, and all objects referencing it in the scene')
  }
  const warning = warningParts.length
    ? ` This will ${warningParts.join(' and ')}. This action cannot be undone.`
    : ' This action cannot be undone.'
  return `${prefix}${warning}`
})

const assetProviderMap = computed(() => {
  const map = new Map<string, string>()
  const traverse = (directories: ProjectDirectory[] | undefined, inheritedProviderId: string | null) => {
    if (!directories?.length) {
      return
    }
    directories.forEach((directory) => {
      const directoryProviderId = extractProviderIdFromPackageDirectoryId(directory.id) ?? inheritedProviderId
      if (directory.assets?.length && directoryProviderId) {
        directory.assets.forEach((asset) => {
          map.set(asset.id, directoryProviderId)
        })
      }
      if (directory.children?.length) {
        traverse(directory.children, directoryProviderId)
      }
    })
  }
  traverse(projectTree.value, null)
  return map
})

function providerIdForAsset(asset: ProjectAsset): string | null {
  return assetProviderMap.value.get(asset.id) ?? null
}

function resolveAssetCacheId(asset: ProjectAsset): string {
  const providerId = providerIdForAsset(asset)
  if (!providerId) {
    return asset.id
  }
  const mapKey = `${providerId}::${asset.id}`
  return sceneStore.packageAssetMap[mapKey] ?? asset.id
}

function prepareAssetForOperations(asset: ProjectAsset): ProjectAsset {
  const providerId = providerIdForAsset(asset)
  if (!providerId) {
    return asset
  }
  return sceneStore.copyPackageAssetToAssets(providerId, asset)
}

const indexedDbLoadQueue = new Set<string>()

function assetPreviewUrl(asset: ProjectAsset): string | undefined {
  const cacheId = resolveAssetCacheId(asset)
  return assetCacheStore.resolveAssetThumbnail({ asset, cacheId }) ?? undefined
}

async function ensureAssetPreview(asset: ProjectAsset) {
  const cacheId = resolveAssetCacheId(asset)
  if (assetCacheStore.hasCache(cacheId) || assetCacheStore.isDownloading(cacheId)) {
    return
  }
  if (indexedDbLoadQueue.has(cacheId)) {
    return
  }
  indexedDbLoadQueue.add(cacheId)
  try {
    await assetCacheStore.loadFromIndexedDb(cacheId)
  } catch (error) {
    console.warn('Failed to load asset from IndexedDB', error)
  } finally {
    indexedDbLoadQueue.delete(cacheId)
  }
}

watchEffect(() => {
  displayedAssets.value.forEach((asset) => {
    void ensureAssetPreview(asset)
  })
})

watch(displayedAssets, () => {
  const availableIds = new Set(displayedAssets.value.map((asset) => asset.id))
  selectedAssetIds.value = selectedAssetIds.value.filter((id) => {
    if (!availableIds.has(id)) {
      return false
    }
    const asset = displayedAssets.value.find((item) => item.id === id)
    return asset ? canDeleteAsset(asset) : false
  })
})

watch(normalizedSearchQuery, (value) => {
  if (searchDebounceHandle !== null) {
    clearTimeout(searchDebounceHandle)
    searchDebounceHandle = null
  }

  if (!value) {
    searchResults.value = []
    searchLoaded.value = false
    searchLoading.value = false
    return
  }

  searchDebounceHandle = setTimeout(() => {
    searchAsset()
  }, SEARCH_DEBOUNCE_DELAY)
})

watch(projectTree, () => {
  if (normalizedSearchQuery.value) {
    searchAsset()
  }
})

function collectAssets(directories: ProjectDirectory[], matches: ProjectAsset[], query: string, seen: Set<string>) {
  for (const directory of directories) {
    if (directory.assets) {
      for (const asset of directory.assets) {
        if (seen.has(asset.id)) continue
        if (asset.name.toLowerCase().includes(query)) {
          matches.push(asset)
          seen.add(asset.id)
        }
      }
    }
    if (directory.children?.length) {
      collectAssets(directory.children, matches, query, seen)
    }
  }
}

function searchAsset() {
  if (searchDebounceHandle !== null) {
    clearTimeout(searchDebounceHandle)
    searchDebounceHandle = null
  }

  const query = normalizedSearchQuery.value.toLowerCase()
  if (!query) {
    searchResults.value = []
    searchLoaded.value = false
    return
  }

  searchLoading.value = true
  try {
    const matches: ProjectAsset[] = []
    const seen = new Set<string>()
    collectAssets(projectTree.value ?? [], matches, query, seen)
    matches.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    searchResults.value = matches
    searchLoaded.value = true
  } finally {
    searchLoading.value = false
  }
}

function handleSearchClear() {
  if (searchDebounceHandle !== null) {
    clearTimeout(searchDebounceHandle)
    searchDebounceHandle = null
  }
  searchQuery.value = ''
  searchResults.value = []
  searchLoaded.value = false
  searchLoading.value = false
}

function focusSearchField() {
  void Promise.resolve().then(() => {
    const instance = searchFieldRef.value as any
    if (instance?.focus && typeof instance.focus === 'function') {
      instance.focus()
      return
    }
    const el = instance?.$el as HTMLElement | undefined
    const input = el?.querySelector?.('input') as HTMLInputElement | null
    input?.focus()
  })
}

function focusGalleryRoot() {
  void Promise.resolve().then(() => {
    galleryRoot.value?.focus?.()
  })
}

function showSearchAndFocus() {
  isSearchVisible.value = true
  focusSearchField()
}

function clearAndHideSearch() {
  handleSearchClear()
  isSearchVisible.value = false
  focusGalleryRoot()
}

function handleSearchIconClick() {
  if (isSearchVisible.value) {
    clearAndHideSearch()
  } else {
    showSearchAndFocus()
  }
}

function handleGalleryKeydown(event: KeyboardEvent) {
  if (isEditableElement(event.target)) {
    return
  }

  if ((isSearchVisible.value || isSearchActive.value) && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    clearAndHideSearch()
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return
  }

  if (event.key.length === 1) {
    event.preventDefault()
    event.stopPropagation()
    if (!isSearchVisible.value) {
      isSearchVisible.value = true
    }
    searchQuery.value = `${searchQuery.value ?? ''}${event.key}`
    focusSearchField()
  }
}

function handleSearchFieldKeydown(event: KeyboardEvent) {
  if ((isSearchVisible.value || isSearchActive.value) && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    clearAndHideSearch()
  }
}

function assetIcon(type: ProjectAsset['type']) {
  return iconForAssetType(type)
}

function iconForAssetType(type: ProjectAsset['type']) {
  switch (type) {
    case 'model':
      return 'mdi-cube'
    case 'image':
      return 'mdi-image-outline'
    case 'texture':
      return 'mdi-texture'
    case 'material':
      return 'mdi-palette'
    case 'behavior':
      return 'mdi-script-text-outline'
    case 'prefab':
      return 'mdi-cube-outline'
    case 'file':
    default:
      return 'mdi-file-outline'
  }
}

function createDragPreview(asset: ProjectAsset) {
  destroyDragPreview()

  const wrapper = document.createElement('div')
  wrapper.style.position = 'absolute'
  wrapper.style.top = '-9999px'
  wrapper.style.left = '-9999px'
  wrapper.style.pointerEvents = 'none'
  wrapper.style.padding = '12px'
  wrapper.style.borderRadius = '12px'
  wrapper.style.background = 'rgba(22, 25, 32, 0.12)'
  wrapper.style.border = '1px solid rgba(77, 208, 225, 0.45)'
  wrapper.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.4)'
  wrapper.style.display = 'flex'
  wrapper.style.flexDirection = 'column'
  wrapper.style.alignItems = 'center'
  wrapper.style.gap = '8px'
  wrapper.style.minWidth = '96px'
  wrapper.style.minHeight = '96px'
  wrapper.style.backdropFilter = 'blur(4px)'

  const thumbnailUrl = assetCacheStore.resolveAssetThumbnail({ asset, cacheId: resolveAssetCacheId(asset) })

  if (thumbnailUrl) {
    const thumbnail = document.createElement('div')
    thumbnail.style.width = '64px'
    thumbnail.style.height = '64px'
    thumbnail.style.borderRadius = '10px'
    thumbnail.style.backgroundColor = asset.previewColor ?? '#455A64'
    thumbnail.style.backgroundSize = 'cover'
    thumbnail.style.backgroundPosition = 'center'
    thumbnail.style.backgroundImage = `url("${thumbnailUrl}")`
    thumbnail.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.35)'
    wrapper.appendChild(thumbnail)
  } else {
    const iconSpan = document.createElement('span')
    iconSpan.className = `mdi ${iconForAssetType(asset.type)}`
    iconSpan.style.fontSize = '48px'
    iconSpan.style.color = '#FFFFFF'
    iconSpan.style.textShadow = '0 4px 14px rgba(0,0,0,0.4)'
    wrapper.appendChild(iconSpan)
  }

  const label = document.createElement('div')
  label.textContent = asset.name
  label.style.fontSize = '13px'
  label.style.fontWeight = '500'
  label.style.color = '#E9ECF1'
  label.style.textAlign = 'center'
  label.style.maxWidth = '120px'
  label.style.whiteSpace = 'nowrap'
  label.style.overflow = 'hidden'
  label.style.textOverflow = 'ellipsis'
  wrapper.appendChild(label)

  document.body.appendChild(wrapper)
  dragPreviewEl = wrapper
  return wrapper
}

function destroyDragPreview() {
  if (dragPreviewEl && dragPreviewEl.parentNode) {
    dragPreviewEl.parentNode.removeChild(dragPreviewEl)
  }
  dragPreviewEl = null
  dragImageOffset = null
}

onBeforeUnmount(() => {
  destroyDragPreview()
  detachDragSuppressionListeners()
  if (typeof window !== 'undefined' && windowPasteListener) {
    window.removeEventListener('paste', windowPasteListener, true)
    windowPasteListener = null
  }
  sceneStore.setDraggingAssetId(null)
  if (searchDebounceHandle !== null) {
    clearTimeout(searchDebounceHandle)
    searchDebounceHandle = null
  }
  clearDropFeedbackTimer()
})

const selectedDirectory = computed<string[] | undefined>({
  get() {
    return activeDirectoryId.value ? [activeDirectoryId.value] : []
  },
  set(ids) {
    const next = Array.isArray(ids) && ids.length ? String(ids[0]) : null
    if (next) {
      sceneStore.setActiveDirectory(next)
    }
  },
})

function isProviderDirectory(id: string | undefined | null): boolean {
  if (!id) return false
  return !!extractProviderIdFromPackageDirectoryId(id)
}
function isDirectoryLoading(id: string | undefined | null): boolean {
  if (!id) return false
  const providerId = extractProviderIdFromPackageDirectoryId(id)
  return providerId ? isProviderLoading(providerId) : false
}
</script>

<template>
  <div class="project-content">
    <Splitpanes class="project-split" @resized="handleProjectSplitResized">
      <Pane :size="treePaneSize">
        <div class="project-tree">
          <v-toolbar density="compact" height="46">
            <v-toolbar-title class="text-subtitle-2 project-tree-subtitle">Resource</v-toolbar-title>
            <v-spacer />
          </v-toolbar>
          <v-divider />
          <v-treeview
            v-model:opened="openedDirectories"
            v-model:activated="selectedDirectory"
            :items="projectTree"
            item-title="name"
            item-value="id"
            activatable
            class="tree-view"
          >
            <template #prepend>
              <v-icon>mdi-folder</v-icon>
            </template>
            <template #title="{ item }">
              <div class="tree-node-title">
                <span class="tree-node-text">{{ item.name }}</span>
                <v-progress-circular
                  v-if="isProviderDirectory(item?.id) && isDirectoryLoading(item?.id)"
                  class="tree-node-spinner"
                  indeterminate
                  size="14"
                  width="3"
                  color="primary"
                />
              </div>
            </template>
          </v-treeview>
        </div>
      </Pane>
      <Pane :size="galleryPaneSize">
        <div
          ref="galleryRoot"
          class="project-gallery"
          :class="{ 'is-drop-target': dropOverlayVisible }"
          tabindex="0"
          @keydown.capture="handleGalleryKeydown"
          @dragenter="handleGalleryDragEnter"
          @dragover="handleGalleryDragOver"
          @dragleave="handleGalleryDragLeave"
          @drop="handleGalleryDrop"
          @pointerenter="handleGalleryPointerEnter"
          @pointerleave="handleGalleryPointerLeave"
        >
          <v-toolbar density="compact" height="46">
            <v-checkbox-btn
              class="toolbar-select-checkbox"
              :model-value="isSelectAllActive"
              :indeterminate="isSelectAllIndeterminate"
              :disabled="!selectableAssetIds.length"
              density="compact"
              color="primary"
              @update:model-value="handleSelectAllChange"
            />

            <v-btn
              color="error"
              variant="text"
              density="compact"
              icon="mdi-delete-outline"
              :disabled="!isToolbarDeleteVisible"
              @click="requestDeleteSelection"
            />
            <v-btn
              color="primary"
              variant="text"
              density="compact"
              icon="mdi-cloud-upload"
              :disabled="!canUploadSelection"
              :title="'Upload to Server'"
              @click="openUploadDialog"
            />
            <v-divider vertical class="mx-1" />
            <div class="project-toolbar__search">
              <v-btn
                icon='mdi-magnify'
                variant="text"
                density="compact"
                :title="isSearchVisible ? 'Close search' : 'Search assets'"
                @click="handleSearchIconClick"
              />
              <AssetFilterControl
                v-model="tagFilterPanelOpen"
                :has-active-filters="hasActiveAssetFilters"
                :series-options="seriesOptions"
                :selected-series="selectedSeriesValue"
                :size-category-options="sizeCategoryOptions"
                :selected-size-categories="selectedSizeCategories"
                :tag-filter-values="tagFilterValues"
                :combined-tag-options="combinedTagOptions"
                :filtered-tag-options="filteredTagOptions"
                :has-active-tag-filters="hasActiveTagFilters"
                v-model:tag-filter-search="tagFilterSearch"
                @select-series="selectSeries"
                @toggle-size-category="toggleSizeCategory"
                @clear-size-filters="clearSizeCategoryFilters"
                @toggle-tag="toggleTagFilter"
                @clear-tag-filters="clearTagFilters"
                @clear-all="clearAllAssetFilters"
              />
            </div>
            <v-btn icon="mdi-refresh" density="compact" variant="text" @click="refreshGallery" />
          </v-toolbar>
          <div v-if="isSearchVisible" class="project-gallery-search">
            <v-text-field
              ref="searchFieldRef"
              v-model="searchQuery"
              :loading="searchLoading"
              density="compact"
              variant="solo"
              hide-details
              clearable
              single-line
              placeholder="Search assets"
              prepend-inner-icon="mdi-magnify"
              @keydown="handleSearchFieldKeydown"
              @click:clear="handleSearchClear"
            />
          </div>
          <div class="category-breadcrumbs">
            <div class="category-breadcrumbs__path">
              <template v-for="(crumb, index) in categoryBreadcrumbs" :key="crumb.id ?? ('root-' + index)">
                <div class="category-crumb" :class="{ 'has-children': crumb.children.length }">
                  <button
                    type="button"
                    class="category-crumb__label-button"
                    :class="{ 'is-active': isBreadcrumbIndexActive(index), 'is-leaf': !crumb.children.length }"
                    :title="categoryTooltip(crumb)"
                    @click="handleBreadcrumbClick(index)"
                  >
                    <span class="category-crumb__label">{{ crumb.name }}</span>
                  </button>
                  <v-menu
                    v-if="crumb.children.length"
                    location="bottom start"
                    transition="null"
                    :offset="[0, 6]"
                  >
                    <template #activator="{ props: menuProps }">
                      <button
                        type="button"
                        class="category-crumb__toggle"
                        :class="{ 'is-active': isBreadcrumbIndexActive(index) }"
                        v-bind="menuProps"
                        :title="`${categoryTooltip(crumb)} · Expand subcategories`"
                        :aria-label="`${categoryTooltip(crumb)} · Expand subcategories`"
                      >
                        <v-icon size="14">mdi-chevron-down</v-icon>
                      </button>
                    </template>
                    <v-list class="category-menu-list" density="compact">
                      <v-list-item
                        v-for="child in crumb.children"
                        :key="child.id"
                        :value="child.id"
                        :active="isCategoryActive(child.id)"
                        :title="buildCategoryLabel(child)"
                        @click="handleBreadcrumbChildSelect(index, child)"
                      >
                      </v-list-item>
                    </v-list>
                  </v-menu>
                </div>
                <span v-if="index < categoryBreadcrumbs.length - 1" class="category-breadcrumbs__separator"><v-icon icon="mdi-chevron-right"></v-icon></span>
              </template>
            </div>
            
          </div>
          <v-divider />
          <div class="project-gallery-scroll">
            <div v-if="galleryDirectories.length" class="gallery-grid gallery-grid--directories">
              <v-card
                v-for="directory in galleryDirectories"
                :key="directory.id"
                :class="['directory-card', { 'is-active': activeDirectoryId === directory.id }]"
                elevation="4"
                tabindex="0"
                @dblclick.stop="enterDirectory(directory)"
                @keyup.enter.prevent="enterDirectory(directory)"
                @keyup.space.prevent="enterDirectory(directory)"
              >
                <div class="directory-card-body">
                  <v-icon size="40" color="primary">mdi-folder</v-icon>
                  <div class="directory-card-text">
                    <span class="directory-card-title">{{ directory.name }}</span>
                    <span class="directory-card-subtitle">{{ countDirectoryAssets(directory) }} assets</span>
                  </div>
                  <v-icon class="directory-card-hint" size="18" color="primary">mdi-gesture-double-tap</v-icon>
                </div>
              </v-card>
            </div>
            <div v-else-if="displayedAssets.length" class="gallery-grid">
              <v-card
                v-for="asset in displayedAssets"
                :key="asset.id"
                :class="[
                  'asset-card',
                  {
                    'is-selected': selectedAssetId === asset.id,
                    'is-dragging': isAssetDragging(asset.id),
                    'is-downloading': isAssetDownloading(asset),
                  },
                ]"
                elevation="4"
                :draggable="true"
                @click="selectAsset(asset)"
                @dragstart.stop="handleAssetDragStart($event, asset)"
                @dragend="handleAssetDragEnd"
              >
                <div class="asset-preview" :style="{ background: asset.previewColor }">
                  <div class="asset-select-control">
                    <v-checkbox-btn
                      :model-value="isAssetSelected(asset.id)"
                      density="compact"
                      color="primary"
                      :style="{ visibility: canDeleteAsset(asset) ? 'visible' : 'hidden' }"
                      @click.stop
                      @update:model-value="() => toggleAssetSelection(asset)"
                    />
                  </div>
                  <div class="asset-actions">
          
                    <v-btn
                      color="primary"
                      variant="tonal"
                      density="compact"
                      icon="mdi-plus"
                      size="small"
                      style="min-width: 20px; height: 20px;"
                      :loading="addPendingAssetId === asset.id"
                      :disabled="!canAddAsset(asset)"
                      @click.stop="handleAddAsset(asset)"
                    />
                  </div>
                  <img
                    v-if="assetPreviewUrl(asset)"
                    :src="assetPreviewUrl(asset)"
                    class="asset-preview-image"
                    :alt="`${asset.name} preview`"
                    draggable="false"
                  />
                  <v-icon v-else size="32" color="white">{{ assetIcon(asset.type) }}</v-icon>
                  <div v-if="isAssetDownloading(asset)" class="asset-progress-overlay">
                    <v-progress-circular
                      :model-value="assetDownloadProgress(asset)"
                      color="primary"
                      size="36"
                      width="4"
                    />
                  </div>
                  <div v-else-if="assetDownloadError(asset)" class="asset-error-indicator">
                    <v-icon size="20" color="error">mdi-alert-circle-outline</v-icon>
                  </div>
                  <div class="asset-info-overlay">
                    <span class="asset-title">{{ asset.name }}</span>
                    <span v-if="assetDownloadError(asset)" class="asset-subtitle">{{ assetDownloadError(asset) }}</span>
                  </div>
                </div>
              </v-card>
            </div>
            <div v-else class="placeholder-text">
              <template v-if="isSearchActive">
                No assets found for "{{ normalizedSearchQuery }}".
              </template>
              <template v-else-if="activeProviderLoading">
                Loading package assets…
              </template>
              <template v-else-if="activeProviderError">
                {{ activeProviderError }}
              </template>
              <template v-else-if="activeProviderId">
                Select a package directory to preview assets.
              </template>
              <template v-else>
                Select a folder to preview assets.
              </template>
            </div>
          </div>
          <div v-if="dropOverlayVisible" class="drop-overlay">
            <v-icon size="42" color="white">mdi-cloud-upload</v-icon>
            <span class="drop-overlay__message">{{ dropOverlayMessage }}</span>
          </div>
        </div>
      </Pane>
    </Splitpanes>

    <UploadAssetsDialog
      v-model="uploadDialogOpen"
      :assets="uploadableSelectedAssets"
      :tag-options="tagOptions"
      @uploaded="handleUploadCompleted"
    />

    <v-dialog v-model="deleteDialogOpen" max-width="420">
      <v-card>
        <v-card-title class="text-error">{{ deletionDialogTitle }}</v-card-title>
        <v-card-text>
          <p class="delete-dialog-text">{{ deletionSummary }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelDeleteAssets">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="performDeleteAssets">{{ deletionConfirmLabel }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.project-content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.project-split {
  display: flex;
  flex: 1;
  min-height: 0;
}

.project-split :deep(.splitpanes__pane) {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.project-split :deep(.splitpanes__splitter) {
  position: relative;
  width: 6px;
  background-color: rgba(255, 255, 255, 0.04);
  border-left: 1px solid rgba(255, 255, 255, 0.02);
  border-right: 1px solid rgba(0, 0, 0, 0.4);
  cursor: col-resize;
  transition: background-color 120ms ease;
}

.project-split :deep(.splitpanes__splitter:hover),
.project-split :deep(.splitpanes__splitter:focus-visible) {
  background-color: rgba(77, 208, 225, 0.35);
}

.project-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.project-gallery-scroll {
  flex: 1;
  overflow-y: auto;
}

/* Gallery is focusable (for type-to-search); remove default focus ring. */
.project-gallery:focus,
.project-gallery:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}

.project-gallery-search {
  padding: 6px 8px;
}

.project-gallery-search :deep(.v-field) {
  background: rgba(255, 255, 255, 0.04);
}

.project-toolbar__search {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tag-filter-trigger {
  color: rgba(233, 236, 241, 0.7);
  transition: color 120ms ease;
}

.asset-filter-popover {
  width: 900px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 96px);
  background: rgba(12, 18, 26, 0.96);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e9ecf1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.asset-filter-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.asset-filter-popover__title {
  font-weight: 600;
  font-size: 0.95rem;
}

.asset-filter-popover__body {
  display: flex;
  align-items: stretch;
  gap: 20px;
  flex: 1;
}

.asset-filter-popover__column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  flex: 1 1 0;
}

.asset-filter-popover__column:first-child {
  flex: 1.1 1 0;
}

.asset-filter-popover__column:nth-child(2) {
  flex: 0.9 1 0;
}

.asset-filter-popover__column-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.82);
}

.asset-filter-popover__search {
  display: flex;
}

.asset-filter-popover__search :deep(.v-field) {
  background: rgba(233, 236, 241, 0.08);
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.asset-filter-popover__search :deep(.v-field__input) {
  color: #e9ecf1;
}

.asset-filter-popover__column-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 100%;
  overflow-y: auto;
  padding-right: 4px;
}

.asset-filter-option {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 0.85rem;
  line-height: 1.4;
  background: rgba(233, 236, 241, 0.08);
  color: #e9ecf1;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
  text-align: left;
  width: 100%;
}

.asset-filter-option:hover {
  background: rgba(233, 236, 241, 0.14);
}

.asset-filter-option:focus-visible {
  outline: 2px solid rgba(77, 208, 225, 0.8);
  outline-offset: 2px;
}

.asset-filter-option.is-active {
  background: rgba(77, 208, 225, 0.28);
  border-color: rgba(77, 208, 225, 0.6);
  color: #e0f7fa;
  box-shadow: 0 0 0 1px rgba(77, 208, 225, 0.35);
}

.category-breadcrumbs__label {
  font-size: 0.78rem;
  color: rgba(233, 236, 241, 0.6);
  letter-spacing: 0.04em;
}

.category-breadcrumbs__path {
  margin: 4px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}

.category-breadcrumbs__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.category-breadcrumbs__loader {
  width: 16px;
  height: 16px;
}

.category-breadcrumbs__separator {
  color: rgba(233, 236, 241, 0.38);
  font-size: 0.74rem;
}

.category-crumb {
  display: inline-flex;
  align-items: stretch;
  gap: 0;
}

.category-crumb__label-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 1px;
  color: rgba(233, 236, 241, 0.86);
  font-size: 0.78rem;
  line-height: 1.1;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
  white-space: nowrap;
}

.category-crumb__label-button:hover,
.category-crumb__label-button:focus-visible {
  border-right: none;
  border-color: rgba(77, 208, 225, 0.6);
  color: #e0f7fa;
}

.category-crumb__label-button.is-active {
  color: #e1f5fe;
}

.category-crumb__label-button.is-leaf {
  cursor: pointer;
}

.category-crumb__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 8px;
  padding: 0 2px;
  color: rgba(233, 236, 241, 0.86);
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
}

.category-crumb__toggle:hover,
.category-crumb__toggle:focus-visible {
  color: #e0f7fa;
}

.category-crumb__toggle.is-active {
  color: #e1f5fe;
}

.category-crumb.has-children .category-crumb__label-button {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.category-crumb.has-children .category-crumb__toggle {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  margin-left: -1px;
}

.category-crumb.has-children .category-crumb__toggle:hover,
.category-crumb.has-children .category-crumb__toggle:focus-visible {
  border-color: rgba(77, 208, 225, 0.6);
}

.category-error-text {
  padding: 0 12px 6px;
  font-size: 0.78rem;
  color: rgba(255, 138, 101, 0.85);
}

.category-menu-list {
  min-width: 130px;
}

.category-menu-list :deep(.v-list-item--active) {
  background-color: rgba(77, 208, 225, 0.16);
}

.category-menu-list :deep(.v-list-item:hover) {
  background-color: rgba(77, 208, 225, 0.12);
}

.tree-view {
  flex: 1;
  overflow-y: auto;
}

.project-gallery {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
}

.project-gallery.is-drop-target {
  outline: 1px dashed rgba(77, 208, 225, 0.45);
  outline-offset: -4px;
}

.drop-overlay {
  position: absolute;
  inset: 48px 12px 12px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-radius: 12px;
  border: 1px dashed rgba(77, 208, 225, 0.6);
  background: rgba(10, 14, 20, 0.76);
  color: #e9ecf1;
  pointer-events: none;
  text-align: center;
  padding: 16px;
}

.drop-overlay__message {
  font-size: 15px;
  font-weight: 500;
}

.project-gallery.has-drop-feedback .drop-overlay {
  inset: 82px 12px 12px 12px;
}

.drop-feedback {
  margin: 8px 12px 4px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
}

.drop-feedback--success {
  background: rgba(56, 142, 60, 0.16);
  border: 1px solid rgba(129, 199, 132, 0.5);
  color: #c8e6c9;
}

.drop-feedback--error {
  background: rgba(216, 67, 21, 0.16);
  border: 1px solid rgba(255, 138, 101, 0.5);
  color: #ffccbc;
}

.tree-view :deep(.v-treeview-node__root) {
  padding-inline: 10px 8px;
  padding-block: 2px;
}

.tree-view :deep(.v-treeview-node__level) {
  margin-inline-start: 12px;
}

.tree-view :deep(.v-treeview-node__content) {
  min-height: 26px;
  padding-block: 0;
}

.tree-node-title {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tree-node-text {
  flex: 1;
  min-width: 0;
}

.tree-node-spinner {
  flex-shrink: 0;
}

.tree-view :deep(.v-list-item) {
  padding-block: 1px;
  min-height: 22px;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  padding: 10px;
}

.gallery-grid--directories {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}

.toolbar-select-checkbox {
  display: flex;
  align-items: center;
  padding-inline: 4px;
}

.toolbar-select-checkbox :deep(.v-selection-control) {
  margin: 0;
}

.toolbar-select-checkbox :deep(.v-selection-control__input) {
  width: 22px;
  height: 22px;
}

.asset-card {
  display: flex;
  flex-direction: column;
  background-color: rgba(18, 20, 24, 0.9);
  border: 1px solid transparent;
  transition: border-color 150ms ease, transform 150ms ease;
  cursor: pointer;
}

.asset-card:hover {
  border-color: rgba(77, 208, 225, 0.45);
  transform: translateY(-2px);
}

.asset-card.is-selected {
  border-color: rgba(255, 183, 77, 1); /* amber */
  box-shadow: 0 10px 30px rgba(255, 183, 77, 0.32), 0 0 0 4px rgba(255, 183, 77, 0.08);
  transform: translateY(-4px) scale(1.02);
}

.asset-card.is-dragging {
  opacity: 0.75;
  border-color: rgba(77, 208, 225, 0.6);
}

.asset-card.is-downloading {
  border-color: rgba(77, 208, 225, 0.35);
}

.asset-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96px;
  position: relative;
  overflow: hidden;
}

.asset-selected-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(255, 183, 77, 0.12);
  border-radius: 50%;
  backdrop-filter: blur(2px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}

.asset-select-control {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 3;
}

.asset-select-control :deep(.v-selection-control) {
  margin: 0;
  padding: 0;
}

.asset-select-control :deep(.v-selection-control__input) {
  width: 22px;
  height: 22px;
}

.asset-preview-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-progress-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(1px);
}

.asset-error-indicator {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 6px;
}

.asset-info-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.6) 100%);
  backdrop-filter: blur(1px);
}

.asset-title {
  font-size: 0.76rem;
  font-weight: 600;
  color: #ffffff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  line-height: 1.1;
}

.asset-subtitle {
  font-size: 0.66rem;
  color: #ff8a80;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  line-height: 1.1;
}

.placeholder-text {
  color: rgba(233, 236, 241, 0.32);
  font-size: 0.9rem;
  text-align: center;
  margin: auto;
}

.project-tree :deep(.v-toolbar-title) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-inline-start: 0px;
}

.project-tree-subtitle {
  margin-inline-start: 12px !important;
}

.asset-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: rgba(0, 0, 0, 0.35);
  border-radius: 10px;
  backdrop-filter: blur(2px);
  z-index: 2;
}

.asset-progress {
  display: flex;
  align-items: center;
}

.asset-actions :deep(.v-progress-linear) {
  width: 76px;
}

.asset-error-text {
  color: #ff8a80;
  white-space: normal;
}

.asset-status-text {
  font-size: 0.7rem;
  color: rgba(233, 236, 241, 0.7);
  letter-spacing: 0.06em;
}

.delete-dialog-text {
  margin: 0;
  color: rgba(233, 236, 241, 0.88);
  line-height: 1.5;
}

.directory-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  background-color: rgba(18, 20, 24, 0.82);
  border: 1px solid transparent;
  min-height: 120px;
  transition: border-color 150ms ease, transform 150ms ease;
  outline: none;
  cursor: pointer;
  padding: 16px;
}

.directory-card:hover,
.directory-card:focus-visible {
  border-color: rgba(77, 208, 225, 0.45);
  transform: translateY(-2px);
}

.directory-card.is-active {
  border-color: rgba(0, 172, 193, 0.9);
  box-shadow: 0 0 12px rgba(0, 172, 193, 0.35);
}

.directory-card-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.directory-card-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.directory-card-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.directory-card-subtitle {
  font-size: 0.78rem;
  color: rgba(233, 236, 241, 0.7);
}

.directory-card-hint {
  opacity: 0.6;
}


</style>
