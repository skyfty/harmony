<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { assetProvider } from '@/resources/projectProviders/asset'
import { determineAssetCategoryId } from '@/stores/assetCatalog'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    assetId?: string
    assetType?: string
    seriesId?: string
    allowedMixtureTypes?: string[]
    assets?: ProjectAsset[]
    anchor?: { x: number; y: number } | null
    title?: string
    confirmText?: string
    cancelText?: string
  }>(),
  {
    assetId: '',
    assetType: '',
    seriesId: '',
    anchor: null,
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'update:asset', value: ProjectAsset | null): void
  (event: 'cancel'): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { assetCatalog } = storeToRefs(sceneStore)

const selectedAssetId = ref(props.assetId ?? '')
const remoteAssets = ref<ProjectAsset[]>([])
const remoteLoaded = ref(false)
const loading = ref(false)
const selectingAssetId = ref<string | null>(null)
const errorMessage = ref<string | null>(null)
const searchTerm = ref('')
const gridRef = ref<HTMLDivElement | null>(null)
const panelRef = ref<HTMLDivElement | null>(null)
const panelStyle = ref<Record<string, string>>({ top: '0px', left: '0px' })
let resizeRaf: number | null = null
let listenersAttached = false

function flattenCatalog(catalog: Record<string, ProjectAsset[]> | undefined): ProjectAsset[] {
  if (!catalog) {
    return []
  }
  return Object.values(catalog).flatMap((group) => (Array.isArray(group) ? group : []))
}

function assetThumbnailUrl(asset: ProjectAsset): string | null {
  return assetCacheStore.resolveAssetThumbnail({ asset })
}

function flattenDirectories(directories: ProjectDirectory[]): ProjectAsset[] {
  const bucket: ProjectAsset[] = []
  const visit = (list: ProjectDirectory[]) => {
    list.forEach((dir) => {
      if (dir.assets?.length) {
        bucket.push(...dir.assets)
      }
      if (dir.children?.length) {
        visit(dir.children)
      }
    })
  }
  visit(directories)
  return bucket
}

function getAnchorPoint(): { x: number; y: number } {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 }
  }
  const point = props.anchor
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return point
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

async function updatePanelPosition() {
  if (!dialogOpen.value) {
    return
  }
  await nextTick()
  const panel = panelRef.value
  if (!panel || typeof window === 'undefined') {
    return
  }
  const { innerWidth: viewportWidth, innerHeight: viewportHeight } = window
  const anchor = getAnchorPoint()
  const offset = 12
  const rect = panel.getBoundingClientRect()
  const width = rect.width
  const height = rect.height

  let left = anchor.x + offset
  let top = anchor.y + offset

  if (left + width > viewportWidth - offset) {
    left = anchor.x - width - offset
  }
  if (top + height > viewportHeight - offset) {
    top = anchor.y - height - offset
  }

  if (left + width > viewportWidth - offset) {
    left = viewportWidth - width - offset
  }
  if (top + height > viewportHeight - offset) {
    top = viewportHeight - height - offset
  }

  if (left < offset) {
    left = offset
  }
  if (top < offset) {
    top = offset
  }

  panelStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  }
}

function queuePanelReposition() {
  if (!dialogOpen.value) {
    return
  }
  if (resizeRaf !== null) {
    cancelAnimationFrame(resizeRaf)
  }
  resizeRaf = requestAnimationFrame(async () => {
    resizeRaf = null
    await updatePanelPosition()
  })
}

function handleWindowResize() {
  queuePanelReposition()
}

function handleWindowScroll() {
  queuePanelReposition()
}

function handleGlobalPointerDown(event: PointerEvent) {
  if (!dialogOpen.value) {
    return
  }
  const panel = panelRef.value
  if (!panel) {
    return
  }
  const target = event.target as Node | null
  if (target && panel.contains(target)) {
    return
  }
  handleCancel()
}

function handleKeydown(event: KeyboardEvent) {
  if (!dialogOpen.value) {
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    handleCancel()
  }
}

