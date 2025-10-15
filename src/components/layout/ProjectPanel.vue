<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore, extractProviderIdFromPackageDirectoryId } from '@/stores/sceneStore'
import { PACKAGES_ROOT_DIRECTORY_ID } from '@/stores/assetCatalog'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { resourceProviders } from '@/resources/projectProviders'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()
const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { projectTree, activeDirectoryId, currentAssets, selectedAssetId } = storeToRefs(sceneStore)

const openedDirectories = ref<string[]>([PACKAGES_ROOT_DIRECTORY_ID])
const draggingAssetId = ref<string | null>(null)
const ASSET_DRAG_MIME = 'application/x-harmony-asset'
let dragPreviewEl: HTMLDivElement | null = null
const addPendingAssetId = ref<string | null>(null)
const deleteDialogOpen = ref(false)
const pendingDeleteAssets = ref<ProjectAsset[]>([])
const isBatchDeletion = ref(false)
const selectedAssetIds = ref<string[]>([])

const providerLoading = ref<Record<string, boolean>>({})
const providerErrors = ref<Record<string, string | null>>({})

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

watch(
  projectTree,
  (tree) => {
    if (!tree) {
      return
    }
    if (!openedDirectories.value.includes(PACKAGES_ROOT_DIRECTORY_ID)) {
      openedDirectories.value = [...openedDirectories.value, PACKAGES_ROOT_DIRECTORY_ID]
    }
  },
  { immediate: true }
)

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
  if (!force && sceneStore.isPackageLoaded(providerId)) {
    return
  }
  const provider = resourceProviders.find((entry) => entry.id === providerId)
  if (!provider) {
    return
  }
  if (!provider.url) {
    sceneStore.setPackageDirectories(providerId, [])
    setProviderError(providerId, null)
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
  } catch (error) {
    setProviderError(providerId, (error as Error).message ?? '资源加载失败')
  } finally {
    setProviderLoading(providerId, false)
  }
}

const activeProviderId = computed(() => findProviderIdForDirectoryId(activeDirectoryId.value ?? null))
const activeProviderError = computed(() => (activeProviderId.value ? getProviderError(activeProviderId.value) : null))
const activeProviderLoading = computed(() => (activeProviderId.value ? isProviderLoading(activeProviderId.value) : false))

function selectAsset(asset: ProjectAsset) {
  sceneStore.selectAsset(asset.id)
}


function isAssetDownloading(asset: ProjectAsset) {
  return assetCacheStore.isDownloading(resolveAssetCacheId(asset))
}

function canDeleteAsset(asset: ProjectAsset) {
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
    const node = await sceneStore.addNodeFromAsset(preparedAsset)
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
  draggingAssetId.value = asset.id
  selectAsset(asset)
  assetCacheStore.touch(preparedAsset.id)
  
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify({ assetId: preparedAsset.id }))
    event.dataTransfer.dropEffect = 'copy'
    const preview = createDragPreview(asset)
    if (preview) {
      const rect = preview.getBoundingClientRect()
      event.dataTransfer.setDragImage(preview, rect.width / 2, rect.height / 2)
    }
  }
}

function handleAssetDragEnd() {
  draggingAssetId.value = null
  destroyDragPreview()
}

function isAssetSelected(assetId: string) {
  return selectedAssetIds.value.includes(assetId)
}

function toggleAssetSelection(asset: ProjectAsset) {
  const assetId = asset.id
  const cacheId = resolveAssetCacheId(asset)
  if (!assetCacheStore.hasCache(cacheId) || isAssetDownloading(asset)) {
    return
  }
  if (isAssetSelected(assetId)) {
    selectedAssetIds.value = selectedAssetIds.value.filter((id) => id !== assetId)
  } else {
    selectedAssetIds.value = [...selectedAssetIds.value, assetId]
  }
}

function openDeleteDialog(assets: ProjectAsset[], batch: boolean) {
  if (!assets.length) {
    return
  }
  const filtered = assets.filter((asset) => assetCacheStore.hasCache(resolveAssetCacheId(asset)))
  if (!filtered.length) {
    return
  }
  pendingDeleteAssets.value = filtered
  isBatchDeletion.value = batch
  deleteDialogOpen.value = true
}

