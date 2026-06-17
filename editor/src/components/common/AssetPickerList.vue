<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { isAudioAsset, useAudioAssetPreview } from '@/utils/audioAssetPreview'
import { getAssetTypePresentation, resolvePresetAssetKind } from '@/utils/assetTypePresentation'
import { getAssetSourcePresentation } from '@/utils/assetSourcePresentation'
import { usesTransparentThumbnailBackground } from '@/utils/assetThumbnailTransparency'
import { shouldHideDependantAssetInEditor } from '@/utils/assetDependencySubset'
import { isBuiltinWaterNormalAsset } from '@/constants/builtinAssets'

const CONFIG_PRESET_EXTENSIONS = new Set(['wall', 'floor', 'road', 'landform', 'lod', 'dice'])

const props = withDefaults(
  defineProps<{
    active?: boolean
    assetId?: string
    assetType?: string
    seriesId?: string
    multiple?: boolean
    selectedAssetIds?: string[]
    /** Optional list of allowed filename extensions (without dot), e.g. ['wall', 'glb']. */
    extensions?: string[]
    thumbnailSize?: number
    assets?: ProjectAsset[]
    showSearch?: boolean
    showClearSelection?: boolean;
  }>(),
  {
    active: true,
    assetId: '',
    assetType: '',
    seriesId: '',
    multiple: false,
    selectedAssetIds: () => [],
    extensions: undefined,
    thumbnailSize: 72,
    showSearch: true,
    showClearSelection: true,
  },
)

const emit = defineEmits<{
  (event: 'update:asset', value: ProjectAsset | null): void
  (event: 'update:selectedAssetIds', value: string[]): void
  (event: 'layout'): void
}>()
const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { assetCatalog } = storeToRefs(sceneStore)
const {
  playingAssetId: previewPlayingAssetId,
  pendingAssetId: previewPendingAssetId,
  stopPreview: stopAudioPreview,
  toggleAssetPreview,
} = useAudioAssetPreview()

const selectedAssetId = ref(props.assetId ?? '')
const selectedAssetIds = ref<string[]>(normalizeSelectionIds(props.selectedAssetIds ?? []))
const searchTerm = ref('')
const showLocalSources = ref(true)
const showRemoteSources = ref(true)
const gridRef = ref<HTMLDivElement | null>(null)

