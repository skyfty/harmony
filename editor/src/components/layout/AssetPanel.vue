<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import {
  useSceneStore,
  extractProviderIdFromPackageDirectoryId,
  getSingleVisiblePackageProviderId,
  GROUND_NODE_ID,
  ENVIRONMENT_NODE_ID,
} from '@/stores/sceneStore'
import { useUiStore } from '@/stores/uiStore'
import { useBuildToolsStore } from '@/stores/buildToolsStore'
import { detectBuildPresetAssetKind, type BuildPresetAssetKind, isBuildPresetAsset } from '@/utils/buildPresetAsset'
import { usesTransparentThumbnailBackground } from '@/utils/assetThumbnailTransparency'
import {
  ASSETS_ROOT_DIRECTORY_ID,
  PACKAGES_ROOT_DIRECTORY_ID,
  determineAssetCategoryId,
  isPackageProviderDirectoryId,
} from '@/stores/assetCatalog'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { resourceProviders } from '@/resources/projectProviders'
import { assetProvider, invalidateAssetManifestCache } from '@/resources/projectProviders/asset'
import {
  lookupResourceAssetsByHash,
  updateAssetOnServer,
} from '@/api/resourceAssets'
import { mapServerAssetToProjectAsset, type ServerAssetDto } from '@/api/serverAssetTypes'
import { deleteProviderCatalog, loadProviderCatalog, storeProviderCatalog } from '@/stores/providerCatalogCache'
import { getCachedModelObject } from '@schema/modelObjectCache'
import { computeBlobHash, dataUrlToBlob, extractExtension } from '@/utils/blob'
import { prepareLocalAssetImport, type LocalAssetImportPhase, type PreparedLocalAssetImport } from '@/utils/localAssetImport'
import type { SceneNode } from '@schema'
import { getExtensionFromMimeType, inferAssetType } from '@schema'
import { PROTAGONIST_COMPONENT_TYPE } from '@schema/components'
import type { SceneMaterialTextureRef } from '@/types/material'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import { isDragPreviewReady } from '@/utils/dragPreviewRegistry'
import { isAudioAsset, useAudioAssetPreview } from '@/utils/audioAssetPreview'
import { getAssetTypePresentation } from '@/utils/assetTypePresentation'
import { getAssetSourcePresentation } from '@/utils/assetSourcePresentation'
import { isServerBackedProviderId, SERVER_ASSET_PROVIDER_ID } from '@/utils/serverAssetSource'

import UploadAssetsDialog from './UploadAssetsDialog.vue'
import AssetFilterControl from './AssetFilterControl.vue'
import type {
  SeriesFilterOption,
  SizeCategoryFilterOption,
  TagFilterOption,
} from '@/types/asset-filter'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const uiStore = useUiStore()
const buildToolsStore = useBuildToolsStore()
const {
  playingAssetId: previewPlayingAssetId,
  pendingAssetId: previewPendingAssetId,
  stopPreview: stopAudioPreview,
  toggleAssetPreview,
} = useAudioAssetPreview()

const PRESET_PROVIDER_ID = assetProvider.id
const galleryRoot = ref<HTMLElement | null>(null)
const galleryHovered = ref(false)

const {
  projectTree,
  activeDirectoryId,
  selectedAssetId,
  projectPanelTreeSize,
  draggingAssetId,
  selectedNodeId,
} = storeToRefs(sceneStore)

const HIDDEN_ASSET_DIRECTORY_IDS = new Set<string>([
  `${ASSETS_ROOT_DIRECTORY_ID}-lods`,
  `${ASSETS_ROOT_DIRECTORY_ID}-wall-presets`,
  `${ASSETS_ROOT_DIRECTORY_ID}-floor-presets`,
])

function isHiddenAssetDirectory(directoryId: string | null | undefined): boolean {
  return !!directoryId && HIDDEN_ASSET_DIRECTORY_IDS.has(directoryId)
}

function filterHiddenAssetDirectories(nodes: ProjectDirectory[] | undefined): ProjectDirectory[] {
  if (!nodes || !nodes.length) return []
  return nodes
    .map((node): ProjectDirectory | null => {
      if (!node) return null
      if (isHiddenAssetDirectory(node.id)) return null
      const children = node.children ? filterHiddenAssetDirectories(node.children) : undefined
      return {
        ...node,
        ...(children && children.length ? { children } : {}),
      }
    })
    .filter((n): n is ProjectDirectory => !!n)
}

const filteredProjectTree = computed(() => filterHiddenAssetDirectories(projectTree.value))

