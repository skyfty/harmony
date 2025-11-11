<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import { useSceneStore, extractProviderIdFromPackageDirectoryId } from '@/stores/sceneStore'
import {
  ASSET_CATEGORY_CONFIG,
  ASSETS_ROOT_DIRECTORY_ID,
  PACKAGES_ROOT_DIRECTORY_ID,
  determineAssetCategoryId,
} from '@/stores/assetCatalog'
import type { AssetCategoryDefinition } from '@/stores/assetCatalog'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { resourceProviders } from '@/resources/projectProviders'
import { loadProviderCatalog, storeProviderCatalog } from '@/stores/providerCatalogCache'
import { getCachedModelObject } from '@/stores/modelObjectCache'
import { dataUrlToBlob, extractExtension } from '@/utils/blob'

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
    console.warn('恢复 ProjectPanel 打开目录状态失败', error)
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
    console.warn('持久化 ProjectPanel 打开目录状态失败', error)
  }
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

const props = defineProps<{
  floating?: boolean
}>()

const emit = defineEmits<{
  (event: 'collapse'): void
  (event: 'toggle-placement'): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

const {
  projectTree,
  activeDirectoryId,
  currentAssets,
  selectedAssetId,
  currentDirectory,
  projectPanelTreeSize,
  draggingAssetId,
} = storeToRefs(sceneStore)

const openedDirectories = ref<string[]>(restoreOpenedDirectories())
const ASSET_DRAG_MIME = 'application/x-harmony-asset'
let dragPreviewEl: HTMLDivElement | null = null
let dragImageOffset: { x: number; y: number } | null = null
let dragSuppressionPreparedAssetId: string | null = null
let dragSuppressionActive = false
let dragSuppressionSourceAssetId: string | null = null

let windowDragOverListener: ((event: DragEvent) => void) | null = null
let windowDropListener: ((event: DragEvent) => void) | null = null
let hiddenDragImageEl: HTMLDivElement | null = null
const addPendingAssetId = ref<string | null>(null)
const deleteDialogOpen = ref(false)
const pendingDeleteAssets = ref<ProjectAsset[]>([])
const isBatchDeletion = ref(false)
const selectedAssetIds = ref<string[]>([])
const dropActive = ref(false)
const dropProcessing = ref(false)
const dropDragDepth = ref(0)
const dropFeedback = ref<{ kind: 'success' | 'error'; message: string } | null>(null)
let dropFeedbackTimer: number | null = null

type AssetCategoryKey = AssetCategoryDefinition['key']

type TagOption = {
  value: string
  label: string
  id?: string
  name: string
}

const CATEGORY_KEY_TO_TYPE: Record<AssetCategoryKey, ProjectAsset['type']> = {
  models: 'model',
  images: 'image',
  textures: 'texture',
  materials: 'material',
  behaviors: 'behavior',
  prefabs: 'prefab',
  others: 'file',
}

const DEFAULT_PREVIEW_COLORS: Record<ProjectAsset['type'], string> = {
  model: '#26C6DA',
  image: '#1E88E5',
  texture: '#8E24AA',
  material: '#FFB74D',
  behavior: '#4DB6AC',
  prefab: '#7986CB',
  file: '#546E7A',
}

const EXTENSION_TYPE_MAP = new Map<string, ProjectAsset['type']>()
ASSET_CATEGORY_CONFIG.forEach((category) => {
  const categoryType = CATEGORY_KEY_TO_TYPE[category.key]
  if (!categoryType) {
    return
  }
  category.extensions.forEach((extension) => {
    const normalized = extension.replace(/^[.]/, '').toLowerCase()
    if (normalized.length) {
      EXTENSION_TYPE_MAP.set(normalized, categoryType)
    }
  })
})

const assetDirectoryIds = new Set<string>([
  ASSETS_ROOT_DIRECTORY_ID,
  ...ASSET_CATEGORY_CONFIG.map((category) => category.id),
])

function isAssetsDirectory(directoryId: string | null | undefined): boolean {
  if (!directoryId) {
    return false
  }
  if (assetDirectoryIds.has(directoryId)) {
    return true
  }
  const path = findDirectoryPath(projectTree.value, directoryId)
  if (!path?.length) {
    return false
  }
  return path.some((directory) => directory.id === ASSETS_ROOT_DIRECTORY_ID)
}

const allowAssetDrop = computed(() => isAssetsDirectory(activeDirectoryId.value))
const dropOverlayVisible = computed(() => allowAssetDrop.value && (dropActive.value || dropProcessing.value))
const dropOverlayMessage = computed(() => (dropProcessing.value ? '正在导入资源…' : '松开鼠标导入资源'))

const providerLoading = ref<Record<string, boolean>>({})
const providerErrors = ref<Record<string, string | null>>({})
const floating = computed(() => props.floating ?? false)
const placementIcon = computed(() => (floating.value ? 'mdi-dock-bottom' : 'mdi-arrow-expand'))
const placementTitle = computed(() => (floating.value ? '停靠到底部' : '浮动显示'))

function setProviderLoading(providerId: string, value: boolean) {
  providerLoading.value = {
    ...providerLoading.value,
    [providerId]: value,
  }
}

function isProviderLoading(providerId: string): boolean {
  return providerLoading.value[providerId] ?? false
}

function isProviderDirectory(directoryId: string | null | undefined): boolean {
  if (!directoryId) {
    return false
  }
  return extractProviderIdFromPackageDirectoryId(directoryId) !== null
}

function isDirectoryLoading(directoryId: string | null | undefined): boolean {
  if (!directoryId) {
    return false
  }
  const providerId = extractProviderIdFromPackageDirectoryId(directoryId)
  if (!providerId) {
    return false
  }
  return isProviderLoading(providerId)
}

function setProviderError(providerId: string, message: string | null) {
  providerErrors.value = {
    ...providerErrors.value,
    [providerId]: message,
  }
}

function getProviderError(providerId: string): string | null {
  return providerErrors.value[providerId] ?? null
}

const selectedDirectory = computed({
  get: () => (activeDirectoryId.value ? [activeDirectoryId.value] : []),
  set: (ids: string[]) => {
    const target = ids[0]
    if (target) {
      sceneStore.setActiveDirectory(target)
    }
  },
})
const allSelectedAssetsCached = computed(() =>
  selectedAssets.value.length > 0 && selectedAssets.value.every((asset) => assetCacheStore.hasCache(resolveAssetCacheId(asset))),
)
const isToolbarDeleteVisible = computed(() => allSelectedAssetsCached.value)
watch(
  projectTree,
  (tree) => {
    if (!tree) {
      return
    }
    const sanitized = sanitizeOpenedDirectories(openedDirectories.value, tree)
    const withPackages = sanitized.includes(PACKAGES_ROOT_DIRECTORY_ID)
      ? sanitized
      : [...sanitized, PACKAGES_ROOT_DIRECTORY_ID]
    if (!arraysEqual(withPackages, openedDirectories.value)) {
      openedDirectories.value = withPackages
    }
  },
  { immediate: true }
)

watch(allowAssetDrop, (canDrop) => {
  if (!canDrop && !dropProcessing.value) {
    dropActive.value = false
    dropDragDepth.value = 0
  }
})

watch(
  () => [...openedDirectories.value],
  (next, prev = []) => {
    const prevSet = new Set(prev)
    next.forEach((id) => {
      if (prevSet.has(id)) {
        return
      }
      const providerId = extractProviderIdFromPackageDirectoryId(id)
      if (providerId) {
        void loadPackageDirectory(providerId)
      }
    })
  },
)

watch(
  () => [...openedDirectories.value],
  (ids) => {
    persistOpenedDirectories(ids)
  },
  { deep: false }
)

watch(
  activeDirectoryId,
  (directoryId) => {
    const providerId = findProviderIdForDirectoryId(directoryId ?? null)
    if (providerId) {
      sceneStore.setResourceProviderId(providerId)
      if (!sceneStore.isPackageLoaded(providerId) && !isProviderLoading(providerId)) {
        void loadPackageDirectory(providerId)
      }
    } else {
      sceneStore.setResourceProviderId('scene')
    }
  },
  { immediate: true }
)

function findDirectoryPath(
  tree: ProjectDirectory[] | undefined,
  targetId: string,
  trail: ProjectDirectory[] = [],
): ProjectDirectory[] | null {
  if (!tree?.length) {
    return null
  }
  for (const directory of tree) {
    const nextTrail = [...trail, directory]
    if (directory.id === targetId) {
      return nextTrail
    }
    if (directory.children?.length) {
      const found = findDirectoryPath(directory.children, targetId, nextTrail)
      if (found) {
        return found
      }
    }
  }
  return null
}

function findProviderIdForDirectoryId(directoryId: string | null): string | null {
  if (!directoryId) {
    return null
  }
  const direct = extractProviderIdFromPackageDirectoryId(directoryId)
  if (direct) {
    return direct
  }
  const path = findDirectoryPath(projectTree.value, directoryId)
  if (!path) {
    return null
  }
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const candidate = extractProviderIdFromPackageDirectoryId(path[index]!.id)
    if (candidate) {
      return candidate
    }
  }
  return null
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
      setProviderError(providerId, (error as Error).message ?? '资源加载失败')
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
      throw new Error(`资源加载失败（${response.status}）`)
    }
    const payload = await response.json()
    const directories = provider.transform ? provider.transform(payload) : []
    sceneStore.setPackageDirectories(providerId, directories)
    setProviderError(providerId, null)
    await storeProviderCatalog(providerId, directories)
  } catch (error) {
    setProviderError(providerId, (error as Error).message ?? '资源加载失败')
  } finally {
    setProviderLoading(providerId, false)
  }
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