function isAssetDownloading(asset: ProjectAsset): boolean {
  if (!asset?.id) {
    return false
  }
  return assetCacheStore.isDownloading(asset.id)
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

const sceneAssets = computed(() => flattenCatalog(assetCatalog.value))

const extensionFilters = computed(() => {
  const allowedExtensions = props.extensions ?? []
  return new Set(
    allowedExtensions
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  )
})

const requestedPresetKinds = computed(() => {
  if (!extensionFilters.value.size) {
    return new Set<string>()
  }

  return new Set(Array.from(extensionFilters.value).filter((extension) => CONFIG_PRESET_EXTENSIONS.has(extension)))
})

function resolveRequestedPresetKind(asset: ProjectAsset): string | null {
  const presetKind = resolvePresetAssetKind(asset)
  if (!presetKind || !requestedPresetKinds.value.size) {
    return null
  }
  return requestedPresetKinds.value.has(presetKind) ? presetKind : null
}

function matchesRequestedType(asset: ProjectAsset): boolean {
  const typeFilterRaw = props.assetType?.trim() ?? ''
  const typeFilters = typeFilterRaw.length
    ? typeFilterRaw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : []

  if (!typeFilters.length) {
    return true
  }

  if (typeFilters.includes(asset.type)) {
    return true
  }

  const requestedPresetKind = resolveRequestedPresetKind(asset)
  return Boolean(requestedPresetKind && typeFilters.includes('prefab'))
}

function matchesRequestedExtension(asset: ProjectAsset): boolean {
  if (!extensionFilters.value.size) {
    return true
  }

  const assetExtension = asset.extension?.trim().toLowerCase() ?? ''
  if (assetExtension && extensionFilters.value.has(assetExtension)) {
    return true
  }

  return Boolean(resolveRequestedPresetKind(asset))
}

function isPackageBackedConfigPreset(asset: ProjectAsset): boolean {
  if (!resolveRequestedPresetKind(asset)) {
    return false
  }
  if (asset.source?.type === 'package') {
    return true
  }
  if (typeof asset.fileKey === 'string' && asset.fileKey.trim().length > 0) {
    return true
  }
  return false
}

const allAssets = computed(() => {
  const provided = props.assets?.length ? props.assets : []
  const combined = [...provided, ...sceneAssets.value]
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
  const seriesFilter = props.seriesId?.trim() ?? ''

  const term = searchTerm.value.trim().toLowerCase()
  return allAssets.value.filter((asset) => {
    const sourceKind = getAssetSourcePresentation(asset).kind
    const isRemoteSource = sourceKind === 'remote'
    if (asset.internal === true && !isBuiltinWaterNormalAsset(asset.id)) {
      return false
    }
    if (shouldHideDependantAssetInEditor(asset)) {
      return false
    }
    if (isRemoteSource && !showRemoteSources.value) {
      return false
    }
    if (!isRemoteSource && !showLocalSources.value) {
      return false
    }
    if (!matchesRequestedType(asset)) {
      return false
    }
    if (!matchesRequestedExtension(asset)) {
      return false
    }
    if (seriesFilter) {
      const assetSeries = asset.seriesId?.trim() ?? ''
      if (assetSeries !== seriesFilter) {
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

const gridStyle = computed(() => {
  const size = Number(props.thumbnailSize ?? 78)
  const minThumb = Math.max(56, isFinite(size) ? size : 78)
  // add padding/label space so items have breathing room
  const colWidth = Math.round(minThumb + 24)
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

function normalizeSelectionIds(ids: string[]): string[] {
  return Array.from(new Set((ids ?? []).map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)))
}

function syncSelectionIds(ids: string[]): void {
  selectedAssetIds.value = normalizeSelectionIds(ids)
  emit('update:selectedAssetIds', selectedAssetIds.value.slice())
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

async function handleAssetClick(asset: ProjectAsset) {
  if (props.multiple) {
    syncSelectionIds(
      selectedAssetIds.value.includes(asset.id)
        ? selectedAssetIds.value.filter((id) => id !== asset.id)
        : [...selectedAssetIds.value, asset.id],
    )
    return
  }

  if (isPackageBackedConfigPreset(asset)) {
    selectedAssetId.value = asset.id
    emit('update:asset', asset)
    return
  }

  if (!asset || !asset.id) {
    emit('update:asset', asset)
    return
  }

  if (props.multiple) {
    syncSelectionIds(
      selectedAssetIds.value.includes(asset.id)
        ? selectedAssetIds.value.filter((id) => id !== asset.id)
        : [...selectedAssetIds.value, asset.id],
    )
    return
  }

  selectedAssetId.value = asset.id
  emit('update:asset', asset)
}

function handleClearSelection() {
  if (props.multiple) {
    syncSelectionIds([])
    return
  }
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

function isAudioPreviewAsset(asset: ProjectAsset): boolean {
  return isAudioAsset(asset)
}

function isAssetPreviewPlaying(asset: ProjectAsset): boolean {
  return previewPlayingAssetId.value === asset.id
}

function isAssetPreviewPending(asset: ProjectAsset): boolean {
  return previewPendingAssetId.value === asset.id
}

async function handleAudioPreviewClick(event: MouseEvent, asset: ProjectAsset): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  await toggleAssetPreview(asset)
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
  () => props.selectedAssetIds,
  (next) => {
    selectedAssetIds.value = normalizeSelectionIds(next ?? [])
  },
  { immediate: true, deep: true },
)

watch(
  () => filteredAssets.value.map((asset) => asset.id).join('|'),
  () => {
    const availableIds = new Set(filteredAssets.value.map((asset) => asset.id))
    if (previewPlayingAssetId.value && !availableIds.has(previewPlayingAssetId.value)) {
      stopAudioPreview()
    }
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
  },
  { immediate: true },
)

onMounted(() => {
  if (!props.active) {
    return
  }
  void scheduleScrollToSelected()
})

onBeforeUnmount(() => {
  stopAudioPreview()
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
      <div ref="gridRef" class="asset-picker-list__grid" :style="gridStyle">
        <v-tooltip v-if="showClearSelection" open-delay="150" location="top">
          <template #activator="{ props: activatorProps }">
              <div
                v-bind="activatorProps"
                class="asset-picker-list__tile asset-picker-list__tile--none"
                :class="{ 'asset-picker-list__tile--selected': multiple ? !selectedAssetIds.length : !selectedAssetId }"
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
            <template #activator="{ props: activatorProps }">
              <div
                v-bind="activatorProps"
                class="asset-picker-list__tile"
                :class="{ 'asset-picker-list__tile--selected': multiple ? selectedAssetIds.includes(asset.id) : asset.id === selectedAssetId }"
                :data-asset-id="asset.id"
                @click="handleAssetClick(asset)"
                tabindex="0"
                :aria-label="`Select ${asset.name} (${assetTypePresentation(asset).label})`"
                @keydown.enter.prevent="handleAssetClick(asset)"
                @keydown.space.prevent="handleAssetClick(asset)"
                :title="`${asset.name} · ${assetTypePresentation(asset).label}`"
              >
                <div class="asset-picker-list__thumbnail">
                  <v-btn
                    v-if="isAudioPreviewAsset(asset)"
                    class="asset-picker-list__preview-action"
                    :icon="isAssetPreviewPlaying(asset) ? 'mdi-stop-circle-outline' : 'mdi-play-circle-outline'"
                    variant="tonal"
                    density="comfortable"
                    size="x-small"
                    :loading="isAssetPreviewPending(asset)"
                    :title="isAssetPreviewPlaying(asset) ? 'Stop audio preview' : 'Play audio preview'"
                    @click="handleAudioPreviewClick($event, asset)"
                  />
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
  padding: 10px 12px 10px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  gap: 0.5rem;
}

.asset-picker-list__tile {
  position: relative;
  aspect-ratio: 1 / 1;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
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

.asset-picker-list__preview-action {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  min-width: 32px;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: rgba(7, 12, 18, 0.72);
  backdrop-filter: blur(8px);
}

.asset-picker-list__meta-overlay {
  position: absolute;
  left: 2px;
  right: 2px;
  bottom: 2px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 3px 4px;
  border-radius: 11px;
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
  width: 16px;
  height: 16px;
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
  font-size: 0.8rem;
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
  font-size: 1.25rem;
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
