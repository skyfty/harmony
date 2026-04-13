<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { SERVER_ASSET_PROVIDER_ID } from '@/utils/serverAssetSource'
import { getAssetTypePresentation } from '@/utils/assetTypePresentation'
import { getAssetSourcePresentation } from '@/utils/assetSourcePresentation'
import { usesTransparentThumbnailBackground } from '@/utils/assetThumbnailTransparency'

const props = withDefaults(
  defineProps<{
    active?: boolean
    assetId?: string
    assetType?: string
    seriesId?: string
    /** Optional list of allowed filename extensions (without dot), e.g. ['wall', 'glb']. */
    extensions?: string[]
    thumbnailSize?: number
    assets?: ProjectAsset[]
    showSearch?: boolean
  }>(),
  {
    active: true,
    assetId: '',
    assetType: '',
    seriesId: '',
      extensions: undefined,
      thumbnailSize: 56,
    showSearch: true,
  },
)

const emit = defineEmits<{
  (event: 'update:asset', value: ProjectAsset | null): void
  (event: 'layout'): void
}>()

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
const showLocalSources = ref(true)
const showRemoteSources = ref(true)
const gridRef = ref<HTMLDivElement | null>(null)

function isAssetDownloading(asset: ProjectAsset): boolean {
  if (!asset?.id) {
    return false
  }
  return assetCacheStore.isDownloading(asset.id) || selectingAssetId.value === asset.id
}

function assetDownloadProgress(asset: ProjectAsset): number {
  if (!asset?.id) {
    return 0
  }
  return assetCacheStore.getProgress(asset.id)
}

function assetDownloadError(asset: ProjectAsset): string | null {
  if (!asset?.id) {
    return null
  }
  return assetCacheStore.getError(asset.id)
}

function isServerProviderAsset(asset: ProjectAsset): boolean {
  if (!asset?.id) {
    return false
  }
  if (typeof asset.fileKey === 'string' && asset.fileKey.trim().length > 0) {
    return true
  }
  return remoteAssets.value.some((candidate) => candidate.id === asset.id)
}

function flattenCatalog(catalog: Record<string, ProjectAsset[]> | undefined): ProjectAsset[] {
  if (!catalog) {
    return []
  }
  return Object.values(catalog).flatMap((group) => (Array.isArray(group) ? group : []))
}

function assetThumbnailUrl(asset: ProjectAsset): string | null {
  return assetCacheStore.resolveAssetThumbnail({ asset })
}

function assetThumbnailPlaceholderStyle(asset: ProjectAsset): { backgroundColor?: string } | undefined {
  if (usesTransparentThumbnailBackground(asset)) {
    return undefined
  }
  return { backgroundColor: asset.previewColor || '#455A64' }
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
    ? typeFilterRaw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : []
  const seriesFilter = props.seriesId?.trim() ?? ''

  const normalizedExtensions = (Array.isArray(props.extensions) ? props.extensions : [])
    .map((ext) => (typeof ext === 'string' ? ext.trim().toLowerCase().replace(/^\./, '') : ''))
    .filter((ext) => ext.length > 0)

  const matchesExtension = (asset: ProjectAsset): boolean => {
    if (!normalizedExtensions.length) {
      return true
    }
    const source = (asset.description ?? asset.name ?? '').trim().toLowerCase()
    const dotIndex = source.lastIndexOf('.')
    if (dotIndex < 0 || dotIndex === source.length - 1) {
      return false
    }
    const ext = source.slice(dotIndex + 1)
    return normalizedExtensions.includes(ext)
  }

  const term = searchTerm.value.trim().toLowerCase()
  return allAssets.value.filter((asset) => {
    const sourceKind = getAssetSourcePresentation(asset).kind
    const isRemoteSource = sourceKind === 'remote'
    if (isRemoteSource && !showRemoteSources.value) {
      return false
    }
    if (!isRemoteSource && !showLocalSources.value) {
      return false
    }
    if (typeFilters.length && !typeFilters.includes(asset.type)) {
      return false
    }
    if (seriesFilter) {
      const assetSeries = asset.seriesId?.trim() ?? ''
      if (assetSeries !== seriesFilter) {
        return false
      }
    }
      if (!matchesExtension(asset)) {
        return false
      }

    if (!term) {
      return true
    }
    const haystack = `${asset.name} ${asset.id}`.toLowerCase()
    return haystack.includes(term)
  })
})