function selectAsset(asset: ProjectAsset) {
  sceneStore.selectAsset(asset.id)
}


function isAssetDownloading(asset: ProjectAsset) {
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
  return assetCacheStore.getProgress(resolveAssetCacheId(asset))
}

function assetDownloadError(asset: ProjectAsset) {
  return assetCacheStore.getError(resolveAssetCacheId(asset))
}

async function ensureAssetCached(asset: ProjectAsset) {

  if (assetCacheStore.hasCache(asset.id)) {
    return
  }
  const entry = await assetCacheStore.downloaProjectAsset(asset)
  if (!assetCacheStore.hasCache(asset.id)) {
    throw new Error(entry.error ?? '资源未下载完成')
  }
}

async function handleAddAsset(asset: ProjectAsset) {
  if (addPendingAssetId.value === asset.id) {
    return
  }
  addPendingAssetId.value = asset.id
  let preparedAsset: ProjectAsset | null = null
  try {
    preparedAsset = prepareAssetForOperations(asset)
    assetCacheStore.setError(preparedAsset.id, null)
    await ensureAssetCached(preparedAsset)
    const node = await sceneStore.addModelNode({ asset: preparedAsset })
    if (!node) {
      throw new Error('资源尚未准备就绪')
    }
  } catch (error) {
    console.error('添加资源失败', error)
    const cacheId = preparedAsset?.id ?? resolveAssetCacheId(asset)
    assetCacheStore.setError(cacheId, (error as Error).message ?? '添加资源失败')
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
  selectAsset(asset)
  assetCacheStore.touch(preparedAsset.id)

  let preview: HTMLDivElement | null = null

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify({ assetId: preparedAsset.id }))
    event.dataTransfer.dropEffect = 'copy'
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
  if (!dragSuppressionPreparedAssetId || !dragSuppressionSourceAssetId) {
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
  const cachedObjectReady = !!getCachedModelObject(dragSuppressionPreparedAssetId)
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
  dragSuppressionSourceAssetId = null
}

function initializeDragSuppression(preparedAsset: ProjectAsset, sourceAssetId: string) {
  detachDragSuppressionListeners()
  const preparedAssetId = preparedAsset.type === 'model' ? preparedAsset.id : null
  dragSuppressionSourceAssetId = sourceAssetId
  dragSuppressionPreparedAssetId = preparedAssetId
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
    console.error('删除资源失败', error)
  } finally {
    cancelDeleteAssets()
  }
}

