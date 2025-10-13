<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore, type ProjectAsset, type ProjectDirectory } from '@/stores/sceneStore'
import { resourceProviders } from '@/resources/projectProviders'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()

const sceneStore = useSceneStore()
const { projectTree, activeDirectoryId, currentAssets, selectedAssetId } = storeToRefs(sceneStore)

const openedDirectories = ref<string[]>([])
const draggingAssetId = ref<string | null>(null)
const ASSET_DRAG_MIME = 'application/x-harmony-asset'
let dragPreviewEl: HTMLDivElement | null = null

const selectedProviderId = ref<string>(resourceProviders[0]!.id)
const providerLoading = ref(false)
const providerError = ref<string | null>(null)
const providerCache = new Map<string, ProjectDirectory[]>()

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
    openedDirectories.value = expandAllDirectories(tree)
  },
  { immediate: true }
)

watch(
  selectedProviderId,
  (providerId) => {
    loadResourceProvider(providerId)
  },
  { immediate: true }
)

function expandAllDirectories(tree: Array<{ id: string; children?: unknown[] }>): string[] {
  const ids: string[] = []
  for (const node of tree) {
    ids.push(node.id)
    if (Array.isArray(node.children) && node.children.length) {
      ids.push(...expandAllDirectories(node.children as Array<{ id: string; children?: unknown[] }>))
    }
  }
  return ids
}

function selectAsset(asset: ProjectAsset) {
  sceneStore.selectAsset(asset.id)
}

function addAssetToScene(asset: ProjectAsset) {
  sceneStore.addNodeFromAsset(asset)
}

function refreshGallery() {
}

function handleAssetDragStart(event: DragEvent, asset: ProjectAsset) {
  draggingAssetId.value = asset.id
  selectAsset(asset)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify({ assetId: asset.id }))
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

function isAssetDragging(assetId: string) {
  return draggingAssetId.value === assetId
}

const searchLoaded = ref(false)
const searchLoading = ref(false)

function searchAsset () {
  searchLoading.value = true
  setTimeout(() => {
    searchLoading.value = false
    searchLoaded.value = true
  }, 2000)
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
})

async function loadResourceProvider(providerId: string) {
  const provider = resourceProviders.find((entry) => entry.id === providerId)
  if (!provider) {
    return
  }

  providerError.value = null

  if (!provider.url) {
    sceneStore.resetProjectTree()
    return
  }

  if (providerCache.has(providerId)) {
    sceneStore.setProjectTree(providerCache.get(providerId) ?? [])
    return
  }

  providerLoading.value = true
  try {
    const response = await fetch(provider.url)
    if (!response.ok) {
      throw new Error(`资源加载失败（${response.status}）`)
    }
    const json = await response.json()
    const transformed = provider.transform ? provider.transform(json) : []
    providerCache.set(providerId, transformed)
    sceneStore.setProjectTree(transformed)
  } catch (error) {
    providerError.value = (error as Error).message ?? '资源加载失败'
  } finally {
    providerLoading.value = false
  }
}
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
          <v-toolbar-title class="text-subtitle-2 project-tree-subtitle">Assets</v-toolbar-title>
          <v-spacer />
          <v-menu location="bottom end" transition="fade-transition">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-database-cog"
                variant="text"
                color="primary"
                density="comfortable"
                class="resource-menu-btn"
                :loading="providerLoading"
              />
            </template>
            <v-sheet class="resource-menu" elevation="8">
              <v-list density="comfortable">
                <v-list-item
                  v-for="provider in resourceProviders"
                  :key="provider.id"
                  :value="provider.id"
                  :active="selectedProviderId === provider.id"
                  @click="selectedProviderId = provider.id"
                >
                  <template #prepend>
                    <v-icon size="20" color="primary">
                      {{ provider.id === 'builtin' ? 'mdi-database' : 'mdi-web' }}
                    </v-icon>
                  </template>
                  <v-list-item-title>{{ provider.name }}</v-list-item-title>
                  <template #append>
                    <v-icon v-if="selectedProviderId === provider.id" color="primary">mdi-check</v-icon>
                  </template>
                </v-list-item>
              </v-list>
              <v-alert
                v-if="providerError"
                type="error"
                density="compact"
                variant="tonal"
                class="mt-2"
              >{{ providerError }}</v-alert>
            </v-sheet>
          </v-menu>
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
          open-on-click
          class="tree-view"
        >
          <template #prepend>
            <v-icon size="small">mdi-folder</v-icon>
          </template>
        </v-treeview>
      </div>
      <div class="project-gallery">
        <v-toolbar density="compact" flat height="46">
          <v-toolbar-title class="text-subtitle-2 project-tree-subtitle">Thumbnails</v-toolbar-title>
           <v-spacer />
          <v-text-field
            :loading="searchLoading"
            append-inner-icon="mdi-magnify"
            density="compact"
            label="Search..."
            variant="solo"
            hide-details
            single-line
            @click:append-inner="searchAsset"
          ></v-text-field>
           <v-btn icon="mdi-refresh" variant="text" @click="refreshGallery" />
        </v-toolbar>
        <v-divider />
        <div class="project-gallery-scroll">
          <div v-if="currentAssets.length" class="gallery-grid">
            <v-card
              v-for="asset in currentAssets"
              :key="asset.id"
              :class="[
                'asset-card',
                {
                  'is-selected': selectedAssetId === asset.id,
                  'is-dragging': isAssetDragging(asset.id),
                },
              ]"
              elevation="4"
              draggable="true"
              @click="selectAsset(asset)"
              @dragstart.stop="handleAssetDragStart($event, asset)"
              @dragend="handleAssetDragEnd"
            >
              <div class="asset-preview" :style="{ background: asset.previewColor }">
                <v-icon size="32" color="white">{{ assetIcon(asset.type) }}</v-icon>
              </div>
              <v-card-item>
                <v-card-title>{{ asset.name }}</v-card-title>
              </v-card-item>
              <v-card-actions>
                <v-btn
                  color="primary"
                  variant="tonal"
                  density="compact"
                  icon="mdi-plus"
                  size="small"
                  style="min-width: 20px; height: 20px;"
                  @click.stop="addAssetToScene(asset)"
                >
                </v-btn>
              </v-card-actions>
            </v-card>
          </div>
          <div v-else class="placeholder-text">Select a folder to preview assets.</div>
        </div>
      </div>
    </div>
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

.resource-menu-btn {
  color: rgba(233, 236, 241, 0.85) !important;
}

.resource-menu {
  min-width: 220px;
  padding: 8px 0 4px;
  background-color: rgba(25, 28, 33, 0.96);
  border: 1px solid rgba(77, 208, 225, 0.16);
  border-radius: 12px;
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
  padding-inline-start: 12px;
}

.tree-view :deep(.v-treeview-node__level) {
  margin-inline-start: 12px;
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

.asset-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
</style>