function requestDeleteAsset(asset: ProjectAsset) {
  openDeleteDialog([asset], false)
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
    const removedIds = sceneStore.deleteProjectAssets(assetIds)
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
const displayedAssets = computed(() => (isSearchActive.value ? searchResults.value : currentAssets.value))
const selectedAssets = computed(() =>
  selectedAssetIds.value
    .map((id) => displayedAssets.value.find((asset) => asset.id === id))
    .filter((asset): asset is ProjectAsset => !!asset),
)
const allSelectedAssetsCached = computed(() =>
  selectedAssets.value.length > 0 && selectedAssets.value.every((asset) => assetCacheStore.hasCache(resolveAssetCacheId(asset))),
)
const isToolbarDeleteVisible = computed(() => allSelectedAssetsCached.value)
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
  const warning =
    ' This will remove the asset, its placeholders, and all objects referencing it in the scene. This action cannot be undone.'
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
  if (!entry || entry.status !== 'cached' || !entry.blobUrl) {
    return undefined
  }
  const mime = entry.mimeType ?? ''
  if (mime.startsWith('image/')) {
    return entry.blobUrl
  }
  if (!mime && (asset.type === 'image' || asset.type === 'texture')) {
    return entry.blobUrl
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
  selectedAssetIds.value = selectedAssetIds.value.filter((id) => availableIds.has(id))
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
    case 'texture':
      return 'mdi-texture-box'
    case 'image':
      return 'mdi-image-outline'
    case 'audio':
      return 'mdi-music-note-outline'
    case 'file':
      return 'mdi-file-outline'
    default:
      return 'mdi-cube'
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
}

onBeforeUnmount(() => {
  destroyDragPreview()
  if (searchDebounceHandle !== null) {
    clearTimeout(searchDebounceHandle)
    searchDebounceHandle = null
  }
})
</script>

<template>
  <v-card class="panel-card" elevation="8">
    <v-toolbar density="compact" class="panel-toolbar"  title="Project" height="40">

      <v-spacer />
      <v-btn icon="mdi-window-minimize" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="project-content">
      <div class="project-tree">
        <v-toolbar density="compact" flat height="46">
          <v-toolbar-title class="text-subtitle-2 project-tree-subtitle">Resource</v-toolbar-title>
          <v-spacer />
        </v-toolbar>
        <v-divider />
        <v-treeview
          v-model:opened="openedDirectories"
          v-model:activated="selectedDirectory"
          :items="projectTree"
          density="compact"
          item-title="name"
          item-value="id"
          activatable
          class="tree-view"
        >
          <template #prepend>
            <v-icon size="small">mdi-folder</v-icon>
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
      <div class="project-gallery">
        <v-toolbar density="compact" flat height="46">
          <v-toolbar-title class="text-subtitle-2 project-tree-subtitle">Thumbnails</v-toolbar-title>
          <v-spacer />
          <v-tooltip v-if="isToolbarDeleteVisible" text="Delete Selected Assets">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                color="error"
                variant="tonal"
                icon="mdi-trash-can-outline"
                size="small"
                @click="requestDeleteSelection"
              />
            </template>
          </v-tooltip>
          <v-text-field
            v-model="searchQuery"
            :loading="searchLoading"
            append-inner-icon="mdi-magnify"
            density="compact"
            label="Search..."
            variant="solo"
            hide-details
            single-line
            clearable
            @keydown.enter.stop.prevent="searchAsset"
            @click:append-inner="searchAsset"
            @click:clear="handleSearchClear"
          />
          <v-btn icon="mdi-refresh" variant="text" @click="refreshGallery" />
        </v-toolbar>
        <v-divider />
        <div class="project-gallery-scroll">
          <div v-if="displayedAssets.length" class="gallery-grid">
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
                  <v-tooltip text="Select for deletion">
                    <template #activator="{ props }">
                      <v-checkbox-btn
                        v-bind="props"
                        :model-value="isAssetSelected(asset.id)"
                        density="compact"
                        color="primary"
                        :disabled="!canDeleteAsset(asset)"
                        @click.stop
                        @update:model-value="() => toggleAssetSelection(asset)"
                      />
                    </template>
                  </v-tooltip>
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
              <v-card-actions class="asset-actions">
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
                <v-spacer />
                <v-tooltip v-if="canDeleteAsset(asset)" text="Delete Asset">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      color="error"
                      variant="tonal"
                      density="compact"
                      icon="mdi-trash-can-outline"
                      size="small"
                      style="min-width: 20px; height: 20px;"
                      @click.stop="requestDeleteAsset(asset)"
                    />
                  </template>
                </v-tooltip>
                <v-btn
                  color="primary"
                  variant="tonal"
                  density="compact"
                  icon="mdi-plus"
                  size="small"
                  style="min-width: 20px; height: 20px;"
                  :loading="addPendingAssetId === asset.id"
                  @click.stop="handleAddAsset(asset)"
                >
                </v-btn>
              </v-card-actions>
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
      </div>
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
  background-color: rgba(28, 30, 33, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.project-content {
  display: grid;
  grid-template-columns: 240px 1fr;
  flex: 1;
  min-height: 0;
}

.project-tree {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  min-height: 0;
}

.project-gallery {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.project-gallery-scroll {
  flex: 1;
  overflow-y: auto;
}

.tree-view {
  flex: 1;
  overflow-y: auto;
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  position: relative;
  overflow: hidden;
}

.asset-select-control {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
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
.project-tree :deep(.v-toolbar-title),
.project-gallery :deep(.v-toolbar-title) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-inline-start: 0px;
}

.project-tree-subtitle {
    margin-inline-start: 12px !important;
}

.toolbar-title {
  display: flex;
  align-items: center;
  gap: 6px;
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

.v-card-actions {
  min-height: 32px;
}

.asset-actions {
  align-items: center;
  gap: 8px;
  padding-inline: 12px;
  padding-block: 6px;
}

.asset-progress {
  flex: 1;
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
</style>