function isAssetDragging(assetId: string) {
  return draggingAssetId.value === assetId
}

const searchQuery = ref('')
const searchResults = ref<ProjectAsset[]>([])
const searchLoaded = ref(false)
const searchLoading = ref(false)
const SEARCH_DEBOUNCE_DELAY = 320
let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null

const normalizedSearchQuery = computed(() => searchQuery.value.trim())
const isSearchActive = computed(() => searchLoaded.value && normalizedSearchQuery.value.length > 0)
const tagFilterValues = ref<string[]>([])

const baseDisplayedAssets = computed(() => (isSearchActive.value ? searchResults.value : currentAssets.value))

const tagOptions = computed<TagOption[]>(() => {
  const map = new Map<string, TagOption>()
  baseDisplayedAssets.value.forEach((asset) => {
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
})

const tagOptionMap = computed(() => {
  const entries = tagOptions.value.map((option) => [option.value, option] as const)
  return new Map<string, TagOption>(entries)
})

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
  const base = baseDisplayedAssets.value
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
  dropFeedback.value = { kind, message }
  if (typeof window === 'undefined') {
    return
  }
  clearDropFeedbackTimer()
  dropFeedbackTimer = window.setTimeout(() => {
    dropFeedback.value = null
    dropFeedbackTimer = null
  }, 4000)
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

function assetTypeFromMimeType(mime: string | null | undefined): ProjectAsset['type'] | null {
  if (!mime) {
    return null
  }
  const normalized = mime.toLowerCase()
  if (normalized.startsWith('image/')) {
    return 'image'
  }
  if (normalized.startsWith('model/')) {
    return 'model'
  }
  if (normalized.includes('gltf') || normalized.includes('fbx') || normalized.includes('obj') || normalized.includes('stl')) {
    return 'model'
  }
  if (normalized.includes('ktx') || normalized.includes('texture') || normalized.includes('dds') || normalized.includes('tga')) {
    return 'texture'
  }
  if (normalized.includes('material')) {
    return 'material'
  }
  return null
}

function inferAssetTypeFromExtension(extension: string | null | undefined): ProjectAsset['type'] | null {
  if (!extension) {
    return null
  }
  const normalized = extension.replace(/^[.]/, '').toLowerCase()
  return EXTENSION_TYPE_MAP.get(normalized) ?? null
}

function inferAssetTypeFromFile(file: File, options: { fallbackType?: ProjectAsset['type'] } = {}): ProjectAsset['type'] {
  const mimeType = file.type ?? null
  const mimeTypeResult = assetTypeFromMimeType(mimeType)
  if (mimeTypeResult) {
    return mimeTypeResult
  }
  const extension = extractExtension(file.name ?? '')
  const extensionResult = inferAssetTypeFromExtension(extension)
  if (extensionResult) {
    return extensionResult
  }
  return options.fallbackType ?? 'file'
}

function inferAssetTypeFromUrl(url: string): ProjectAsset['type'] {
  const trimmed = url.trim()
  if (trimmed.startsWith('data:')) {
    const mimeMatch = /^data:([^;,]+);/i.exec(trimmed)
    if (mimeMatch) {
      const mimeType = mimeMatch[1]?.toLowerCase() ?? null
      const inferred = assetTypeFromMimeType(mimeType)
      if (inferred) {
        return inferred
      }
    }
    return 'file'
  }
  const extension = extractExtension(trimmed.split(/[?#]/)[0] ?? '')
  const extensionResult = inferAssetTypeFromExtension(extension)
  if (extensionResult) {
    return extensionResult
  }
  return 'file'
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

function extensionFromMimeType(mime: string | null | undefined): string | null {
  if (!mime) {
    return null
  }
  const mapping: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/tiff': 'tiff',
    'image/x-icon': 'ico',
    'model/gltf+json': 'gltf',
    'model/gltf-binary': 'glb',
    'model/obj': 'obj',
    'model/stl': 'stl',
    'application/octet-stream': 'bin',
  }
  if (mapping[mime]) {
    return mapping[mime]
  }
  const imageMatch = /^image\/([a-z0-9.+-]+)$/i.exec(mime)
  if (imageMatch) {
    return imageMatch[1]!.toLowerCase()
  }
  const modelMatch = /^model\/([a-z0-9.+-]+)$/i.exec(mime)
  if (modelMatch) {
    return modelMatch[1]!.toLowerCase()
  }
  return null
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
    // Ignore URL parsing errors
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
  const extension = extractExtension(trimmed.split(/[?#]/)[0] ?? '')
  if (!extension) {
    return true
  }
  return (inferAssetTypeFromExtension(extension) ?? null) === 'image'
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
      console.warn('解析拖拽 HTML 失败', error)
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
  const type = options.type ?? inferAssetTypeFromFile(file)
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
  const extension = extensionFromMimeType(mimeType) ?? 'bin'
  const type = assetTypeFromMimeType(mimeType) ?? inferAssetTypeFromExtension(extension) ?? 'file'
  const fileName = `pasted-asset-${Date.now().toString(36)}.${extension}`
  const file = new File([blob], fileName, { type: mimeType })
  return importLocalFile(file, { displayName: fileName, type })
}

function importRemoteAssetFromUrl(url: string): ProjectAsset {
  const normalizedUrl = normalizeRemoteUrl(url)
  const assetType = inferAssetTypeFromUrl(normalizedUrl)
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
      const message = (error as Error).message ?? `导入失败：${file.name}`
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
      const message = (error as Error).message ?? `导入失败：${url}`
      errors.push(message)
    }
  }

  return { assets: Array.from(collected.values()), errors }
}

function handleGalleryDragEnter(event: DragEvent) {
  if (!allowAssetDrop.value || dropProcessing.value) {
    return
  }
  if (!event.dataTransfer || isInternalAssetDrag(event) || !isAssetDropPayload(event.dataTransfer)) {
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
  if (!event.dataTransfer || isInternalAssetDrag(event) || !isAssetDropPayload(event.dataTransfer)) {
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
  if (!event.dataTransfer || isInternalAssetDrag(event) || !isAssetDropPayload(event.dataTransfer)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  dropProcessing.value = true
  dropActive.value = false
  dropDragDepth.value = 0
  clearDropFeedbackTimer()
  dropFeedback.value = null
  try {
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
      showDropFeedback('error', `成功导入 ${assets.length} 个资源，但有 ${errors.length} 个失败`)
    } else if (assets.length) {
      showDropFeedback('success', `成功导入 ${assets.length} 个资源`)
    } else if (errors.length) {
      showDropFeedback('error', errors[0] ?? '导入资源失败')
    } else {
      showDropFeedback('error', '未检测到可导入的资源')
    }
  } catch (error) {
    console.error('导入资源失败', error)
    showDropFeedback('error', (error as Error).message ?? '导入资源失败')
  } finally {
    dropProcessing.value = false
  }
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
  const entry = assetCacheStore.entries[cacheId]
  if (entry && entry.status === 'cached' && entry.blobUrl) {
    const mime = entry.mimeType ?? ''
    if (mime.startsWith('image/')) {
      return entry.blobUrl
    }
    if (!mime && (asset.type === 'image' || asset.type === 'texture')) {
      return entry.blobUrl
    }
  }
  if (asset.type === 'image' || asset.type === 'texture') {
    if (asset.thumbnail && isLikelyImageUrl(asset.thumbnail)) {
      return asset.thumbnail
    }
    if (isLikelyImageUrl(asset.downloadUrl)) {
      return asset.downloadUrl
    }
  }
  return undefined
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
    console.warn('从 IndexedDB 加载资源失败', error)
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

  if (asset.type === 'model' && asset.thumbnail) {
    const thumbnail = document.createElement('div')
    thumbnail.style.width = '64px'
    thumbnail.style.height = '64px'
    thumbnail.style.borderRadius = '10px'
    thumbnail.style.backgroundColor = asset.previewColor ?? '#455A64'
    thumbnail.style.backgroundSize = 'cover'
    thumbnail.style.backgroundPosition = 'center'
    thumbnail.style.backgroundImage = `url("${asset.thumbnail}")`
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
  sceneStore.setDraggingAssetId(null)
  if (searchDebounceHandle !== null) {
    clearTimeout(searchDebounceHandle)
    searchDebounceHandle = null
  }
  clearDropFeedbackTimer()
})
</script>

<template>
  <v-card
    :class="['panel-card', { 'is-floating': floating } ]"
    :elevation="floating ? 12 : 8"
  >
    <v-toolbar class="panel-toolbar" height="40px">
      <v-toolbar-title class="panel-title">Project</v-toolbar-title>
      <v-spacer />
      <v-btn
        class="placement-toggle"
        variant="text"
        size="small"
        :icon="placementIcon"
        :title="placementTitle"
        @click="emit('toggle-placement')"
      />
      <v-btn icon="mdi-window-minimize" size="small" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="project-content">
      <Splitpanes class="project-split" @resized="handleProjectSplitResized">
        <Pane :size="treePaneSize">
          <div class="project-tree">
            <v-toolbar density="compact"  height="46">
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
                <v-icon >mdi-folder</v-icon>
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
            class="project-gallery"
            :class="{ 'is-drop-target': dropOverlayVisible, 'has-drop-feedback': dropFeedback }"
            @dragenter="handleGalleryDragEnter"
            @dragover="handleGalleryDragOver"
            @dragleave="handleGalleryDragLeave"
            @drop="handleGalleryDrop"
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
                <v-divider vertical class="mx-1" />
              <v-text-field
                v-model="searchQuery"
                :loading="searchLoading"
                append-inner-icon="mdi-magnify"
                density="compact"
                size="small"
                label="Search..."
                variant="solo"
                hide-details
                single-line
                clearable
                style="max-width: 350px;"
                @keydown.enter.stop.prevent="searchAsset"
                @click:append-inner="searchAsset"
                @click:clear="handleSearchClear"
              />
              <v-btn icon="mdi-refresh" density="compact" variant="text" @click="refreshGallery" />
            </v-toolbar>
            <div
              v-if="dropFeedback"
              :class="[
                'drop-feedback',
                dropFeedback.kind === 'error' ? 'drop-feedback--error' : 'drop-feedback--success',
              ]"
            >
              {{ dropFeedback.message }}
            </div>
            <v-divider />
            <div v-if="tagOptions.length" class="project-tag-filter">
              <v-autocomplete
                v-model="tagFilterValues"
                :items="tagOptions"
                item-title="label"
                item-value="value"
                label="按标签筛选"
                density="comfortable"
                variant="outlined"
                chips
                closable-chips
                multiple
                clearable
                hide-details
              >
                <template #prepend>
                  <v-icon icon="mdi-tag" class="mr-2" />
                </template>
              </v-autocomplete>
            </div>
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
                      <span class="directory-card-subtitle">{{ countDirectoryAssets(directory) }} 个资源</span>
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
                      <div class="asset-progress" v-if="isAssetDownloading(asset)">
                        <v-progress-linear
                          :model-value="assetDownloadProgress(asset)"
                          color="primary"
                          height="4"
                          rounded
                        />
                      </div>
                      <div class="asset-progress" v-else-if="assetDownloadError(asset)">
                        <v-icon size="18" color="error">mdi-alert-circle-outline</v-icon>
                      </div>
                      <v-btn
                        color="primary"
                        variant="tonal"
                        density="compact"
                        icon="mdi-plus"
                        size="small"
                        style="min-width: 20px; height: 20px;"
                        :loading="addPendingAssetId === asset.id"
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
    </div>

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
  </v-card>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgba(18, 22, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}

.panel-card.is-floating {
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  padding: 0 8px;
}

.panel-title {
  font-size: 0.86rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 700;
  color: rgba(233, 236, 241, 0.82);
}

.placement-toggle {
  color: rgba(233, 236, 241, 0.72);
}

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

.project-tag-filter {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background-color: rgba(8, 12, 18, 0.6);
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
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  padding: 12px;
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
  border-color: rgba(0, 172, 193, 0.9);
  box-shadow: 0 0 12px rgba(0, 172, 193, 0.35);
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
  height: 116px;
  position: relative;
  overflow: hidden;
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
  width: 24px;
  height: 24px;
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
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.6) 100%);
  backdrop-filter: blur(1px);
}

.asset-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: #ffffff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  line-height: 1.1;
}

.asset-subtitle {
  font-size: 0.7rem;
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

.panel-toolbar :deep(.v-toolbar-title),
.project-tree :deep(.v-toolbar-title) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-inline-start: 0px;
}

.project-tree-subtitle {
    margin-inline-start: 12px !important;
}

.panel-toolbar :deep(.v-btn) {
  width: 32px;
  height: 32px;
}

.asset-card :deep(.v-card-title) {
  font-size: 0.85rem;
}

.asset-card :deep(.v-card-subtitle) {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
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