const gridStyle = computed(() => {
  const size = Number(props.thumbnailSize ?? 78)
  const minThumb = Math.max(40, isFinite(size) ? size : 78)
  // add padding/label space so items have breathing room
  const colWidth = Math.round(minThumb + 16)
  return {
    gridTemplateColumns: `repeat(auto-fit, minmax(${colWidth}px, 1fr))`,
    ['--thumb-size']: `${minThumb}px`,
  } as Record<string, string>
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
  if (!props.active) {
    return
  }
  await nextTick()
  scrollSelectedAssetIntoView()
  emit('layout')
}

async function loadRemoteAssets() {
  if (remoteLoaded.value || loading.value) {
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    const directories = await sceneStore.ensurePackageDirectoriesLoaded(SERVER_ASSET_PROVIDER_ID)
    if (directories.length) {
      remoteAssets.value = flattenDirectories(directories)
    } else {
      remoteAssets.value = []
    }
    remoteLoaded.value = true
    await scheduleScrollToSelected()
  } catch (error) {
    console.warn('Failed to load asset provider manifest', error)
    errorMessage.value = (error as Error).message ?? 'Unable to load asset list'
  } finally {
    loading.value = false
    if (props.active) {
      emit('layout')
    }
  }
}

function ensureSceneAssetMapping(asset: ProjectAsset): ProjectAsset {
  if (!asset || !asset.id) {
    return asset
  }

  try {
    const normalizedAsset: ProjectAsset = {
      ...asset,
      gleaned: asset.gleaned ?? true,
    }
    return sceneStore.ensureSceneAssetRegistered(normalizedAsset, {
      providerId: isServerProviderAsset(normalizedAsset) ? SERVER_ASSET_PROVIDER_ID : undefined,
      source: normalizedAsset.source ?? { type: 'url' },
      commitOptions: { updateNodes: false },
    })
  } catch (error) {
    console.warn('Failed to register selected asset for scene mapping', asset.id, error)
    return asset
  }
}

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
    await assetCacheStore.downloadProjectAsset(mapped)
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

function resolveInitials(asset: ProjectAsset): string {
  if (!asset.name) {
    return '?'
  }
  const segments = asset.name.trim().split(/\s+/)
  if (!segments.length) {
    return '?'
  }
  const letters =
    segments
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
  return letters || '?'
}

function assetTypePresentation(asset: ProjectAsset) {
  return getAssetTypePresentation(asset)
}

function toggleLocalSourceFilter(): void {
  showLocalSources.value = !showLocalSources.value
}

function toggleRemoteSourceFilter(): void {
  showRemoteSources.value = !showRemoteSources.value
}

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
  () => filteredAssets.value.map((asset) => asset.id).join('|'),
  () => {
    void scheduleScrollToSelected()
  },
)

watch(selectedAssetId, () => {
  void scheduleScrollToSelected()
})

watch(
  () => props.active,
  (active) => {
    if (!active) {
      return
    }
    void scheduleScrollToSelected()
    if (!props.assets?.length) {
      void loadRemoteAssets()
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (!props.active) {
    return
  }
  void scheduleScrollToSelected()
  if (!props.assets?.length) {
    void loadRemoteAssets()
  }
})
</script>

<template>
  <div class="asset-picker-list">
    <div v-if="showSearch" class="asset-picker-list__header">
      <v-text-field
        v-model="searchTerm"
        class="asset-picker-list__search"
        density="compact"
        variant="underlined"
        placeholder="Search assets"
        prepend-inner-icon="mdi-magnify"
        clearable
        hide-details
      >
        <template #append-inner>
          <div class="asset-picker-list__search-actions" aria-label="Source filters">
            <v-btn
              class="asset-picker-list__search-action"
              :class="{ 'asset-picker-list__search-action--active': showLocalSources }"
              :color="showLocalSources ? 'primary' : undefined"
              variant="plain"
              icon="mdi-folder-outline"
              density="compact"
              size="x-small"
              title="本地"
              aria-label="Toggle local assets"
              :aria-pressed="showLocalSources"
              @click="toggleLocalSourceFilter"
            />
            <v-btn
              class="asset-picker-list__search-action"
              :class="{ 'asset-picker-list__search-action--active': showRemoteSources }"
              :color="showRemoteSources ? 'primary' : undefined"
              variant="plain"
              icon="mdi-cloud-outline"
              density="compact"
              size="x-small"
              title="远程"
              aria-label="Toggle remote assets"
              :aria-pressed="showRemoteSources"
              @click="toggleRemoteSourceFilter"
            />
          </div>
        </template>
      </v-text-field>
    </div>

    <div class="asset-picker-list__body">
      <div v-if="loading" class="asset-picker-list__loading">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <div v-else ref="gridRef" class="asset-picker-list__grid" :style="gridStyle">
        <v-tooltip open-delay="150" location="top">
          <template #activator="{ props }">
              <div
                v-bind="props"
                class="asset-picker-list__tile asset-picker-list__tile--none"
                :class="{ 'asset-picker-list__tile--selected': !selectedAssetId }"
                data-asset-id="__none__"
                @click="handleClearSelection"
                tabindex="0"
                aria-label="Clear selection"
                @keydown.enter.prevent="handleClearSelection"
                @keydown.space.prevent="handleClearSelection"
                :title="'Clear selection'"
              >
              <div class="asset-picker-list__thumbnail">
                <div class="asset-picker-list__thumbnail-placeholder asset-picker-list__thumbnail-placeholder--none">
                  <v-icon size="28">mdi-close-circle-outline</v-icon>
                </div>
              </div>
            </div>
          </template>
          <div>Clear selection</div>
        </v-tooltip>

        <template v-for="asset in filteredAssets" :key="asset.id">
          <v-tooltip open-delay="150" location="top">
            <template #activator="{ props }">
              <div
                v-bind="props"
                class="asset-picker-list__tile"
                :class="{ 'asset-picker-list__tile--selected': asset.id === selectedAssetId }"
                :data-asset-id="asset.id"
                @click="handleAssetClick(asset)"
                tabindex="0"
                :aria-label="`Select ${asset.name} (${assetTypePresentation(asset).label})`"
                @keydown.enter.prevent="handleAssetClick(asset)"
                @keydown.space.prevent="handleAssetClick(asset)"
                :title="`${asset.name} · ${assetTypePresentation(asset).label}`"
              >
                <div class="asset-picker-list__thumbnail">
                  <v-img
                    v-if="assetThumbnailUrl(asset)"
                    class="asset-picker-list__img"
                    :src="assetThumbnailUrl(asset) || undefined"
                    :alt="asset.name"
                    cover
                  />
                  <div
                    v-else
                    class="asset-picker-list__thumbnail-placeholder"
                    :style="assetThumbnailPlaceholderStyle(asset)"
                  >
                    {{ resolveInitials(asset) }}
                  </div>
                </div>

                <div
                  class="asset-picker-list__meta-overlay"
                  :style="{
                    '--asset-source-accent': getAssetSourcePresentation(asset).color,
                    '--asset-type-accent': assetTypePresentation(asset).color,
                  }"
                >
                  <span class="asset-picker-list__meta-title">
                    <span class="asset-picker-list__type-icon" :title="assetTypePresentation(asset).label">
                      <v-icon size="10">{{ assetTypePresentation(asset).icon }}</v-icon>
                    </span>
                    <span class="asset-picker-list__title-text">{{ asset.name }}</span>
                  </span>
                </div>

                <div v-if="isAssetDownloading(asset)" class="asset-picker-list__progress-overlay">
                  <v-progress-circular
                    :model-value="assetDownloadProgress(asset)"
                    color="primary"
                    size="34"
                    width="4"
                  />
                </div>
                <div
                  v-else-if="assetDownloadError(asset)"
                  class="asset-picker-list__error-overlay"
                >
                  <v-icon size="20" color="error">mdi-alert-circle-outline</v-icon>
                </div>
              </div>
            </template>
              <div>{{ asset.name }}</div>
          </v-tooltip>
        </template>
      </div>

    </div>
  </div>