function attachGlobalListeners() {
  if (typeof window === 'undefined' || listenersAttached) {
    return
  }
  document.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('scroll', handleWindowScroll, true)
  document.addEventListener('keydown', handleKeydown)
  listenersAttached = true
}

function detachGlobalListeners() {
  if (!listenersAttached || typeof window === 'undefined') {
    return
  }
  document.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('scroll', handleWindowScroll, true)
  document.removeEventListener('keydown', handleKeydown)
  listenersAttached = false
  if (resizeRaf !== null) {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = null
  }
}

async function loadRemoteAssets() {
  if (remoteLoaded.value || loading.value) {
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    // We only fetch the manifest once per dialog lifecycle to avoid redundant network traffic.
    const directories = await assetProvider.load?.()
    if (directories) {
      remoteAssets.value = flattenDirectories(directories)
    } else {
      remoteAssets.value = []
    }
    remoteLoaded.value = true
    await scheduleScrollToSelected()
  } catch (error) {
    console.warn('Failed to load asset provider manifest', error)
    errorMessage.value = (error as Error).message ?? '无法加载资产列表'
  } finally {
    loading.value = false
    if (dialogOpen.value) {
      queuePanelReposition()
    }
  }
}

onMounted(() => {
  if (dialogOpen.value) {
    attachGlobalListeners()
    queuePanelReposition()
    void scheduleScrollToSelected()
  }
})

onBeforeUnmount(() => {
  detachGlobalListeners()
})

watch(dialogOpen, (open) => {
  if (open) {
    attachGlobalListeners()
    const anchor = getAnchorPoint()
    panelStyle.value = {
      top: `${Math.round(anchor.y + 12)}px`,
      left: `${Math.round(anchor.x + 12)}px`,
    }
    selectedAssetId.value = props.assetId ?? ''
    if (!props.assets?.length) {
      void loadRemoteAssets()
    }
    void scheduleScrollToSelected()
    queuePanelReposition()
  } else {
    searchTerm.value = ''
    detachGlobalListeners()
  }
})

watch(
  () => props.assetId,
  (next) => {
    if (typeof next === 'string') {
      selectedAssetId.value = next
    } else {
      selectedAssetId.value = ''
    }
    void scheduleScrollToSelected()
  },
)

watch(
  () => (props.anchor ? `${props.anchor.x},${props.anchor.y}` : ''),
  () => {
    if (dialogOpen.value) {
      queuePanelReposition()
    }
  },
)

const sceneAssets = computed(() => flattenCatalog(assetCatalog.value))

const allAssets = computed(() => {
  const provided = props.assets?.length ? props.assets : []
  const combined = [...provided, ...sceneAssets.value, ...remoteAssets.value]
  const unique = new Map<string, ProjectAsset>()
  combined.forEach((asset) => {
    if (!asset || !asset.id) {
      return
    }
    if (!unique.has(asset.id)) {
      unique.set(asset.id, asset)
    }
  })
  return Array.from(unique.values())
})