const openedDirectories = ref<string[]>(restoreOpenedDirectories())
watch(openedDirectories, (ids, previousIds) => {
  const sanitized = sanitizeOpenedDirectories(ids, filteredProjectTree.value)
  if (!arraysEqual(sanitized, ids)) {
    openedDirectories.value = sanitized
    return
  }
  persistOpenedDirectories(sanitized)
  triggerProviderLoadForOpenedDirectories(sanitized, previousIds)
})
watch(filteredProjectTree, () => {
  const sanitized = sanitizeOpenedDirectories(openedDirectories.value, filteredProjectTree.value)
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
let windowResizeListener: (() => void) | null = null
const addPendingAssetId = ref<string | null>(null)
const deleteDialogOpen = ref(false)
const pendingDeleteAssets = ref<ProjectAsset[]>([])
const isBatchDeletion = ref(false)
const selectedAssetIds = ref<string[]>([])
const assetActivationPendingId = ref<string | null>(null)
const draggingDirectoryId = ref<string | null>(null)
const directoryDropHoverId = ref<string | null>(null)
const assetDropHoverId = ref<string | null>(null)
const dropActive = ref(false)
const dropProcessing = ref(false)
type DropImportStage = LocalAssetImportPhase | 'store-asset' | 'reuse-existing' | 'finalize'
type DropImportProgressState = {
  total: number
  completed: number
  failed: number
  currentFileName: string
  currentPhase: string
  currentStep: number
  stepCount: number
}

type DropImportFailureItem = {
  sourceName: string
  reason: string
}

type DropImportOutcome = {
  asset: ProjectAsset
  isNew: boolean
}

type DropImportResult = {
  assets: ProjectAsset[]
  totalSources: number
  newCount: number
  reusedCount: number
  failedItems: DropImportFailureItem[]
}

const DROP_IMPORT_STAGE_ORDER: DropImportStage[] = ['extract-metadata', 'generate-thumbnail', 'store-asset', 'reuse-existing', 'finalize']
const DROP_IMPORT_STAGE_LABELS: Record<DropImportStage, string> = {
  'extract-metadata': 'Extracting asset metadata…',
  'generate-thumbnail': 'Generating thumbnail…',
  'store-asset': 'Caching asset file…',
  'reuse-existing': 'Reusing existing asset…',
  finalize: 'Saving asset metadata…',
}

const ASSET_IMPORT_INTERACTION_LOCK = 'asset-import'
const MAX_IMPORT_FAILURE_DETAILS = 50

const dropImportProgress = ref<DropImportProgressState | null>(null)
let dropFeedbackTimer: number | null = null
let dropImportAbortController: AbortController | null = null
const uploadDialogOpen = ref(false)
const uploadDialogTargetAssetId = ref<string | null>(null)

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
  if (!directoryId) {
    return null
  }
  const directProviderId = extractProviderIdFromPackageDirectoryId(directoryId)
  if (directProviderId) return directProviderId
  const path = findDirectoryPath(filteredProjectTree.value ?? [], directoryId)
  for (const entry of path) {
    const providerId = extractProviderIdFromPackageDirectoryId(entry.id)
    if (providerId) {
      return providerId
    }
  }
  if (path.some((entry) => entry.id === PACKAGES_ROOT_DIRECTORY_ID)) {
    return getSingleVisiblePackageProviderId()
  }
  return null
}

function resolveProviderIdForOpenedDirectory(directoryId: string): string | null {
  if (directoryId === PACKAGES_ROOT_DIRECTORY_ID) {
    return getSingleVisiblePackageProviderId()
  }
  return findProviderIdForDirectoryId(directoryId)
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

async function refreshProviderCatalog(providerId: string): Promise<void> {
  if (providerId === PRESET_PROVIDER_ID) {
    invalidateAssetManifestCache()
  }
  await deleteProviderCatalog(providerId)
  await loadPackageDirectory(providerId, { force: true })
}

async function refreshPresetProviderAssets(): Promise<void> {
  if (!PRESET_PROVIDER_ID) {
    return
  }
  if (presetRefreshPending.value) {
    return
  }
  presetRefreshPending.value = true
  try {
    await refreshProviderCatalog(PRESET_PROVIDER_ID)
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
    const providerId = resolveProviderIdForOpenedDirectory(id)
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
  const filtered = ids.filter((id, index) => available.has(id) && ids.indexOf(id) === index)
  return filtered.length ? filtered : [PACKAGES_ROOT_DIRECTORY_ID]
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

function canMutateDirectoryId(directoryId: string | null | undefined): boolean {
  return !!directoryId
    && isWritableLocalDirectoryId(directoryId)
    && directoryId !== ASSETS_ROOT_DIRECTORY_ID
}

function pruneTrackedElementMap<T extends HTMLElement>(
  elements: Record<string, T>,
  visibleIds: Set<string>,
): Record<string, T> {
  const nextElements: Record<string, T> = {}
  for (const [id, element] of Object.entries(elements)) {
    if (visibleIds.has(id)) {
      nextElements[id] = element
    }
  }
  return nextElements
}

function pruneTrackedIdSet(ids: Set<string>, visibleIds: Set<string>): Set<string> {
  const next = new Set<string>()
  for (const id of ids) {
    if (visibleIds.has(id)) {
      next.add(id)
    }
  }
  return next
}

function normalizeTextValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toggleSelectionValue(values: string[], value: string): string[] {
  const next = new Set(values)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return Array.from(next)
}

function filterAvailableSelectionValues<T extends { value: string }>(values: string[], options: T[]): string[] {
  const available = new Set(options.map((option) => option.value))
  return values.filter((value) => available.has(value))
}

function mergeUniqueValues(values: string[], extraValues: string[]): string[] {
  return Array.from(new Set([...values, ...extraValues]))
}

function removeValuesFromSelection(values: string[], removedValues: string[]): string[] {
  if (!removedValues.length) {
    return values
  }
  const removedSet = new Set(removedValues)
  return values.filter((value) => !removedSet.has(value))
}

function clearSelectedAssets(): void {
  selectedAssetIds.value = []
}

function pruneSelectableAssetSelections(assetIds: string[], assets: ProjectAsset[]): string[] {
  const availableIds = new Set(assets.map((asset) => asset.id))
  return assetIds.filter((id) => {
    if (!availableIds.has(id)) {
      return false
    }
    const asset = assets.find((item) => item.id === id)
    return asset ? canDeleteAsset(asset) : false
  })
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

function activateBuildPresetAsset(asset: ProjectAsset, kind: BuildPresetAssetKind): boolean {
  sceneStore.selectAsset(asset.id)
  sceneStore.setSelection([])

  if (kind === 'wall') {
    buildToolsStore.setWallBuildShape('line')
  } else if (kind === 'floor') {
    buildToolsStore.setFloorBuildShape('polygon')
  } else if (kind === 'landform') {
    buildToolsStore.setLandformBuildShape('polygon')
  }

  const activated = kind === 'wall'
    ? buildToolsStore.setWallBrushPresetAssetId(asset.id, { activate: true })
    : kind === 'floor'
      ? buildToolsStore.setFloorBrushPresetAssetId(asset.id, { activate: true })
      : kind === 'landform'
        ? buildToolsStore.setLandformBrushPresetAssetId(asset.id, { activate: true })
        : buildToolsStore.setRoadBrushPresetAssetId(asset.id, { activate: true })

  uiStore.setActiveSelectionContext(activated ? `build-tool:${kind}` : 'asset-panel')
  return activated
}

async function selectAsset(asset: ProjectAsset) {
  const cacheId = resolveAssetCacheId(asset)
  if (assetActivationPendingId.value === cacheId) {
    return
  }

  // For model-like assets, ensure the asset is downloaded/cached before selecting.
  if (asset.type === 'model' || asset.type === 'mesh') {
    const prepared = prepareAssetForOperations(asset)
    const preparedCacheId = resolveAssetCacheId(prepared)
    if (assetCacheStore.hasCache(preparedCacheId) && !isAssetDownloading(prepared)) {
      sceneStore.selectAsset(prepared.id)
      uiStore.setActiveSelectionContext('asset-panel')
      return
    }
    if (assetActivationPendingId.value === preparedCacheId || isAssetDownloading(prepared)) {
      return
    }

    assetActivationPendingId.value = preparedCacheId
    try {
      assetCacheStore.setError(prepared.id, null)
      await ensureAssetCached(prepared)
    } catch (error) {
      const message = (error as Error).message ?? 'Failed to load asset'
      assetCacheStore.setError(prepared.id, message)
      console.error('Failed to cache asset before select', error)
      return
    } finally {
      assetActivationPendingId.value = null
    }
    return
  }

  // If a wall/floor prefab preset is selected, immediately activate the corresponding
  // build tool and apply the preset. This intentionally switches context from asset-panel
  // to build-tool so the user can edit directly in the viewport.
  if (asset.type === 'prefab') {
    const presetKind = detectBuildPresetAssetKind(asset)
    if (presetKind) {
      activateBuildPresetAsset(asset, presetKind)
      return
    }

    const prepared = prepareAssetForOperations(asset)
    const preparedCacheId = resolveAssetCacheId(prepared)
    if (assetCacheStore.hasCache(preparedCacheId) && !isAssetDownloading(prepared)) {
      sceneStore.selectAsset(prepared.id)
      uiStore.setActiveSelectionContext('asset-panel')
      return
    }
    if (assetActivationPendingId.value === preparedCacheId || isAssetDownloading(prepared)) {
      return
    }

    assetActivationPendingId.value = preparedCacheId
    try {
      assetCacheStore.setError(prepared.id, null)
      await sceneStore.preparePrefabAsset(prepared.id, {
        prefabAssetIdForDownloadProgress: prepared.id,
      })
    } catch (error) {
      const message = (error as Error).message ?? 'Failed to prepare prefab asset'
      assetCacheStore.setError(prepared.id, message)
      console.error('Failed to prepare prefab before select', error)
      return
    } finally {
      assetActivationPendingId.value = null
    }
    return
  }

  if (asset.type === 'lod') {
    const prepared = prepareAssetForOperations(asset)
    const preparedCacheId = resolveAssetCacheId(prepared)
    if (assetCacheStore.hasCache(preparedCacheId) && !isAssetDownloading(prepared)) {
      sceneStore.selectAsset(prepared.id)
      uiStore.setActiveSelectionContext('asset-panel')
      return
    }
    if (assetActivationPendingId.value === preparedCacheId || isAssetDownloading(prepared)) {
      return
    }

    assetActivationPendingId.value = preparedCacheId
    try {
      assetCacheStore.setError(prepared.id, null)
      await sceneStore.prepareLodAsset(prepared.id)
    } catch (error) {
      const message = (error as Error).message ?? 'Failed to prepare LOD asset'
      assetCacheStore.setError(prepared.id, message)
      console.error('Failed to prepare LOD before select', error)
      return
    } finally {
      assetActivationPendingId.value = null
    }
    return
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

function isAssetReadyForMouseAction(asset: ProjectAsset): boolean {
  if (isAssetDownloading(asset)) {
    return false
  }
  if (asset.type === 'prefab' || MODEL_ASSET_TYPES.has(asset.type)) {
    return assetCacheStore.hasCache(resolveAssetCacheId(asset))
  }
  return true
}

function isServerManagedAsset(asset: ProjectAsset | null | undefined): boolean {
  if (!asset) {
    return false
  }
  if (asset.source?.type === 'server') {
    return true
  }
  if (asset.source?.type === 'package' && isServerBackedProviderId(asset.source.providerId)) {
    return true
  }
  const providerId = providerIdForAsset(asset)
  return providerId === PRESET_PROVIDER_ID || providerId === SERVER_ASSET_PROVIDER_ID
}

function canEditAssetMetadata(asset: ProjectAsset | null | undefined): boolean {
  return !!asset && asset.source?.type === 'local' && !isServerManagedAsset(asset)
}

function canDeleteAsset(asset: ProjectAsset) {
  if (isServerManagedAsset(asset)) {
    return false
  }
  if (asset.internal === true) {
    return false
  }
  if (providerIdForAsset(asset) === PRESET_PROVIDER_ID) {
    return false
  }
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
  if (asset.type === 'lod') {
    await sceneStore.prepareLodAsset(asset)
    return
  }
  if (assetCacheStore.hasCache(asset.id)) {
    return
  }
  const entry = await assetCacheStore.downloadProjectAsset(asset)
  if (!assetCacheStore.hasCache(asset.id)) {
    throw new Error(entry.error ?? 'Asset download is not complete')
  }
}

const MODEL_ASSET_TYPES = new Set<ProjectAsset['type']>(['model', 'mesh', 'lod'])
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
  if (node.dynamicMesh?.type === 'Region') {
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
    return isAssetReadyForMouseAction(asset)
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
      const presetKind = detectBuildPresetAssetKind(preparedAsset)
      if (presetKind) {
        activateBuildPresetAsset(preparedAsset, presetKind)
        return
      }
      await sceneStore.preparePrefabAsset(preparedAsset.id, {
        prefabAssetIdForDownloadProgress: preparedAsset.id,
      })
      const spawnPosition = parentNode?.id ? sceneStore.getNodeWorldCenter(parentNode.id) : null
      await sceneStore.spawnPrefabWithPlaceholder(preparedAsset.id, spawnPosition, { parentId: null })
      return
    }
    await ensureAssetCached(preparedAsset)
    if (MODEL_ASSET_TYPES.has(preparedAsset.type)) {
      const node = await sceneStore.addPlaceableAssetNode({ asset: preparedAsset, parentId: parentNode?.id ?? undefined })
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
      const materialDefinition = await sceneStore.ensureMaterialAssetDefinitionLoaded(preparedAsset.id)
      if (!materialDefinition) {
        throw new Error('Failed to load material asset definition')
      }
      const primary = currentNode.materials?.[0] ?? null
      const slot = primary ?? sceneStore.addNodeMaterial(currentNode.id)
      const applied = slot
        ? Boolean(await sceneStore.applyMaterialAssetToNodeMaterialSlot(currentNode.id, slot.id, preparedAsset.id))
        : false
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

function primePrefabAsset(asset: ProjectAsset): void {
  const preparedAsset = prepareAssetForOperations(asset)
  if (preparedAsset.type !== 'prefab' || isBuildPresetAsset(preparedAsset)) {
    return
  }
  assetCacheStore.setError(preparedAsset.id, null)
  void sceneStore.preparePrefabAsset(preparedAsset.id, {
    prefabAssetIdForDownloadProgress: preparedAsset.id,
  }).catch((error) => {
    const message = (error as Error).message ?? 'Failed to prepare prefab asset'
    assetCacheStore.setError(preparedAsset.id, message)
    console.error('Failed to prepare prefab before drag preview', error)
  })
}

void handleAddAsset

function refreshGallery() {
  const providerId = activeProviderId.value
  if (providerId) {
    void refreshProviderCatalog(providerId)
  }
}

function handleAssetDragStart(event: DragEvent, asset: ProjectAsset) {
  const preparedAsset = prepareAssetForOperations(asset)
  if (preparedAsset.type === 'prefab') {
    primePrefabAsset(preparedAsset)
  }
  if (!isAssetReadyForMouseAction(preparedAsset) || assetActivationPendingId.value === resolveAssetCacheId(preparedAsset)) {
    event.preventDefault()
    return
  }
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
  directoryDropHoverId.value = null
  assetDropHoverId.value = null
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
  dragSuppressionSourceAssetId = sourceAssetId
  dragSuppressionPreparedAssetId = supportsSuppression ? preparedAsset.id : null
  dragSuppressionPreparedAssetType = supportsSuppression ? preparedAsset.type : null
  dragSuppressionActive = false
  if (dragSuppressionPreparedAssetId) {
    attachDragSuppressionListeners()
  }
  if (preparedAsset.type === 'lod') {
    void sceneStore.resolvePlaceableAsset(preparedAsset).then((resolved) => {
      if (dragSuppressionSourceAssetId !== sourceAssetId || dragSuppressionPreparedAssetType !== 'lod') {
        return
      }
      dragSuppressionPreparedAssetId = resolved.modelAsset.id
    }).catch(() => {
      // Leave the LOD asset id in place; viewport drag preview still resolves the first model asynchronously.
    })
  }
}

function isAssetSelected(assetId: string) {
  return selectedAssetIds.value.includes(assetId)
}

function toggleAssetSelection(asset: ProjectAsset) {
  const assetId = asset.id
  if (!canDeleteAsset(asset)) {
    return
  }
  selectedAssetIds.value = toggleSelectionValue(selectedAssetIds.value, assetId)
}

function setSelectableAssetSelection(select: boolean) {
  const selectableIds = selectableAssetIds.value
  if (!selectableIds.length) {
    return
  }
  if (select) {
    selectedAssetIds.value = mergeUniqueValues(selectedAssetIds.value, selectableIds)
  } else {
    selectedAssetIds.value = removeValuesFromSelection(selectedAssetIds.value, selectableIds)
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

function closeDeleteAssetsDialog(): void {
  deleteDialogOpen.value = false
  pendingDeleteAssets.value = []
  isBatchDeletion.value = false
}

function partitionDeleteTargets(assets: ProjectAsset[]): { localAssetIds: string[]; presetAssetIds: string[] } {
  const localAssetIds: string[] = []
  const presetAssetIds: string[] = []
  assets.forEach((asset) => {
    if (providerIdForAsset(asset) === PRESET_PROVIDER_ID) {
      presetAssetIds.push(asset.id)
    } else {
      localAssetIds.push(asset.id)
    }
  })
  return { localAssetIds, presetAssetIds }
}

function removeDeletedAssetIds(removedIds: string[]): void {
  if (!removedIds.length) {
    return
  }
  sceneStore.selectAsset(null)
  searchResults.value = searchResults.value.filter((item) => !removedIds.includes(item.id))
  selectedAssetIds.value = removeValuesFromSelection(selectedAssetIds.value, removedIds)
}

function requestDeleteSelection() {
  const assets = selectedAssets.value.filter((asset) => canDeleteAsset(asset))
  if (!assets.length) {
    return
  }
  openDeleteDialog(assets, true)
}

function cancelDeleteAssets() {
  closeDeleteAssetsDialog()
}

async function performDeleteAssets() {
  const assets = pendingDeleteAssets.value.filter((asset) => canDeleteAsset(asset))
  if (!assets.length) {
    cancelDeleteAssets()
    return
  }
  try {
    const { localAssetIds } = partitionDeleteTargets(assets)

    let removedIds: string[] = []
    if (localAssetIds.length) {
      const removedLocalIds = await sceneStore.deleteProjectAssets(localAssetIds)
      removedIds = removedIds.concat(removedLocalIds)
    }

    removeDeletedAssetIds(removedIds)
  } catch (error) {
    console.error('Failed to delete assets', error)
  } finally {
    cancelDeleteAssets()
  }
}

function isAssetDragging(assetId: string) {
  return draggingAssetId.value === assetId
}

interface CategoryBreadcrumbItem {
  id: string | null
  name: string
  directory: ProjectDirectory | null
  depth: number
  children: ProjectDirectory[]
}

function findDirectoryPath(directories: ProjectDirectory[], targetId: string | null): ProjectDirectory[] {
  if (!targetId) {
    return []
  }
  const path: ProjectDirectory[] = []
  const visit = (nodes: ProjectDirectory[]): boolean => {
    for (const node of nodes) {
      path.push(node)
      if (node.id === targetId) {
        return true
      }
      if (node.children?.length && visit(node.children)) {
        return true
      }
      path.pop()
    }
    return false
  }
  return visit(directories) ? [...path] : []
}

const activeDirectoryPath = computed(() => findDirectoryPath(filteredProjectTree.value ?? [], activeDirectoryId.value ?? null))
const visibleCurrentDirectory = computed(() => {
  const targetId = activeDirectoryId.value
  return targetId ? findDirectoryById(filteredProjectTree.value ?? [], targetId) : filteredProjectTree.value[0] ?? null
})
const visibleCurrentAssets = computed(() => visibleCurrentDirectory.value?.assets ?? [])

const categoryBreadcrumbs = computed<CategoryBreadcrumbItem[]>(() => {
  const roots = filteredProjectTree.value ?? []
  const path = activeDirectoryPath.value
  const items: CategoryBreadcrumbItem[] = [
    {
      id: null,
      name: 'All Assets',
      directory: null,
      depth: 0,
      children: roots,
    },
  ]
  path.forEach((directory, index) => {
    items.push({
      id: directory.id,
      name: directory.name,
      directory,
      depth: index + 1,
      children: directory.children ?? [],
    })
  })
  return items
})

function handleBreadcrumbClick(index: number): void {
  if (index <= 0) {
    sceneStore.setActiveDirectory(ASSETS_ROOT_DIRECTORY_ID)
    return
  }
  const crumb = categoryBreadcrumbs.value[index]
  if (crumb?.id) {
    sceneStore.setActiveDirectory(crumb.id)
  }
}

function handleBreadcrumbChildSelect(_crumbIndex: number, directory: ProjectDirectory): void {
  if (!directory?.id) {
    return
  }
  sceneStore.setActiveDirectory(directory.id)
}

function isBreadcrumbIndexActive(index: number): boolean {
  if (index === 0) {
    return !activeDirectoryId.value || activeDirectoryId.value === ASSETS_ROOT_DIRECTORY_ID
  }
  return categoryBreadcrumbs.value[index]?.id === activeDirectoryId.value
}

function isCategoryActive(categoryId: string): boolean {
  return activeDirectoryPath.value.some((entry) => entry.id === categoryId)
}

function buildCategoryLabel(directory: ProjectDirectory | null): string {
  if (!directory) {
    return 'All Assets'
  }
  return directory.name
}

function categoryTooltip(crumb: CategoryBreadcrumbItem): string {
  return buildCategoryLabel(crumb.directory)
}

onMounted(() => {
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

onMounted(() => {
  refreshDirectoryNameTruncation()
  refreshAssetNameTruncation()
  if (typeof window === 'undefined') {
    return
  }
  windowResizeListener = () => {
    refreshDirectoryNameTruncation()
    refreshAssetNameTruncation()
  }
  window.addEventListener('resize', windowResizeListener)
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
const baseDisplayedAssets = computed(() => {
  const assets = isSearchActive.value ? searchResults.value : visibleCurrentAssets.value
  return assets
})
const categoryFilteredAssets = computed(() => baseDisplayedAssets.value)

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
    const seriesId = normalizeTextValue(asset.seriesId)
    const seriesName = normalizeTextValue(asset.seriesName)
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
  const seriesId = normalizeTextValue(asset.seriesId)
  const seriesName = normalizeTextValue(asset.seriesName)
  if (selectedValue === SERIES_UNASSIGNED_VALUE) {
    return !seriesId.length && !seriesName.length
  }
  if (selectedValue.startsWith(SERIES_ID_PREFIX)) {
    const id = selectedValue.slice(SERIES_ID_PREFIX.length)
    return seriesId === id
  }
  if (selectedValue.startsWith(SERIES_NAME_PREFIX)) {
    const name = selectedValue.slice(SERIES_NAME_PREFIX.length)
    return seriesName === name
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
  if (!filterAvailableSelectionValues([selectedSeriesValue.value], options).length) {
    selectedSeriesValue.value = null
  }
})

const sizeCategoryOptions = computed<SizeCategoryFilterOption[]>(() => {
  const map = new Map<string, SizeCategoryFilterOption>()
  let hasUnassigned = false
  seriesFilteredAssets.value.forEach((asset) => {
    const size = normalizeTextValue(asset.sizeCategory)
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
  selectedSizeCategories.value = toggleSelectionValue(selectedSizeCategories.value, value)
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
  const size = normalizeTextValue(asset.sizeCategory)
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
  const filtered = filterAvailableSelectionValues(selectedSizeCategories.value, options)
  if (filtered.length !== selectedSizeCategories.value.length) {
    selectedSizeCategories.value = filtered
  }
})

function toggleTagFilter(value: string): void {
  if (!value) {
    return
  }
  tagFilterValues.value = toggleSelectionValue(tagFilterValues.value, value)
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
  selectedAssets.value.filter((asset) => canEditAssetMetadata(asset)),
)

function resolveAssetById(assetId: string | null | undefined): ProjectAsset | null {
  if (!assetId) {
    return null
  }
  return displayedAssets.value.find((asset) => asset.id === assetId) ?? sceneStore.getAsset(assetId) ?? null
}

const uploadDialogAssets = computed(() => {
  const targetId = uploadDialogTargetAssetId.value
  if (!targetId) {
    return uploadableSelectedAssets.value
  }
  const target = resolveAssetById(targetId)
  if (!target) {
    return []
  }
  return [target]
})

const canEditSelectedAssetMetadata = computed(() => uploadableSelectedAssets.value.length > 0)

function assetMatchesSelectedTags(asset: ProjectAsset, selectedValues: string[]): boolean {
  if (!selectedValues.length) {
    return true
  }
  const assetIds = new Set((asset.tagIds ?? []).filter((id) => typeof id === 'string'))
  const assetNames = new Set((asset.tags ?? []).map((name) => normalizeTextValue(name).toLowerCase()).filter(Boolean))
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

const directoryTitleElements = ref<Record<string, HTMLElement>>({})
const truncatedDirectoryNameIds = ref<Set<string>>(new Set())

function updateDirectoryNameTruncation(directoryId: string): void {
  const element = directoryTitleElements.value[directoryId]
  if (!element) {
    return
  }
  const isTruncated = element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1
  const currentlyTruncated = truncatedDirectoryNameIds.value.has(directoryId)
  if (isTruncated === currentlyTruncated) {
    return
  }
  const next = new Set(truncatedDirectoryNameIds.value)
  if (isTruncated) {
    next.add(directoryId)
  } else {
    next.delete(directoryId)
  }
  truncatedDirectoryNameIds.value = next
}

function refreshDirectoryNameTruncation(): void {
  void nextTick(() => {
    for (const directory of galleryDirectories.value) {
      updateDirectoryNameTruncation(directory.id)
    }
  })
}

const assetTitleElements = ref<Record<string, HTMLElement>>({})
const truncatedAssetNameIds = ref<Set<string>>(new Set())

function updateAssetNameTruncation(assetId: string): void {
  const element = assetTitleElements.value[assetId]
  if (!element) {
    return
  }
  const isTruncated = element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1
  const currentlyTruncated = truncatedAssetNameIds.value.has(assetId)
  if (isTruncated === currentlyTruncated) {
    return
  }
  const next = new Set(truncatedAssetNameIds.value)
  if (isTruncated) {
    next.add(assetId)
  } else {
    next.delete(assetId)
  }
  truncatedAssetNameIds.value = next
}

function refreshAssetNameTruncation(): void {
  void nextTick(() => {
    for (const asset of displayedAssets.value) {
      updateAssetNameTruncation(asset.id)
    }
  })
}

watch(
  displayedAssets,
  (assets) => {
    const visibleIds = new Set(assets.map((asset) => asset.id))

    assetTitleElements.value = pruneTrackedElementMap(assetTitleElements.value, visibleIds)
    truncatedAssetNameIds.value = pruneTrackedIdSet(truncatedAssetNameIds.value, visibleIds)

    refreshAssetNameTruncation()
  },
  { flush: 'post' },
)

watch(tagOptions, (options) => {
  if (!tagFilterValues.value.length) {
    return
  }
  const filtered = filterAvailableSelectionValues(tagFilterValues.value, options)
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
  return visibleCurrentDirectory.value?.children ?? []
})

watch(
  galleryDirectories,
  (directories) => {
    const visibleIds = new Set(directories.map((directory) => directory.id))

    directoryTitleElements.value = pruneTrackedElementMap(directoryTitleElements.value, visibleIds)
    truncatedDirectoryNameIds.value = pruneTrackedIdSet(truncatedDirectoryNameIds.value, visibleIds)

    refreshDirectoryNameTruncation()
  },
  { flush: 'post' },
)

const DIRECTORY_DRAG_MIME = 'application/x-harmony-asset-directory'
const AUTO_FOLDER_PREFIX = 'New Folder'

function isLocalDirectoryId(directoryId: string | null | undefined): boolean {
  if (!directoryId) {
    return false
  }
  if (directoryId === ASSETS_ROOT_DIRECTORY_ID) {
    return true
  }
  return !!sceneStore.assetManifest?.directoriesById?.[directoryId]
}

function isWritableLocalDirectoryId(directoryId: string | null | undefined): boolean {
  if (!isLocalDirectoryId(directoryId)) {
    return false
  }
  if (directoryId === ASSETS_ROOT_DIRECTORY_ID) {
    return true
  }
  const directoryPath = findDirectoryPath(projectTree.value ?? [], directoryId ?? null) ?? []
  return !directoryPath.some((entry) => isPackageProviderDirectoryId(entry.id))
}

function isPresetDirectoryMutable(_directoryId: string | null | undefined): boolean {
  return false
}

function isDraggableDirectoryId(directoryId: string | null | undefined): boolean {
  return canMutateDirectoryId(directoryId)
}

function getAssetMutationScope(asset: ProjectAsset | null | undefined): 'local' | null {
  if (canEditAssetMetadata(asset)) {
    return 'local'
  }
  return null
}

function getDirectoryMutationScope(directoryId: string | null | undefined): 'local' | null {
  if (isWritableLocalDirectoryId(directoryId)) {
    return 'local'
  }
  return null
}

const canCreateDirectory = computed(() => {
  const directoryId = activeDirectoryId.value ?? ASSETS_ROOT_DIRECTORY_ID
  return isWritableLocalDirectoryId(directoryId)
})
const canRenameDirectory = computed(() => canMutateDirectoryId(activeDirectoryId.value))
const canDeleteDirectory = canRenameDirectory
type DirectoryDialogMode = 'create' | 'rename'

const directoryDialogOpen = ref(false)
const directoryDialogMode = ref<DirectoryDialogMode>('create')
const directoryDialogName = ref('')
const directoryDialogTargetId = ref<string | null>(null)
const directoryDeleteDialogOpen = ref(false)
const directoryDeleteTargetId = ref<string | null>(null)

const directoryDialogTitle = computed(() => (directoryDialogMode.value === 'create' ? 'Create Folder' : 'Rename Folder'))
const directoryDialogConfirmLabel = computed(() => (directoryDialogMode.value === 'create' ? 'Create' : 'Rename'))
const directoryDeleteTarget = computed(() => {
  const targetId = directoryDeleteTargetId.value
  return targetId ? findDirectoryById(filteredProjectTree.value ?? [], targetId) : null
})

function openDirectoryDialog(mode: DirectoryDialogMode, targetDirectoryId: string, name: string): void {
  directoryDialogMode.value = mode
  directoryDialogTargetId.value = targetDirectoryId
  directoryDialogName.value = name
  directoryDialogOpen.value = true
}

function openUploadDialogForAsset(assetId: string): void {
  const asset = resolveAssetById(assetId)
  if (!canEditAssetMetadata(asset)) {
    return
  }
  uploadDialogTargetAssetId.value = assetId
  uploadDialogOpen.value = true
}

function promptCreateDirectory() {
  if (!canCreateDirectory.value) {
    return
  }
  openDirectoryDialog('create', activeDirectoryId.value ?? ASSETS_ROOT_DIRECTORY_ID, 'New Folder')
}

function promptRenameDirectory(directoryId?: string | null) {
  const targetDirectoryId = directoryId ?? activeDirectoryId.value
  if (!targetDirectoryId || !canMutateDirectoryId(targetDirectoryId)) {
    return
  }
  const directory = filteredProjectTree.value.length ? findDirectoryById(filteredProjectTree.value, targetDirectoryId) : null
  openDirectoryDialog('rename', targetDirectoryId, directory?.name ?? 'Folder')
}

function promptDeleteDirectory(directoryId?: string | null) {
  const targetDirectoryId = directoryId ?? activeDirectoryId.value
  if (!canMutateDirectoryId(targetDirectoryId)) {
    return
  }
  directoryDeleteTargetId.value = targetDirectoryId
  directoryDeleteDialogOpen.value = true
}

function cancelDirectoryDialog() {
  directoryDialogOpen.value = false
  directoryDialogTargetId.value = null
  directoryDialogName.value = ''
}

function cancelDirectoryDeleteDialog() {
  directoryDeleteDialogOpen.value = false
  directoryDeleteTargetId.value = null
}

async function createDirectoryAtTarget(parentId: string, name: string): Promise<void> {
  if (isWritableLocalDirectoryId(parentId)) {
    const directoryId = sceneStore.createAssetDirectory(name, parentId)
    if (directoryId) {
      ensureDirectoryOpened(directoryId)
    }
  }
}

async function renameDirectoryById(directoryId: string, name: string): Promise<void> {
  if (isWritableLocalDirectoryId(directoryId)) {
    sceneStore.renameAssetDirectory(directoryId, name)
  }
}

async function deleteDirectoryById(directoryId: string): Promise<void> {
  if (isWritableLocalDirectoryId(directoryId)) {
    const result = sceneStore.deleteAssetDirectory(directoryId)
    if (result.removedAssetIds.length) {
      selectedAssetIds.value = selectedAssetIds.value.filter((id) => !result.removedAssetIds.includes(id))
    }
  }
}

async function submitDirectoryDialog() {
  const name = directoryDialogName.value.trim()
  if (!name.length) {
    return
  }
  try {
    if (directoryDialogMode.value === 'create') {
      const parentId = directoryDialogTargetId.value ?? activeDirectoryId.value ?? ASSETS_ROOT_DIRECTORY_ID
      await createDirectoryAtTarget(parentId, name)
    } else if (directoryDialogTargetId.value) {
      await renameDirectoryById(directoryDialogTargetId.value, name)
    }
    cancelDirectoryDialog()
  } catch (error) {
    console.error('Failed to submit directory dialog', error)
  }
}

function cancelDeleteDirectory() {
  cancelDirectoryDeleteDialog()
}

async function confirmDeleteDirectory() {
  const targetDirectoryId = directoryDeleteTargetId.value
  if (!targetDirectoryId) {
    cancelDirectoryDeleteDialog()
    return
  }
  try {
    await deleteDirectoryById(targetDirectoryId)
  } catch (error) {
    console.error('Failed to delete directory', error)
  }
  cancelDirectoryDeleteDialog()
}

function promptRenameAsset(assetId?: string) {
  if (!assetId) return
  const asset = resolveAssetById(assetId)
  if (asset && canEditAssetMetadata(asset)) {
    openUploadDialogForAsset(asset.id)
  }
}

function promptDeleteAsset(asset: ProjectAsset) {
  if (!canDeleteAsset(asset)) {
    return
  }
  openDeleteDialog([asset], false)
}

function findDirectoryById(directories: ProjectDirectory[], id: string): ProjectDirectory | null {
  for (const directory of directories) {
    if (directory.id === id) {
      return directory
    }
    if (directory.children?.length) {
      const nested = findDirectoryById(directory.children, id)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function handleDirectoryDragStart(event: DragEvent, directoryId: string) {
  if (!event.dataTransfer || !isDraggableDirectoryId(directoryId)) {
    return
  }
  draggingDirectoryId.value = directoryId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(DIRECTORY_DRAG_MIME, directoryId)
}

function handleDirectoryDragEnd() {
  draggingDirectoryId.value = null
  directoryDropHoverId.value = null
}

function parseDraggedDirectoryId(dataTransfer: DataTransfer | null | undefined): string {
  const payload = dataTransfer?.getData(DIRECTORY_DRAG_MIME)?.trim() ?? ''
  if (payload.length) {
    return payload
  }
  return draggingDirectoryId.value?.trim() ?? ''
}

function parseDraggedAssetId(dataTransfer: DataTransfer | null | undefined): string {
  const payload = dataTransfer?.getData(ASSET_DRAG_MIME) ?? ''
  if (payload.trim().length) {
    try {
      const parsed = JSON.parse(payload) as { assetId?: unknown }
      if (typeof parsed.assetId === 'string' && parsed.assetId.trim().length) {
        return parsed.assetId.trim()
      }
    } catch {
      // Ignore malformed payload and fallback to store drag state.
    }
  }
  return draggingAssetId.value?.trim() ?? ''
}

function clearAssetDropHover(assetId?: string) {
  if (!assetId || assetDropHoverId.value === assetId) {
    assetDropHoverId.value = null
  }
}

function getNextAutoFolderName(): string {
  const siblings = visibleCurrentDirectory.value?.children ?? []
  const usedNumbers = new Set<number>()
  for (const directory of siblings) {
    const match = /^new folder\s+(\d+)$/i.exec(directory.name.trim())
    if (!match) {
      continue
    }
    const value = Number.parseInt(match[1] ?? '', 10)
    if (Number.isFinite(value) && value > 0) {
      usedNumbers.add(value)
    }
  }
  let index = 1
  while (usedNumbers.has(index)) {
    index += 1
  }
  return `${AUTO_FOLDER_PREFIX} ${index}`
}

function canAutoGroupAssetsInCurrentDirectory(_scope: 'local'): boolean {
  const directoryId = activeDirectoryId.value ?? ASSETS_ROOT_DIRECTORY_ID
  return isWritableLocalDirectoryId(directoryId)
}

function allowAssetToAssetDrop(event: DragEvent, targetAssetId: string): boolean {
  if (!event.dataTransfer) {
    clearAssetDropHover(targetAssetId)
    return false
  }
  const types = Array.from(event.dataTransfer.types ?? [])
  if (!types.includes(ASSET_DRAG_MIME)) {
    clearAssetDropHover(targetAssetId)
    return false
  }
  const draggedAssetId = parseDraggedAssetId(event.dataTransfer)
  if (!draggedAssetId || draggedAssetId === targetAssetId) {
    clearAssetDropHover(targetAssetId)
    return false
  }
  const draggedAsset = sceneStore.getAsset(draggedAssetId)
  const targetAsset = sceneStore.getAsset(targetAssetId)
  const draggedScope = getAssetMutationScope(draggedAsset)
  const targetScope = getAssetMutationScope(targetAsset)
  if (!draggedScope || draggedScope !== targetScope || !canAutoGroupAssetsInCurrentDirectory(draggedScope)) {
    clearAssetDropHover(targetAssetId)
    return false
  }
  const visibleAssetIds = new Set(displayedAssets.value.map((asset) => asset.id))
  if (!visibleAssetIds.has(draggedAssetId) || !visibleAssetIds.has(targetAssetId)) {
    clearAssetDropHover(targetAssetId)
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'move'
  assetDropHoverId.value = targetAssetId
  return true
}

function handleAssetCardDragEnter(event: DragEvent, targetAssetId: string) {
  allowAssetToAssetDrop(event, targetAssetId)
}

function handleAssetCardDragOver(event: DragEvent, targetAssetId: string) {
  allowAssetToAssetDrop(event, targetAssetId)
}

function handleAssetCardDragLeave(_event: DragEvent, targetAssetId: string) {
  clearAssetDropHover(targetAssetId)
}

async function handleAssetCardDrop(event: DragEvent, targetAssetId: string) {
  if (!allowAssetToAssetDrop(event, targetAssetId) || !event.dataTransfer) {
    return
  }
  const draggedAssetId = parseDraggedAssetId(event.dataTransfer)
  if (!draggedAssetId || draggedAssetId === targetAssetId) {
    clearAssetDropHover(targetAssetId)
    return
  }

  const draggedAsset = sceneStore.getAsset(draggedAssetId)
  const targetAsset = sceneStore.getAsset(targetAssetId)
  const scope = getAssetMutationScope(draggedAsset)
  if (!draggedAsset || !targetAsset || !scope || scope !== getAssetMutationScope(targetAsset)) {
    clearAssetDropHover(targetAssetId)
    return
  }

  const parentDirectoryId = activeDirectoryId.value ?? ASSETS_ROOT_DIRECTORY_ID
  const preservedActiveDirectoryId = activeDirectoryId.value
  const folderName = getNextAutoFolderName()

  try {
    if (scope === 'local' && isWritableLocalDirectoryId(parentDirectoryId)) {
      const createdDirectoryId = sceneStore.createAssetDirectory(folderName, parentDirectoryId)
      if (!createdDirectoryId) {
        return
      }
      const assetIds = Array.from(new Set([draggedAssetId, targetAssetId]))
      assetIds.forEach((assetId) => {
        sceneStore.moveProjectAssetToDirectory(assetId, createdDirectoryId)
      })
      ensureDirectoryOpened(parentDirectoryId)
      ensureDirectoryOpened(createdDirectoryId)
      if (preservedActiveDirectoryId) {
        sceneStore.setActiveDirectory(preservedActiveDirectoryId)
      }
    }
  } catch (error) {
    console.error('Failed to auto group assets into folder', error)
  } finally {
    clearAssetDropHover(targetAssetId)
  }
}

function setDirectoryDropHover(directoryId: string | null) {
  directoryDropHoverId.value = directoryId
}

function clearDirectoryDropHover(directoryId?: string) {
  if (!directoryId || directoryDropHoverId.value === directoryId) {
    directoryDropHoverId.value = null
  }
}

function allowDirectoryDrop(event: DragEvent, directoryId: string) {
  if (!event.dataTransfer) {
    clearDirectoryDropHover(directoryId)
    return false
  }
  const targetScope = getDirectoryMutationScope(directoryId)
  if (!targetScope) {
    clearDirectoryDropHover(directoryId)
    return false
  }
  const types = Array.from(event.dataTransfer.types ?? [])
  const draggedDirectoryId = parseDraggedDirectoryId(event.dataTransfer)
  const draggedDirectoryScope = draggedDirectoryId ? getDirectoryMutationScope(draggedDirectoryId) : null
  const draggedAssetId = parseDraggedAssetId(event.dataTransfer)
  const draggedAsset = draggedAssetId ? sceneStore.getAsset(draggedAssetId) : null
  const draggedAssetScope = getAssetMutationScope(draggedAsset)
  const acceptsAsset = types.includes(ASSET_DRAG_MIME)
    && !!draggedAssetId
    && draggedAssetScope === targetScope
  const acceptsDirectory = types.includes(DIRECTORY_DRAG_MIME) && draggedDirectoryScope === targetScope
  if (!acceptsAsset && !acceptsDirectory) {
    clearDirectoryDropHover(directoryId)
    return false
  }
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'move'
  setDirectoryDropHover(directoryId)
  return true
}

function handleDirectoryDragEnter(event: DragEvent, directoryId: string) {
  allowDirectoryDrop(event, directoryId)
}

function handleDirectoryDragOver(event: DragEvent, directoryId: string) {
  allowDirectoryDrop(event, directoryId)
}

function handleDirectoryDragLeave(_event: DragEvent, directoryId: string) {
  clearDirectoryDropHover(directoryId)
}

async function handleDirectoryDrop(event: DragEvent, directoryId: string) {
  if (!allowDirectoryDrop(event, directoryId) || !event.dataTransfer) {
    return
  }
  const preservedActiveDirectoryId = activeDirectoryId.value
  const draggedDirectoryId = parseDraggedDirectoryId(event.dataTransfer)
  if (draggedDirectoryId) {
    try {
      if (isWritableLocalDirectoryId(draggedDirectoryId) && isWritableLocalDirectoryId(directoryId)) {
        const moved = sceneStore.moveAssetDirectory(draggedDirectoryId, directoryId)
        if (moved && preservedActiveDirectoryId) {
          sceneStore.setActiveDirectory(preservedActiveDirectoryId)
        }
      }
      ensureDirectoryOpened(directoryId)
    } catch (error) {
      console.error('Failed to move directory', error)
    } finally {
      draggingDirectoryId.value = null
      clearDirectoryDropHover(directoryId)
    }
    return
  }
  const assetId = parseDraggedAssetId(event.dataTransfer)
  if (!assetId) {
    clearDirectoryDropHover(directoryId)
    return
  }
  try {
    const asset = sceneStore.getAsset(assetId)
    const scope = getAssetMutationScope(asset)
    if (scope === 'local' && isWritableLocalDirectoryId(directoryId)) {
      sceneStore.moveProjectAssetToDirectory(assetId, directoryId)
    }
  } catch (error) {
    console.error('Failed to move asset to directory', error)
  } finally {
    clearDirectoryDropHover(directoryId)
  }
}

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

function openUploadDialog() {
  if (!canEditSelectedAssetMetadata.value) {
    return
  }
  uploadDialogTargetAssetId.value = null
  uploadDialogOpen.value = true
}

watch(uploadDialogOpen, (open) => {
  if (!open) {
    uploadDialogTargetAssetId.value = null
  }
})

function handleUploadCompleted(_payload: { successCount: number; replacementMap: Record<string, string> }) {
  clearSelectedAssets()
  sceneStore.selectAsset(null)
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
  audio: '#2E7D32',
  material: '#6D4C41',
  behavior: '#546E7A',
  prefab: '#7B1FA2',
  file: '#37474F',
  video: '#1E88E5',
  mesh: '#8D6E63',
  hdri: '#0097A7',
  lod: '#CCCCCC',
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
  options: {
    displayName?: string
    type?: ProjectAsset['type']
    signal?: AbortSignal
    onPhase?: (phase: DropImportStage) => void
  } = {},
): Promise<DropImportOutcome> {
  const type = options.type ?? inferAssetType({ mimeType: file.type ?? null, nameOrUrl: file.name ?? null, fallbackType: 'file' })
  const fallbackName = options.displayName ?? (file.name && file.name.trim().length ? file.name : 'Dropped Asset')
  const assetId = await computeBlobHash(file)
  const existing = sceneStore.getAsset(assetId)
  if (existing) {
    options.onPhase?.('reuse-existing')
    options.onPhase?.('finalize')
    return { asset: existing, isNew: false }
  }

  try {
    const lookup = await lookupResourceAssetsByHash([{ contentHash: assetId }])
    const matched = lookup.matches[0]?.asset
    if (matched) {
      let serverAssetDto = matched as unknown as ServerAssetDto
      if (matched.assetRole === 'dependant') {
        try {
          serverAssetDto = await updateAssetOnServer({
            assetId: matched.id,
            assetRole: 'master',
            name: fallbackName,
            type,
            description: fallbackName,
          })
        } catch {
          serverAssetDto = null as unknown as ServerAssetDto
        }
      }

      if (serverAssetDto) {
        options.onPhase?.('reuse-existing')
        const draftAsset: ProjectAsset = {
          id: assetId,
          name: fallbackName,
          type,
          downloadUrl: file.name ?? fallbackName,
          previewColor: resolvePreviewColor(type),
          thumbnail: null,
          description: fallbackName,
          metadata: null,
          gleaned: true,
          extension: extractExtension(file.name) ?? getExtensionFromMimeType(file.type) ?? null,
        }
        const prepared = await prepareLocalAssetImport(draftAsset, file, {
          signal: options.signal,
          onPhase: (phase) => options.onPhase?.(phase),
        })
        options.onPhase?.('store-asset')
        const { asset: localAsset } = await sceneStore.ensureLocalAssetFromFile(file, {
          type,
          name: fallbackName,
          description: fallbackName,
          previewColor: resolvePreviewColor(type),
          gleaned: true,
        })
        const updates = {
          ...buildLocalAssetServerMatchUpdates(localAsset, serverAssetDto, assetId),
          ...buildPreparedLocalAssetImportUpdates(localAsset, prepared, assetId),
        }
        const registered = Object.keys(updates).length
          ? (sceneStore.updateProjectAssetMetadata(localAsset.id, updates) ?? localAsset)
          : localAsset
        options.onPhase?.('finalize')
        return { asset: registered, isNew: true }
      }
    }
  } catch {
    // Fall back to local import when hash lookup is unavailable.
  }

  const draftAsset: ProjectAsset = {
    id: assetId,
    name: fallbackName,
    type,
    downloadUrl: file.name ?? fallbackName,
    previewColor: resolvePreviewColor(type),
    thumbnail: null,
    description: fallbackName,
    metadata: null,
    gleaned: true,
    extension: extractExtension(file.name) ?? getExtensionFromMimeType(file.type) ?? null,
  }
  const prepared = await prepareLocalAssetImport(draftAsset, file, {
    signal: options.signal,
    onPhase: (phase) => options.onPhase?.(phase),
  })
  options.onPhase?.('store-asset')
  const { asset } = await sceneStore.ensureLocalAssetFromFile(file, {
    type,
    name: fallbackName,
    description: fallbackName,
    previewColor: resolvePreviewColor(type),
    gleaned: true,
  })
  options.onPhase?.('finalize')

  const nextMetadata = mergeAssetMetadata(asset.metadata ?? null, prepared.metadata ?? null)
  const updates: Partial<ProjectAsset> = {}
  if (typeof prepared.dimensionLength === 'number' && prepared.dimensionLength > 0) {
    updates.dimensionLength = prepared.dimensionLength
  }
  if (typeof prepared.dimensionWidth === 'number' && prepared.dimensionWidth > 0) {
    updates.dimensionWidth = prepared.dimensionWidth
  }
  if (typeof prepared.dimensionHeight === 'number' && prepared.dimensionHeight > 0) {
    updates.dimensionHeight = prepared.dimensionHeight
  }
  if (typeof prepared.imageWidth === 'number' && prepared.imageWidth > 0) {
    updates.imageWidth = Math.round(prepared.imageWidth)
  }
  if (typeof prepared.imageHeight === 'number' && prepared.imageHeight > 0) {
    updates.imageHeight = Math.round(prepared.imageHeight)
  }
  if (prepared.thumbnailDataUrl) {
    updates.thumbnail = prepared.thumbnailDataUrl
  }
  if (nextMetadata) {
    updates.metadata = nextMetadata
  }

  if (!Object.keys(updates).length) {
    return { asset, isNew: true }
  }
  return {
    asset: sceneStore.updateProjectAssetMetadata(asset.id, updates) ?? asset,
    isNew: true,
  }
}

async function importDataUrlAsset(dataUrl: string): Promise<DropImportOutcome> {
  const blob = dataUrlToBlob(dataUrl)
  const mimeType = blob.type && blob.type.length ? blob.type : 'application/octet-stream'
  const extension = getExtensionFromMimeType(mimeType) ?? 'bin'
  const type = inferAssetType({ mimeType, nameOrUrl: `pasted.${extension}`, fallbackType: 'file' })
  const fileName = `pasted-asset-${Date.now().toString(36)}.${extension}`
  const file = new File([blob], fileName, { type: mimeType })
  return importLocalFile(file, { displayName: fileName, type })
}

function importRemoteAssetFromUrl(url: string): DropImportOutcome {
  const normalizedUrl = normalizeRemoteUrl(url)
  const existing = sceneStore.getAsset(normalizedUrl)
  if (existing) {
    return { asset: existing, isNew: false }
  }
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
  return {
    asset: sceneStore.ensureSceneAssetRegistered(asset, {
      source: { type: 'url' },
    }),
    isNew: true,
  }
}

function buildDropImportFailure(sourceName: string, error: unknown): DropImportFailureItem {
  const reason = error instanceof Error && error.message
    ? error.message
    : `Import failed for ${sourceName}`
  return { sourceName, reason }
}

function buildAssetImportSummary(result: DropImportResult): string {
  const successCount = result.newCount + result.reusedCount
  const segments = [`成功 ${successCount} 个`]
  if (result.reusedCount > 0) {
    segments.push(`复用 ${result.reusedCount} 个`)
  }
  if (result.failedItems.length > 0) {
    segments.push(`失败 ${result.failedItems.length} 个`)
  }
  return `资产导入完成，${segments.join('，')}`
}

function buildImportFailureDetails(items: DropImportFailureItem[]): { label: string; description: string }[] {
  const details = items.slice(0, MAX_IMPORT_FAILURE_DETAILS).map((item) => ({
    label: item.sourceName,
    description: item.reason,
  }))
  if (items.length > MAX_IMPORT_FAILURE_DETAILS) {
    details.push({
      label: '更多失败项',
      description: `其余 ${items.length - MAX_IMPORT_FAILURE_DETAILS} 个失败项已省略，请查看控制台日志。`,
    })
  }
  return details
}

function syncAssetImportOverlayFromProgress(progress: DropImportProgressState | null): void {
  if (!progress) {
    return
  }
  const inFlight = progress.currentStep > 0 ? progress.currentStep / Math.max(progress.stepCount, 1) : 0
  const percent = ((progress.completed + inFlight) / Math.max(progress.total, 1)) * 100
  uiStore.updateLoadingOverlay({
    message: progress.currentFileName
      ? `${progress.currentPhase} (${progress.currentFileName})`
      : progress.currentPhase,
    progress: Math.max(0, Math.min(100, percent)),
  })
}

function showAssetImportOverlay(total: number): void {
  uiStore.showLoadingOverlay({
    title: '导入资产',
    message: total > 0 ? `准备导入 ${total} 个资源…` : '准备导入资源…',
    mode: 'determinate',
    progress: 0,
    closable: false,
    cancelable: false,
    autoClose: false,
    interactionLock: ASSET_IMPORT_INTERACTION_LOCK,
    detailsTitle: '失败详情',
    details: [],
    detailsExpanded: false,
  })
}

function showAssetImportResultOverlay(result: DropImportResult): void {
  uiStore.updateLoadingOverlay({
    title: '导入资产',
    message: buildAssetImportSummary(result),
    progress: 100,
    closable: true,
    cancelable: false,
    autoClose: result.failedItems.length === 0,
    autoCloseDelay: result.failedItems.length === 0 ? 1400 : 0,
    interactionLock: result.failedItems.length === 0 ? null : ASSET_IMPORT_INTERACTION_LOCK,
    detailsTitle: '失败详情',
    details: buildImportFailureDetails(result.failedItems),
    detailsExpanded: result.failedItems.length > 0,
  })
}

async function processAssetDrop(dataTransfer: DataTransfer): Promise<DropImportResult> {
  const collected = new Map<string, ProjectAsset>()
  const files = getDroppedFiles(dataTransfer)
  const urls = extractAssetUrlsFromDataTransfer(dataTransfer)
  const failedItems: DropImportFailureItem[] = []
  let newCount = 0
  let reusedCount = 0
  beginDropImportProgress(files.length + urls.length)
  for (const file of files) {
    let failed = false
    try {
      const outcome = await importLocalFile(file, {
        signal: dropImportAbortController?.signal,
        onPhase: (phase) => updateDropImportProgress(file.name, phase),
      })
      collected.set(outcome.asset.id, outcome.asset)
      if (outcome.isNew) {
        newCount += 1
      } else {
        reusedCount += 1
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw error
      }
      failed = true
      failedItems.push(buildDropImportFailure(file.name, error))
    } finally {
      completeDropImportProgress(file.name, failed)
    }
  }

  for (const url of urls) {
    let failed = false
    try {
      if (url.startsWith('data:')) {
        const outcome = await importDataUrlAsset(url)
        collected.set(outcome.asset.id, outcome.asset)
        if (outcome.isNew) {
          newCount += 1
        } else {
          reusedCount += 1
        }
      } else {
        updateDropImportProgress(url, 'finalize')
        const outcome = importRemoteAssetFromUrl(url)
        collected.set(outcome.asset.id, outcome.asset)
        if (outcome.isNew) {
          newCount += 1
        } else {
          reusedCount += 1
        }
      }
    } catch (error) {
      failed = true
      failedItems.push(buildDropImportFailure(url, error))
    } finally {
      completeDropImportProgress(url, failed)
    }
  }

  return {
    assets: Array.from(collected.values()),
    totalSources: files.length + urls.length,
    newCount,
    reusedCount,
    failedItems,
  }
}

const allowAssetDrop = computed(() => true)
const dropOverlayVisible = computed(() => dropActive.value)
const dropOverlayMessage = computed(() => {
  if (!dropProcessing.value) {
    return 'Drag files, links, or scene nodes here to add assets'
  }
  return dropImportProgress.value?.currentPhase ?? 'Processing assets…'
})
const dropOverlayStatus = computed(() => {
  const progress = dropImportProgress.value
  if (!dropProcessing.value || !progress) {
    return ''
  }
  const base = `${progress.completed}/${progress.total} files`
  return progress.failed > 0 ? `${base} - ${progress.failed} failed` : base
})
const dropOverlayCurrentFile = computed(() => {
  const progress = dropImportProgress.value
  if (!dropProcessing.value || !progress?.currentFileName) {
    return ''
  }
  return progress.currentFileName
})
const dropOverlayPercent = computed(() => {
  const progress = dropImportProgress.value
  if (!progress || progress.total <= 0) {
    return 0
  }
  const inFlight = progress.currentStep > 0 ? progress.currentStep / progress.stepCount : 0
  const percent = ((progress.completed + inFlight) / progress.total) * 100
  return Math.max(0, Math.min(100, percent))
})

function isDragLeavingCurrentTarget(event: DragEvent): boolean {
  const currentTarget = event.currentTarget
  if (!(currentTarget instanceof HTMLElement)) {
    return true
  }
  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return false
  }
  const { clientX, clientY } = event
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return true
  }
  const bounds = currentTarget.getBoundingClientRect()
  return clientX < bounds.left
    || clientX > bounds.right
    || clientY < bounds.top
    || clientY > bounds.bottom
}

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
  if (!dropActive.value) {
    dropActive.value = true
  }
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
  if (!dropActive.value) {
    dropActive.value = true
  }
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
  if (!isDragLeavingCurrentTarget(event)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dropActive.value = false
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
  dropImportAbortController?.abort()
  dropImportAbortController = new AbortController()
  dropActive.value = false
  clearDropFeedbackTimer()
  try {
    if (draggedNodeId) {
      await handleSceneNodeDrop(draggedNodeId)
      return
    }
    const totalSources = getDroppedFiles(event.dataTransfer).length + extractAssetUrlsFromDataTransfer(event.dataTransfer).length
    showAssetImportOverlay(totalSources)
    const result = await processAssetDrop(event.dataTransfer)
    const { assets } = result
    if (assets.length) {
      // Preserve currently active directory when importing from local filesystem
      const previousActive = activeDirectoryId.value
      const categoryOrder = assets.map((asset) => determineAssetCategoryId(asset))
      const uniqueCategories = Array.from(new Set(categoryOrder.filter(Boolean)))
      uniqueCategories.forEach((categoryId) => {
        if (categoryId) {
          ensureDirectoryOpened(categoryId)
        }
      })
      // Do not change active directory on import; keep previousActive
      sceneStore.selectAsset(null)
      clearSelectedAssets()
      if (previousActive) {
        // restore previous active directory to be explicit (no-op if unchanged)
        sceneStore.setActiveDirectory(previousActive)
      }
    }
    if (result.totalSources > 0) {
      showAssetImportResultOverlay(result)
    }
    const successCount = result.newCount + result.reusedCount
    if (!(successCount > 0 || result.failedItems.length > 0)) {
      uiStore.updateLoadingOverlay({
        title: '导入资产',
        message: '未检测到可导入的资源',
        progress: 100,
        closable: true,
        autoClose: true,
        autoCloseDelay: 1200,
        interactionLock: null,
        details: [],
        detailsExpanded: false,
      })
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      uiStore.hideLoadingOverlay(true)
      return
    }
    console.error('Failed to process gallery drop payload', error)
    uiStore.updateLoadingOverlay({
      title: '导入资产',
      message: (error as Error).message ?? 'Failed to process drop payload',
      progress: 100,
      closable: true,
      autoClose: false,
      interactionLock: ASSET_IMPORT_INTERACTION_LOCK,
      detailsTitle: '失败详情',
      details: buildImportFailureDetails([buildDropImportFailure('导入任务', error)]),
      detailsExpanded: true,
    })
  } finally {
    dropProcessing.value = false
    dropImportProgress.value = null
    dropImportAbortController = null
  }
}

function mergeAssetMetadata(
  current: ProjectAsset['metadata'] | null | undefined,
  incoming: ProjectAsset['metadata'] | null | undefined,
): ProjectAsset['metadata'] | null {
  const base = current && typeof current === 'object' ? { ...current } : null
  const next = incoming && typeof incoming === 'object' ? { ...incoming } : null
  if (!base && !next) {
    return null
  }
  return {
    ...(base ?? {}),
    ...(next ?? {}),
  }
}

function buildLocalAssetServerMatchUpdates(
  localAsset: ProjectAsset,
  serverAssetDto: ServerAssetDto,
  contentHash: string,
): Partial<ProjectAsset> {
  const mapped = mapServerAssetToProjectAsset(serverAssetDto, localAsset)
  const nextMetadata = mergeAssetMetadata(localAsset.metadata ?? null, mapped.metadata ?? null)
  const updates: Partial<ProjectAsset> = {}

  if (mapped.name && mapped.name !== localAsset.name) {
    updates.name = mapped.name
  }
  if (typeof mapped.description === 'string' && mapped.description.trim().length > 0) {
    updates.description = mapped.description
  }
  if (typeof mapped.downloadUrl === 'string' && mapped.downloadUrl.trim().length > 0) {
    updates.downloadUrl = mapped.downloadUrl
  }
  if (typeof mapped.fileKey === 'string' && mapped.fileKey.trim().length > 0) {
    updates.fileKey = mapped.fileKey
  }
  if (typeof mapped.thumbnail === 'string' && mapped.thumbnail.trim().length > 0) {
    updates.thumbnail = mapped.thumbnail
  }
  if (Array.isArray(mapped.tags) && mapped.tags.length > 0) {
    updates.tags = [...mapped.tags]
  }
  if (Array.isArray(mapped.tagIds) && mapped.tagIds.length > 0) {
    updates.tagIds = [...mapped.tagIds]
  }
  if (typeof mapped.color === 'string' && mapped.color.trim().length > 0) {
    updates.color = mapped.color
  }
  if (typeof mapped.dimensionLength === 'number' && mapped.dimensionLength > 0) {
    updates.dimensionLength = mapped.dimensionLength
  }
  if (typeof mapped.dimensionWidth === 'number' && mapped.dimensionWidth > 0) {
    updates.dimensionWidth = mapped.dimensionWidth
  }
  if (typeof mapped.dimensionHeight === 'number' && mapped.dimensionHeight > 0) {
    updates.dimensionHeight = mapped.dimensionHeight
  }
  if (typeof mapped.imageWidth === 'number' && mapped.imageWidth > 0) {
    updates.imageWidth = mapped.imageWidth
  }
  if (typeof mapped.imageHeight === 'number' && mapped.imageHeight > 0) {
    updates.imageHeight = mapped.imageHeight
  }
  if (typeof mapped.sizeCategory === 'string' && mapped.sizeCategory.trim().length > 0) {
    updates.sizeCategory = mapped.sizeCategory
  }
  if (typeof mapped.contentHash === 'string' && mapped.contentHash.trim().length > 0) {
    updates.contentHash = mapped.contentHash
  } else {
    updates.contentHash = contentHash
  }
  if (typeof mapped.contentHashAlgorithm === 'string' && mapped.contentHashAlgorithm.trim().length > 0) {
    updates.contentHashAlgorithm = mapped.contentHashAlgorithm
  }
  if (typeof mapped.sourceLocalAssetId === 'string' && mapped.sourceLocalAssetId.trim().length > 0) {
    updates.sourceLocalAssetId = mapped.sourceLocalAssetId
  }
  if (mapped.assetRole === 'master' || mapped.assetRole === 'dependant') {
    updates.assetRole = mapped.assetRole
  }
  if (typeof mapped.bundleRole === 'string' && mapped.bundleRole.trim().length > 0) {
    updates.bundleRole = mapped.bundleRole
  }
  if (typeof mapped.bundlePrimaryAssetId === 'string' && mapped.bundlePrimaryAssetId.trim().length > 0) {
    updates.bundlePrimaryAssetId = mapped.bundlePrimaryAssetId
  }
  if (typeof mapped.seriesId === 'string' && mapped.seriesId.trim().length > 0) {
    updates.seriesId = mapped.seriesId
  }
  if (typeof mapped.seriesName === 'string' && mapped.seriesName.trim().length > 0) {
    updates.seriesName = mapped.seriesName
  }
  if (mapped.terrainScatterPreset) {
    updates.terrainScatterPreset = mapped.terrainScatterPreset
  }
  if (typeof mapped.extension === 'string' && mapped.extension.trim().length > 0) {
    updates.extension = mapped.extension
  }
  if (nextMetadata) {
    updates.metadata = nextMetadata
  }

  return updates
}

function buildPreparedLocalAssetImportUpdates(
  localAsset: ProjectAsset,
  prepared: PreparedLocalAssetImport,
  contentHash: string,
): Partial<ProjectAsset> {
  const nextMetadata = mergeAssetMetadata(localAsset.metadata ?? null, prepared.metadata ?? null)
  const updates: Partial<ProjectAsset> = {}

  if (typeof prepared.dimensionLength === 'number' && prepared.dimensionLength > 0) {
    updates.dimensionLength = prepared.dimensionLength
  }
  if (typeof prepared.dimensionWidth === 'number' && prepared.dimensionWidth > 0) {
    updates.dimensionWidth = prepared.dimensionWidth
  }
  if (typeof prepared.dimensionHeight === 'number' && prepared.dimensionHeight > 0) {
    updates.dimensionHeight = prepared.dimensionHeight
  }
  if (typeof prepared.imageWidth === 'number' && prepared.imageWidth > 0) {
    updates.imageWidth = Math.round(prepared.imageWidth)
  }
  if (typeof prepared.imageHeight === 'number' && prepared.imageHeight > 0) {
    updates.imageHeight = Math.round(prepared.imageHeight)
  }
  if (prepared.thumbnailDataUrl) {
    updates.thumbnail = prepared.thumbnailDataUrl
  }
  if (nextMetadata) {
    updates.metadata = nextMetadata
  }
  if (!localAsset.contentHash) {
    updates.contentHash = contentHash
  }

  return updates
}

function beginDropImportProgress(total: number): void {
  if (total <= 0) {
    dropImportProgress.value = null
    return
  }
  dropImportProgress.value = {
    total,
    completed: 0,
    failed: 0,
    currentFileName: '',
    currentPhase: 'Preparing import…',
    currentStep: 0,
    stepCount: DROP_IMPORT_STAGE_ORDER.length,
  }
  syncAssetImportOverlayFromProgress(dropImportProgress.value)
}

function updateDropImportProgress(fileName: string, phase: DropImportStage): void {
  const current = dropImportProgress.value
  if (!current) {
    return
  }
  dropImportProgress.value = {
    ...current,
    currentFileName: fileName,
    currentPhase: DROP_IMPORT_STAGE_LABELS[phase],
    currentStep: DROP_IMPORT_STAGE_ORDER.indexOf(phase) + 1,
  }
  syncAssetImportOverlayFromProgress(dropImportProgress.value)
}

function completeDropImportProgress(fileName: string, failed: boolean): void {
  const current = dropImportProgress.value
  if (!current) {
    return
  }
  dropImportProgress.value = {
    ...current,
    completed: Math.min(current.total, current.completed + 1),
    failed: current.failed + (failed ? 1 : 0),
    currentFileName: fileName,
    currentPhase: failed ? 'Import failed' : 'Asset processed',
    currentStep: 0,
  }
  syncAssetImportOverlayFromProgress(dropImportProgress.value)
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
  await sceneStore.saveNodePrefab(nodeId, { select: false })
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
  const presetOnly = pendingDeleteAssets.value.every((asset) => providerIdForAsset(asset) === PRESET_PROVIDER_ID)
  if (presetOnly) {
    return isBatchDeletion.value
      ? `Are you sure you want to delete the selected global assets ${names}? This will remove them from the shared asset library. This action cannot be undone.`
      : `Are you sure you want to delete global asset ${names}? This will remove it from the shared asset library. This action cannot be undone.`
  }
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
      const directoryProviderId = extractProviderIdFromPackageDirectoryId(directory.id)
        ?? (directory.id === PACKAGES_ROOT_DIRECTORY_ID && !inheritedProviderId
          ? getSingleVisiblePackageProviderId()
          : inheritedProviderId)
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

const assetPackagePathMap = computed(() => {
  const map = new Map<string, string[]>()
  const traverse = (
    directories: ProjectDirectory[] | undefined,
    inheritedProviderId: string | null,
    inheritedPath: string[],
  ) => {
    if (!directories?.length) {
      return
    }
    directories.forEach((directory) => {
      const directProviderId = extractProviderIdFromPackageDirectoryId(directory.id)
      const flattenedProviderId = directory.id === PACKAGES_ROOT_DIRECTORY_ID && !inheritedProviderId
        ? getSingleVisiblePackageProviderId()
        : null
      const directoryProviderId = directProviderId ?? flattenedProviderId ?? inheritedProviderId
      const isProviderRoot = Boolean(directProviderId || flattenedProviderId)
      const nextPath = directoryProviderId
        ? (isProviderRoot ? [] : [...inheritedPath, directory.name])
        : inheritedPath

      if (directory.assets?.length && directoryProviderId) {
        directory.assets.forEach((asset) => {
          map.set(asset.id, [...nextPath])
        })
      }
      if (directory.children?.length) {
        traverse(directory.children, directoryProviderId, nextPath)
      }
    })
  }
  traverse(projectTree.value, null, [])
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
  const registryEntry = sceneStore.assetRegistry?.[asset.id]
  if (registryEntry?.sourceType === 'package') {
    const zipPath = typeof registryEntry.zipPath === 'string' ? registryEntry.zipPath.trim() : ''
    if (zipPath === `${providerId}::${asset.id}`) {
      return asset.id
    }
  }
  return asset.id
}

function prepareAssetForOperations(asset: ProjectAsset): ProjectAsset {
  const providerId = providerIdForAsset(asset)
  if (!providerId) {
    return asset
  }
  const packagePathSegments = assetPackagePathMap.value.get(asset.id) ?? []

  // If this asset is already registered under its id, return that registered instance.
  const already = sceneStore.getRegisteredAsset(asset.id)
  if (already) {
    return already
  }

  // Try to normalize by serverAssetId: some assets are persisted with a server id
  // while registry keys remain the original sha/hash. If we find a registry entry
  // whose `serverAssetId` matches the clicked asset id, use that registered asset
  // to avoid duplicate registrations.
  const registry = sceneStore.assetRegistry ?? {}
  for (const [registryKey, entry] of Object.entries(registry)) {
    if (!entry) continue
    const serverAssetId = typeof (entry as any).serverAssetId === 'string' ? (entry as any).serverAssetId.trim() : ''
    if (serverAssetId && serverAssetId === asset.id) {
      const mapped = sceneStore.getRegisteredAsset(registryKey)
      if (mapped) {
        return mapped
      }

      // If registry entry exists but not yet in catalog, normalize the incoming
      // asset id to the registry key and register that instead.
      const normalized: ProjectAsset = { ...asset, id: registryKey }
      return sceneStore.ensureSceneAssetRegistered(normalized, { providerId, packagePathSegments })
    }
  }

  return sceneStore.ensureSceneAssetRegistered(asset, { providerId, packagePathSegments })
}

const indexedDbLoadQueue = new Set<string>()

function assetPreviewUrl(asset: ProjectAsset): string | undefined {
  const cacheId = resolveAssetCacheId(asset)
  return assetCacheStore.resolveAssetThumbnail({ asset, cacheId }) ?? undefined
}

function assetPreviewStyle(asset: ProjectAsset): { backgroundColor?: string } | undefined {
  if (usesTransparentThumbnailBackground(asset)) {
    return undefined
  }
  return asset.previewColor ? { backgroundColor: asset.previewColor } : undefined
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
    await assetCacheStore.ensureAssetEntry(cacheId)
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
  selectedAssetIds.value = pruneSelectableAssetSelections(selectedAssetIds.value, displayedAssets.value)
  if (previewPlayingAssetId.value && !availableIds.has(previewPlayingAssetId.value)) {
    stopAudioPreview()
  }
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
    collectAssets(filteredProjectTree.value ?? [], matches, query, seen)
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

function assetIcon(asset: ProjectAsset) {
  return getAssetTypePresentation(asset).icon
}

function assetTypePresentation(asset: ProjectAsset) {
  return getAssetTypePresentation(asset)
}

function isAudioPreviewAsset(asset: ProjectAsset): boolean {
  return isAudioAsset(asset)
}

function isAssetPreviewPlaying(asset: ProjectAsset): boolean {
  return previewPlayingAssetId.value === asset.id
}

function isAssetPreviewPending(asset: ProjectAsset): boolean {
  return previewPendingAssetId.value === asset.id
}

async function handleAssetPreviewClick(event: MouseEvent, asset: ProjectAsset): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  await toggleAssetPreview(asset)
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
    if (!usesTransparentThumbnailBackground(asset)) {
      thumbnail.style.backgroundColor = asset.previewColor ?? '#455A64'
    }
    thumbnail.style.backgroundSize = 'cover'
    thumbnail.style.backgroundPosition = 'center'
    thumbnail.style.backgroundImage = `url("${thumbnailUrl}")`
    thumbnail.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.35)'
    wrapper.appendChild(thumbnail)
  } else {
    const iconSpan = document.createElement('span')
    iconSpan.className = `mdi ${assetIcon(asset)}`
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
  stopAudioPreview()
  dropImportAbortController?.abort()
  destroyDragPreview()
  detachDragSuppressionListeners()
  directoryDropHoverId.value = null
  assetDropHoverId.value = null
  if (typeof window !== 'undefined' && windowPasteListener) {
    window.removeEventListener('paste', windowPasteListener, true)
    windowPasteListener = null
  }
  if (typeof window !== 'undefined' && windowResizeListener) {
    window.removeEventListener('resize', windowResizeListener)
    windowResizeListener = null
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
  return id === PACKAGES_ROOT_DIRECTORY_ID
    ? !!getSingleVisiblePackageProviderId()
    : isPackageProviderDirectoryId(id)
}
function isDirectoryLoading(id: string | undefined | null): boolean {
  if (!id) return false
  const providerId = id === PACKAGES_ROOT_DIRECTORY_ID
    ? getSingleVisiblePackageProviderId()
    : extractProviderIdFromPackageDirectoryId(id)
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
            <v-btn
              icon="mdi-folder-plus-outline"
              variant="text"
              density="compact"
              :disabled="!canCreateDirectory"
              title="Create folder"
              @click="promptCreateDirectory"
            />
            <v-btn
              icon="mdi-pencil-outline"
              variant="text"
              density="compact"
              :disabled="!canRenameDirectory"
              title="Rename folder"
              @click="promptRenameDirectory()"
            />
            <v-btn
              icon="mdi-delete-outline"
              variant="text"
              density="compact"
              :disabled="!canDeleteDirectory"
              title="Delete folder"
              @click="promptDeleteDirectory()"
            />
          </v-toolbar>
          <v-divider />
          <v-treeview
            v-model:opened="openedDirectories"
            v-model:activated="selectedDirectory"
            :items="filteredProjectTree"
            item-title="name"
            item-value="id"
            activatable
            class="tree-view"
          >
            <template #prepend>
              <v-icon>mdi-folder</v-icon>
            </template>
            <template #title="{ item }">
              <div
                :class="['tree-node-title', { 'is-drop-target': directoryDropHoverId === item.id }]"
                :draggable="isDraggableDirectoryId(item?.id)"
                @dragstart.stop="handleDirectoryDragStart($event, item.id)"
                @dragend="handleDirectoryDragEnd"
                @dragenter="handleDirectoryDragEnter($event, item.id)"
                @dragover="handleDirectoryDragOver($event, item.id)"
                @dragleave="handleDirectoryDragLeave($event, item.id)"
                @drop="handleDirectoryDrop($event, item.id)"
                @dblclick.stop="item?.id && sceneStore.setActiveDirectory(item.id)"
              >
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
              icon="mdi-rename-outline"
              :disabled="!canEditSelectedAssetMetadata"
              title="Edit asset metadata"
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
            <div v-if="galleryDirectories.length || displayedAssets.length" class="gallery-grid">
              <v-card
                v-for="directory in galleryDirectories"
                :key="directory.id"
                :class="[
                  'resource-card',
                  'directory-card',
                  {
                    'is-active': activeDirectoryId === directory.id,
                    'is-drop-target': directoryDropHoverId === directory.id,
                  },
                ]"
                elevation="4"
                :draggable="isDraggableDirectoryId(directory.id)"
                tabindex="0"
                @dblclick.stop="enterDirectory(directory)"
                @keyup.enter.prevent="enterDirectory(directory)"
                @keyup.space.prevent="enterDirectory(directory)"
                @dragstart.stop="handleDirectoryDragStart($event, directory.id)"
                @dragend="handleDirectoryDragEnd"
                @dragenter="handleDirectoryDragEnter($event, directory.id)"
                @dragover="handleDirectoryDragOver($event, directory.id)"
                @dragleave="handleDirectoryDragLeave($event, directory.id)"
                @drop="handleDirectoryDrop($event, directory.id)"
              >
                <div class="directory-preview">
                  <div class="directory-preview-icon">
                    <v-icon size="42" color="primary">mdi-folder</v-icon>
                  </div>
                  <div class="directory-card-actions">
                    <v-btn
                      v-if="(isWritableLocalDirectoryId(directory.id) && directory.id !== ASSETS_ROOT_DIRECTORY_ID) || isPresetDirectoryMutable(directory.id)"
                      icon="mdi-pencil-outline"
                      variant="text"
                      density="compact"
                      size="small"
                      @click.stop="promptRenameDirectory(directory.id)"
                    />
                    <v-btn
                      v-if="(isWritableLocalDirectoryId(directory.id) && directory.id !== ASSETS_ROOT_DIRECTORY_ID) || isPresetDirectoryMutable(directory.id)"
                      icon="mdi-delete-outline"
                      variant="text"
                      density="compact"
                      size="small"
                      @click.stop="promptDeleteDirectory(directory.id)"
                    />
                  </div>
                  <div class="directory-info-overlay">
                    <span class="directory-card-title">{{ directory.name }}</span>
                  </div>
                  
                </div>
              </v-card>
              <v-card
                v-for="asset in displayedAssets"
                :key="asset.id"
                :class="[
                  'resource-card',
                  'asset-card',
                  {
                    'is-selected': selectedAssetId === asset.id,
                    'is-dragging': isAssetDragging(asset.id),
                    'is-downloading': isAssetDownloading(asset),
                    'is-drop-target': assetDropHoverId === asset.id,
                  },
                ]"
                elevation="4"
                :draggable="true"
                @pointerdown.left="primePrefabAsset(asset)"
                @click="selectAsset(asset)"
                @dragstart.stop="handleAssetDragStart($event, asset)"
                @dragend="handleAssetDragEnd"
                @dragenter="handleAssetCardDragEnter($event, asset.id)"
                @dragover="handleAssetCardDragOver($event, asset.id)"
                @dragleave="handleAssetCardDragLeave($event, asset.id)"
                @drop="handleAssetCardDrop($event, asset.id)"
              >
                <div class="asset-preview" :style="assetPreviewStyle(asset)">
                  <div class="asset-select-control" :class="{ 'is-visible': isAssetSelected(asset.id) }">
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
                      v-if="isAudioPreviewAsset(asset)"
                      :icon="isAssetPreviewPlaying(asset) ? 'mdi-stop-circle-outline' : 'mdi-play-circle-outline'"
                      variant="text"
                      density="compact"
                      size="small"
                      :loading="isAssetPreviewPending(asset)"
                      :title="isAssetPreviewPlaying(asset) ? 'Stop audio preview' : 'Play audio preview'"
                      @click="handleAssetPreviewClick($event, asset)"
                    />
                    <v-btn
                      v-if="getAssetMutationScope(asset) === 'local'"
                      icon="mdi-pencil-outline"
                      variant="text"
                      density="compact"
                      size="small"
                      @click.stop="promptRenameAsset(asset.id)"
                    />
                    <v-btn
                      v-if="canDeleteAsset(asset)"
                      icon="mdi-delete-outline"
                      variant="text"
                      density="compact"
                      size="small"
                      @click.stop="promptDeleteAsset(asset)"
                    />
                  </div>
                  <img
                    v-if="assetPreviewUrl(asset)"
                    :src="assetPreviewUrl(asset)"
                    class="asset-preview-image"
                    :alt="`${asset.name} preview`"
                    draggable="false"
                  />
                  <v-icon v-else size="32" color="white">{{ assetIcon(asset) }}</v-icon>
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
                    <div
                      class="asset-title-surface"
                      :style="{
                        '--asset-type-accent': assetTypePresentation(asset).color,
                        '--asset-source-accent': getAssetSourcePresentation(asset).color,
                      }"
                    >
                      <span class="asset-title-row">
                        <span
                          class="asset-type-icon"
                          :title="assetTypePresentation(asset).label"
                          :aria-label="assetTypePresentation(asset).label"
                        >
                          <v-icon size="12">{{ assetTypePresentation(asset).icon }}</v-icon>
                        </span>
                        <span class="asset-title">{{ asset.name }}</span>
                      </span>
                    </div>
                    <span v-if="assetDownloadError(asset)" class="asset-subtitle">{{ assetDownloadError(asset) }}</span>
                  </div>
                </div>
              </v-card>
            </div>
            <div v-if="!galleryDirectories.length && !displayedAssets.length" class="placeholder-text">
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
          <div v-show="dropOverlayVisible" class="drop-overlay">
            <v-icon size="42" color="white">mdi-cloud-upload</v-icon>
            <span class="drop-overlay__message">{{ dropOverlayMessage }}</span>
            <span v-if="dropOverlayStatus" class="drop-overlay__status">{{ dropOverlayStatus }}</span>
            <span v-if="dropOverlayCurrentFile" class="drop-overlay__file">{{ dropOverlayCurrentFile }}</span>
            <v-progress-linear
              v-if="dropActive && dropProcessing && dropImportProgress"
              class="drop-overlay__progress"
              :model-value="dropOverlayPercent"
              color="primary"
              rounded
              height="8"
            />
          </div>
        </div>
      </Pane>
    </Splitpanes>

    <UploadAssetsDialog
      v-model="uploadDialogOpen"
      :assets="uploadDialogAssets"
      :tag-options="tagOptions"
      @uploaded="handleUploadCompleted"
    />

    <v-dialog v-model="directoryDialogOpen" max-width="420">
      <v-card>
        <v-card-title>{{ directoryDialogTitle }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="directoryDialogName"
            label="Folder name"
            variant="outlined"
            density="comfortable"
            hide-details
            autofocus
            @keydown.enter.prevent="submitDirectoryDialog"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelDirectoryDialog">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="submitDirectoryDialog">{{ directoryDialogConfirmLabel }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="directoryDeleteDialogOpen" max-width="420">
      <v-card>
        <v-card-title class="text-error">Delete Folder</v-card-title>
        <v-card-text>
          <p class="delete-dialog-text">
            Delete folder "{{ directoryDeleteTarget?.name ?? 'Folder' }}" and all contained assets? This action cannot be undone.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelDeleteDirectory">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="confirmDeleteDirectory">Delete Folder</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
  flex: 1;
  min-height: 0;
}

.project-gallery {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.project-gallery-scroll {
  flex: 1;
  min-height: 0;
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

.category-breadcrumbs {
  min-width: 0;
  overflow: hidden;
}

.category-breadcrumbs__path {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: thin;
}

.category-crumb {
  flex: 0 0 auto;
  white-space: nowrap;
}

.category-breadcrumbs__separator {
  flex: 0 0 auto;
}

.category-crumb__label-button {
  flex: 0 0 auto;
}

.project-gallery.is-drop-target {
  box-shadow: inset 0 0 0 1px rgba(77, 208, 225, 0.28), inset 0 0 0 9999px rgba(77, 208, 225, 0.04);
}

.drop-overlay {
  position: absolute;
  inset: 12px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  color: #f8fbff;
  background:
    radial-gradient(circle at top, rgba(77, 208, 225, 0.22), transparent 42%),
    linear-gradient(180deg, rgba(8, 12, 18, 0.84), rgba(8, 12, 18, 0.72));
  border: 1px solid rgba(77, 208, 225, 0.24);
  border-radius: 18px;
  backdrop-filter: blur(14px);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  pointer-events: none;
}

.drop-overlay :deep(.v-icon) {
  width: 76px;
  height: 76px;
  border-radius: 999px;
  color: #e0f7fa;
  background: rgba(77, 208, 225, 0.12);
  box-shadow: inset 0 0 0 1px rgba(77, 208, 225, 0.18), 0 10px 24px rgba(0, 0, 0, 0.24);
}

.drop-overlay__message {
  max-width: min(100%, 420px);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

.drop-overlay__status,
.drop-overlay__file {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: min(100%, 420px);
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
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

.asset-title-surface {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 2px 2px;
  border-radius: 12px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--asset-source-accent) 28%, rgba(8, 12, 18, 0.28)), rgba(8, 12, 18, 0.22));
  border: 1px solid color-mix(in srgb, var(--asset-source-accent) 42%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  position: relative;
}

.asset-source-label {
  padding: 2px 6px;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--asset-source-accent);
  background: rgba(8, 12, 18, 0.54);
  border: 1px solid color-mix(in srgb, var(--asset-source-accent) 60%, transparent);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}

.asset-title-row {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.asset-type-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.72);
  color: var(--asset-type-accent);
  border: 1px solid color-mix(in srgb, var(--asset-type-accent) 70%, transparent);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
}

.drop-overlay__progress {
  width: min(320px, 100%);
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
  width: 100%;
  min-width: 0;
  min-height: 24px;
  padding: 2px 6px;
  border-radius: 6px;
  transition: background-color 120ms ease, box-shadow 120ms ease;
}

.tree-node-title.is-drop-target {
  background: rgba(77, 208, 225, 0.18);
  box-shadow: inset 0 0 0 1px rgba(77, 208, 225, 0.45);
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
  grid-auto-rows: 96px;
  gap: 8px;
  padding: 10px;
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

.resource-card {
  display: flex;
  flex-direction: column;
  background-color: transparent;
  border: 1px solid transparent;
  transition: border-color 150ms ease, transform 150ms ease;
  cursor: pointer;
  overflow: hidden;
  height: 100%;
}

.resource-card:hover {
  border-color: rgba(77, 208, 225, 0.45);
  transform: translateY(-2px);
}

.asset-card {
  /* row height controlled by grid-auto-rows; ensure asset card fills the row */
  height: 100%;
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

.asset-card.is-drop-target {
  border-color: rgba(77, 208, 225, 0.92);
  box-shadow: 0 0 0 1px rgba(77, 208, 225, 0.82), 0 0 16px rgba(77, 208, 225, 0.28);
  transform: translateY(-3px);
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
  top: 0px;
  left: 0px;
  z-index: 3;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.resource-card:hover .asset-select-control,
.asset-select-control.is-visible {
  opacity: 1;
  pointer-events: auto;
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
  padding: 3px 2px 3px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.6) 100%);
  backdrop-filter: blur(1px);
}

.asset-title-row {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.asset-type-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.72);
  color: var(--asset-type-accent);
  border: 1px solid color-mix(in srgb, var(--asset-type-accent) 70%, transparent);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
}

.asset-title {
  font-size: 0.76rem;
  font-weight: 600;
  color: #ffffff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  line-height: 1.1;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
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
  top: 3px;
  right: 3px;
  display: flex;
  align-items: center;
  gap: 1px;
  background-color: rgba(0, 0, 0, 0.35);
  border-radius: 5px;
  backdrop-filter: blur(2px);
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.resource-card:hover .asset-actions {
  opacity: 1;
  pointer-events: auto;
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
  /* row height controlled by grid-auto-rows; ensure directory card fills the row */
  height: 100%;
  outline: none;
}

.directory-card.is-active {
  border-color: rgba(0, 172, 193, 0.9);
  box-shadow: 0 0 12px rgba(0, 172, 193, 0.35);
}

.directory-card.is-drop-target {
  border-color: rgba(77, 208, 225, 0.9);
  box-shadow: 0 0 0 1px rgba(77, 208, 225, 0.8), 0 0 16px rgba(77, 208, 225, 0.35);
}

.directory-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96px;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 30% 20%, rgba(77, 208, 225, 0.18), transparent 45%),
    linear-gradient(180deg, rgba(21, 29, 39, 0.96) 0%, rgba(10, 15, 22, 0.98) 100%);
}

.directory-preview-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgba(77, 208, 225, 0.08);
  box-shadow: inset 0 0 0 1px rgba(77, 208, 225, 0.08);
}

.directory-info {
  display: none;
}

.directory-card-title {
  font-size: 0.76rem;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.1;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.directory-info-overlay {
  position: absolute;
  left: 8px;
  bottom: 6px;
  padding-right: 6px;
  display: flex;
  align-items: flex-end;
  z-index: 2;
}

.directory-card-subtitle {
  font-size: 0.66rem;
  color: rgba(233, 236, 241, 0.7);
  line-height: 1.1;
}

.directory-card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 2px;
  z-index: 2;
  background-color: rgba(0, 0, 0, 0.28);
  border-radius: 10px;
  backdrop-filter: blur(2px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.directory-card:hover .directory-card-actions {
  opacity: 1;
  pointer-events: auto;
}

.directory-card-actions :deep(.v-btn) {
  color: rgba(233, 236, 241, 0.82);
}

.directory-card:focus-visible {
  border-color: rgba(77, 208, 225, 0.45);
  transform: translateY(-2px);
}

.directory-card:hover .directory-preview-icon,
.directory-card.is-active .directory-preview-icon {
  background: rgba(77, 208, 225, 0.14);
  box-shadow: inset 0 0 0 1px rgba(77, 208, 225, 0.18);
}

.directory-card-title,
.asset-title {
  overflow: hidden;
  text-overflow: ellipsis;
}


</style>