</template>

<style scoped>
.asset-picker-list {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.asset-picker-list__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1px 4px 4px;
}

.asset-picker-list__search {
  flex: 1;
  margin-left: auto;
}

.asset-picker-list__search :deep(.v-field__append-inner) {
  align-items: center;
  padding-inline-start: 4px;
  gap: 4px;
}

.asset-picker-list__search-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.asset-picker-list__search-action {
  flex: none;
  width: 22px;
  height: 22px;
  min-width: 22px;
  min-height: 22px;
  padding: 0;
  border-radius: 4px;
  box-shadow: none;
}

.asset-picker-list__search-action--active {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent);
}

.asset-picker-list__body {
  flex: 1;
  padding: 6px 10px 6px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.asset-picker-list__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
}

.asset-picker-list__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.25rem;
}

.asset-picker-list__tile {
  position: relative;
  aspect-ratio: 1 / 1;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: transparent;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.asset-picker-list__tile:hover {
  border-color: rgba(77, 208, 225, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}

.asset-picker-list__tile--selected {
  border-color: rgba(77, 208, 225, 1);
  box-shadow: 0 6px 18px rgba(0, 188, 212, 0.35);
}

.asset-picker-list__thumbnail {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  overflow: hidden;
}

.asset-picker-list__meta-overlay {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 8px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--asset-source-accent) 24%, rgba(6, 10, 16, 0.76)), rgba(6, 10, 16, 0.7));
  border: 1px solid color-mix(in srgb, var(--asset-source-accent) 38%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.22);
  pointer-events: none;
}

.asset-picker-list__meta-title {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #fff;
}

.asset-picker-list__type-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.72);
  color: var(--asset-type-accent);
  border: 1px solid color-mix(in srgb, var(--asset-type-accent) 70%, transparent);
}

.asset-picker-list__title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  font-weight: 600;
}

.asset-picker-list__progress-overlay,
.asset-picker-list__error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 10, 16, 0.55);
  pointer-events: none;
}

.asset-picker-list__img {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
}

.asset-picker-list__thumbnail :deep(.v-img) {
  width: 100%;
  height: 100%;
}

.asset-picker-list__thumbnail :deep(.v-img__img),
.asset-picker-list__thumbnail :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.asset-picker-list__thumbnail-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 1.1rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.asset-picker-list__thumbnail-placeholder--none {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
  color: rgba(233, 236, 241, 0.9);
}

.asset-picker-list__tile--none .asset-picker-list__thumbnail {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.asset-picker-list__empty {
  padding: 12px 0 18px;
  text-align: center;
  color: rgba(233, 236, 241, 0.65);
  font-size: 0.82rem;
}
</style>