const filteredAssets = computed(() => {
  const typeFilterRaw = props.assetType?.trim() ?? ''
  const typeFilters = typeFilterRaw.length
    ? typeFilterRaw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    : []
  const seriesFilter = props.seriesId?.trim() ?? ''
  const allowedMixtureTypes = Array.isArray(props.allowedMixtureTypes)
    ? props.allowedMixtureTypes.map((value) => (typeof value === 'string' ? value.trim() : '')).filter((value) => value.length > 0)
    : []
  const term = searchTerm.value.trim().toLowerCase()
  return allAssets.value.filter((asset) => {
    if (typeFilters.length && !typeFilters.includes(asset.type)) {
      return false
    }
    if (seriesFilter) {
      const assetSeries = asset.seriesId?.trim() ?? ''
      if (assetSeries !== seriesFilter) {
        return false
      }
    }
    if (allowedMixtureTypes.length) {
      const mixtureType = typeof asset.mixtureType === 'string' ? asset.mixtureType.trim() : ''
      if (!mixtureType || !allowedMixtureTypes.includes(mixtureType)) {
        return false
      }
    }
    if (!term) {
      return true
    }
    const haystack = `${asset.name} ${asset.id}`.toLowerCase()
    return haystack.includes(term)
  })
})

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\]^`{|}~])/g, '\\$1')
}

function scrollSelectedAssetIntoView() {
  if (typeof document === 'undefined') {
    return
  }
  const container = gridRef.value
  const id = selectedAssetId.value
  if (!container || !id) {
    return
  }
  const selector = `[data-asset-id="${cssEscape(id)}"]`
  const target = container.querySelector(selector) as HTMLElement | null
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }
}

async function scheduleScrollToSelected() {
  if (!dialogOpen.value) {
    return
  }
  await nextTick()
  scrollSelectedAssetIntoView()
  await updatePanelPosition()
}

watch(
  () => filteredAssets.value.map((asset) => asset.id).join('|'),
  () => {
    void scheduleScrollToSelected()
  },
)

watch(selectedAssetId, () => {
  void scheduleScrollToSelected()
})

async function handleAssetClick(asset: ProjectAsset) {
  selectedAssetId.value = asset.id

  const mapped = ensureSceneAssetMapping(asset)
  if (!mapped || !mapped.id) {
    emit('update:asset', mapped)
    return
  }

  const requiresCache = mapped.type === 'model' || mapped.type === 'mesh'
  if (!requiresCache) {
    emit('update:asset', mapped)
    return
  }

  if (assetCacheStore.hasCache(mapped.id)) {
    emit('update:asset', mapped)
    return
  }

  if (selectingAssetId.value) {
    return
  }

  selectingAssetId.value = mapped.id
  try {
    await assetCacheStore.downloaProjectAsset(mapped)
    if (!assetCacheStore.hasCache(mapped.id)) {
      return
    }
    emit('update:asset', mapped)
  } catch (error) {
    console.warn('Failed to download selected model asset', mapped.id, error)
  } finally {
    selectingAssetId.value = null
  }
}

function handleClearSelection() {
  selectedAssetId.value = ''
  emit('update:asset', null)
}

function ensureSceneAssetMapping(asset: ProjectAsset): ProjectAsset {
  if (!asset || !asset.id) {
    return asset
  }

  const existing = sceneStore.getAsset(asset.id)
  if (existing) {
    const remoteKey = `url::${existing.id}`
    if (!sceneStore.packageAssetMap[remoteKey] && existing.downloadUrl && existing.downloadUrl.trim().length) {
      void sceneStore.syncAssetPackageMapEntry(existing, sceneStore.assetIndex[existing.id]?.source)
    }
    return existing
  }

  try {
    const normalizedAsset: ProjectAsset = {
      ...asset,
      gleaned: asset.gleaned ?? true,
    }
    return sceneStore.registerAsset(normalizedAsset, {
      categoryId: determineAssetCategoryId(normalizedAsset),
      source: { type: 'url' },
      commitOptions: { updateNodes: false },
    })
  } catch (error) {
    console.warn('Failed to register selected asset for scene mapping', asset.id, error)
    return asset
  }
}


function handleCancel() {
  emit('cancel')
  dialogOpen.value = false
}

function resolveInitials(asset: ProjectAsset): string {
  if (!asset.name) {
    return '?'
  }
  const segments = asset.name.trim().split(/\s+/)
  if (!segments.length) {
    return '?'
  }
  const letters = segments.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('')
  return letters || '?'
}

</script>

<template>
  <Teleport to="body">
    <transition name="asset-dialog-popover">
      <div v-if="dialogOpen" class="asset-dialog__wrapper">
        <div
          ref="panelRef"
          class="asset-dialog__popover"
          :style="panelStyle"
        >
        <v-toolbar density="compact" class="panel-toolbar" height="40px">
          <div class="toolbar-text">
            <div class="asset-dialog__title">{{ title ?? 'Select Asset' }}</div>
          </div>
          <v-spacer />
          <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleCancel" />
        </v-toolbar>

          <div class="asset-dialog__header">
            <v-text-field
              v-model="searchTerm"
              class="asset-dialog__search"
              density="compact"
              variant="underlined"
              prepend-inner-icon="mdi-magnify"
                placeholder="Search assets"
              clearable
              hide-details
            />
          </div>
          <div class="asset-dialog__body">
 
            <div v-if="loading" class="asset-dialog__loading">
              <v-progress-circular indeterminate color="primary" />
            </div>

            <div v-else ref="gridRef" class="asset-dialog__grid">
              <div
                class="asset-dialog__tile asset-dialog__tile--none"
                :class="{ 'asset-dialog__tile--selected': !selectedAssetId }"
                data-asset-id="__none__"
                @click="handleClearSelection"
              >
                <div class="asset-dialog__thumbnail">
                  <div class="asset-dialog__thumbnail-placeholder asset-dialog__thumbnail-placeholder--none">
                    <v-icon size="28">mdi-close-circle-outline</v-icon>
                  </div>
                </div>
              </div>
              <div
                v-for="asset in filteredAssets"
                :key="asset.id"
                class="asset-dialog__tile"
                :class="{ 'asset-dialog__tile--selected': asset.id === selectedAssetId }"
                :data-asset-id="asset.id"
                @click="handleAssetClick(asset)"
              >
                <div class="asset-dialog__thumbnail">
                  <v-img
                    v-if="assetThumbnailUrl(asset)"
                    :src="assetThumbnailUrl(asset) || undefined"
                    :alt="asset.name"
                    height="68"
                    cover
                  />
                  <div
                    v-else
                    class="asset-dialog__thumbnail-placeholder"
                    :style="{ backgroundColor: asset.previewColor || '#455A64' }"
                  >
                    {{ resolveInitials(asset) }}
                  </div>
                  <div class="asset-dialog__name" :title="asset.name">{{ asset.name }}</div>
                </div>
              </div>
            </div>

            <div v-if="!loading && !filteredAssets.length" class="asset-dialog__empty">
                No assets match the criteria
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>

.asset-dialog__wrapper {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 40;
  
}

.asset-dialog__popover {
  position: fixed;
  pointer-events: auto;
  width: 320px;
  max-width: 360px;
  max-height: min(600px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;

  background-color: rgba(18, 22, 28, 0.72);

  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.toolbar-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toolbar-close {
  color: rgba(233, 236, 241, 0.72);
}

.asset-dialog__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1px 4px 4px;
}

.asset-dialog__title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.94);
}

.asset-dialog__search {
  flex: 1;
  margin-left: auto;
}

.asset-dialog__body {
  flex: 1;
  padding: 8px 14px 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 300px;
}

.asset-dialog__alert {
  align-self: stretch;
}

.asset-dialog__alert-message {
  margin-bottom: 0.4rem;
}

.asset-dialog__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
}

.asset-dialog__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
}

.asset-dialog__tile {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(20, 24, 30, 0.8);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.asset-dialog__tile:hover {
  border-color: rgba(77, 208, 225, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}

.asset-dialog__tile--selected {
  border-color: rgba(77, 208, 225, 1);
  box-shadow: 0 6px 18px rgba(0, 188, 212, 0.35);
}

.asset-dialog__thumbnail {
  position: relative;
  width: 100%;
  height: 78px;
  background: rgba(33, 150, 243, 0.18);
  overflow: hidden;
}

.asset-dialog__thumbnail :deep(img) {
  height: 100%;
  width: 100%;
}

.asset-dialog__thumbnail-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 1.1rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.asset-dialog__thumbnail-placeholder--none {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
  color: rgba(233, 236, 241, 0.9);
}

.asset-dialog__tile--none .asset-dialog__thumbnail {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.asset-dialog__name {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 1;
  pointer-events: none;
}

.asset-dialog__type {
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.6);
}

.asset-dialog__empty {
  padding: 12px 0 18px;
  text-align: center;
  color: rgba(233, 236, 241, 0.65);
  font-size: 0.82rem;
}

.asset-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 14px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 14, 20, 0.6);
}
</style>
