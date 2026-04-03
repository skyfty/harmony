<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useTerrainStore } from '@/stores/terrainStore'
import { useUiStore } from '@/stores/uiStore'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'
import { loadScatterAssets, terrainScatterPresets, type ScatterAssetOption } from '@/resources/projectProviders/asset'
import { useScatterAssetSelection } from '@/stores/useScatterAssetSelection'

const props = defineProps<{
  category: TerrainScatterCategory
  updateTerrainSelection?: boolean
  selectedProviderAssetId?: string | null
  search?: string
  showSearch?: boolean
  /** Thumbnail grid item size in pixels (default 60). */
  thumbnailSize?: number
}>()

const emit = defineEmits<{
  (event: 'asset-select', payload: { asset: ProjectAsset; providerAssetId: string }): void
  (event: 'update:search', value: string): void
}>()

const terrainStore = useTerrainStore()
const sceneStore = useSceneStore()

const { scatterSelectedAsset, scatterProviderAssetId } = storeToRefs(terrainStore)

const categoryKeys = Object.keys(terrainScatterPresets) as TerrainScatterCategory[]
const assetBuckets = reactive<Record<TerrainScatterCategory, ScatterAssetOption[]>>(
  categoryKeys.reduce((acc, key) => {
    acc[key] = []
    return acc
  }, {} as Record<TerrainScatterCategory, ScatterAssetOption[]>),
)
const loadingMap = reactive<Record<TerrainScatterCategory, boolean>>(
  categoryKeys.reduce((acc, key) => {
    acc[key] = false
    return acc
  }, {} as Record<TerrainScatterCategory, boolean>),
)
const errorMap = reactive<Record<TerrainScatterCategory, string | null>>(
  categoryKeys.reduce((acc, key) => {
    acc[key] = null
    return acc
  }, {} as Record<TerrainScatterCategory, string | null>),
)

const { selectingAssetId, selectScatterAsset } = useScatterAssetSelection({
  updateTerrainSelection: props.updateTerrainSelection !== false,
  onSelected(asset, providerAssetId) {
    emit('asset-select', { asset, providerAssetId })
  },
})

const searchQuery = ref(props.search ?? '')

watch(
  () => props.search,
  (value: string | undefined) => {
    if (value === undefined) {
      return
    }
    const next = value ?? ''
    if (next !== searchQuery.value) {
      searchQuery.value = next
    }
  },
  { immediate: true },
)

const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase())
const isFiltering = computed(() => normalizedSearch.value.length > 0)

const thumbnailSizePx = computed(() => {
  const raw = Number(props.thumbnailSize ?? 60)
  if (!Number.isFinite(raw)) {
    return 60
  }
  // Keep reasonable bounds so layout stays usable.
  return Math.min(96, Math.max(44, Math.round(raw)))
})

const thumbnailCssVars = computed<CSSProperties>(() => ({
  '--scatter-thumb-size': `${thumbnailSizePx.value}px`,
} as unknown as CSSProperties))

const placeholderIconSize = computed(() => {
  // Scale with the thumbnail size, but keep within Vuetify icon-friendly bounds.
  return Math.min(32, Math.max(16, Math.round(thumbnailSizePx.value * 0.35)))
})

const filteredAssets = computed<ScatterAssetOption[]>(() => {
  const list = assetBuckets[props.category] ?? []
  if (!normalizedSearch.value) {
    return list
  }
  return list.filter((entry: ScatterAssetOption) => entry.asset.name.toLowerCase().includes(normalizedSearch.value))
})

const hasAnyAssets = computed(() => (assetBuckets[props.category]?.length ?? 0) > 0)

function handleSearchInput(value: string | null) {
  const next = value ?? ''
  if (next === searchQuery.value) {
    emit('update:search', searchQuery.value)
    return
  }
  searchQuery.value = next
  emit('update:search', searchQuery.value)
}

async function ensureAssetsLoaded(category: TerrainScatterCategory, options: { force?: boolean } = {}): Promise<void> {
  if (loadingMap[category]) {
    return
  }
  if (!options.force && assetBuckets[category]?.length) {
    return
  }
  loadingMap[category] = true
  errorMap[category] = null
  try {
    assetBuckets[category] = await loadScatterAssets(category)
  } catch (error) {
    console.warn('Failed to load scatter assets', error)
    errorMap[category] = (error as Error).message ?? 'Failed to load asset list'
  } finally {
    loadingMap[category] = false
  }
}

async function handleAssetClick(entry: ScatterAssetOption): Promise<void> {
  await selectScatterAsset(entry)
  const uiStore = useUiStore()
  uiStore.setActiveSelectionContext('scatter')
}

function assetThumbnail(asset: ProjectAsset): string | null {
  return asset.thumbnail ?? null
}

function isAssetActive(entry: ScatterAssetOption): boolean {
  if (props.selectedProviderAssetId != null) {
    return props.selectedProviderAssetId === entry.providerAssetId
  }
  if (scatterProviderAssetId.value) {
    return scatterProviderAssetId.value === entry.providerAssetId
  }
  return scatterSelectedAsset.value?.id === entry.asset.id
}

onMounted(() => {
  if (props.updateTerrainSelection !== false) {
    terrainStore.setScatterCategory(props.category)
  }
  void ensureAssetsLoaded(props.category)
})

watch(
  () => props.category,
  (category: TerrainScatterCategory) => {
    if (props.updateTerrainSelection !== false) {
      terrainStore.setScatterCategory(category)
    }
    void ensureAssetsLoaded(category)
  },
)

watch(
  () => sceneStore.assetCatalog,
  () => {
    categoryKeys.forEach((category) => {
      void ensureAssetsLoaded(category, { force: true })
    })
  },
)
</script>

<template>
  <div class="asset-painter" :style="thumbnailCssVars">
    <div v-if="props.showSearch !== false" class="asset-toolbar">
      <v-text-field
        :model-value="searchQuery"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="asset-search"
        prepend-inner-icon="mdi-magnify"
        placeholder="Search scatter presets"
        :disabled="loadingMap[props.category]"
        @update:model-value="handleSearchInput"
      />
    </div>

    <!-- LOD UI HINT: show when selected asset is .lod -->
    <div v-if="scatterSelectedAsset.value && scatterSelectedAsset.value.type === 'prefab' && scatterSelectedAsset.value.id.endsWith('.lod')" class="hint-text">
      已选择 LOD 预设（.lod）：撒件时将自动使用其首个模型 LOD 进行地形散布。
    </div>

    <div v-if="loadingMap[props.category]" class="state-card">
      <v-progress-circular indeterminate size="28" color="primary" />
    </div>
    <div v-else-if="errorMap[props.category]" class="state-card">
      <span>{{ errorMap[props.category] }}</span>
    </div>
    <template v-else>
      <div v-if="filteredAssets.length" class="thumbnail-grid">
        <button
          v-for="entry in filteredAssets"
          :key="entry.asset.id"
          class="thumbnail-item"
          type="button"
          :title="entry.asset.name || 'Untitled'"
          :aria-label="entry.asset.name || 'Untitled'"
          :class="{ 'is-selected': isAssetActive(entry) }"
          @click="handleAssetClick(entry)"
        >
          <div class="thumbnail" :style="{ backgroundImage: assetThumbnail(entry.asset) ? `url(${assetThumbnail(entry.asset)})` : undefined }">
            <span v-if="!assetThumbnail(entry.asset)" class="thumbnail-placeholder">
              <v-icon icon="mdi-cube-outline" :size="placeholderIconSize" />
            </span>
          </div>
        </button>
      </div>
      <div v-else class="empty-placeholder">
        <span v-if="isFiltering && hasAnyAssets">No matching presets found</span>
        <span v-else>No assets available for this category</span>
      </div>
    </template>

    <div v-if="selectingAssetId" class="selection-overlay">
      <v-progress-circular indeterminate size="32" color="primary" />
    </div>
  </div>
</template>

<style scoped>
.asset-painter {
  --scatter-thumb-size: 60px;
  --scatter-thumb-gap: 2px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
}

.asset-toolbar {
  display: flex;
}

.asset-search {
  flex: 1;
}

.hint-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}


.thumbnail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, var(--scatter-thumb-size));
  gap: var(--scatter-thumb-gap);
  max-height: calc((var(--scatter-thumb-size) + var(--scatter-thumb-gap)) * 4 - var(--scatter-thumb-gap));
  overflow-y: auto;
  padding-right: 2px;
  justify-content: flex-start;
}

.thumbnail-item {
  border: none;
  background: transparent;
  padding: 0;
  width: var(--scatter-thumb-size);
  height: var(--scatter-thumb-size);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s ease;
  overflow: visible;
}

.thumbnail-item:hover {
  transform: scale(0.94);
}

.thumbnail-item:focus-visible {
  outline: none;
}

.thumbnail {
  width: calc(var(--scatter-thumb-size) - 4px);
  height: calc(var(--scatter-thumb-size) - 4px);
  border-radius: 8px;
  background-size: cover;
  background-position: center;
  background-color: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 1px transparent;
  transition: box-shadow 0.2s, background-color 0.2s;
}

.thumbnail-item:hover .thumbnail {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.thumbnail-item.is-selected .thumbnail {
  box-shadow: 0 0 0 2px #4dd0e1;
  background-color: rgba(77, 208, 225, 0.12);
}

.thumbnail-placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.name {
  font-size: 12px;
  text-align: center;
  color: rgba(255, 255, 255, 0.82);
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-placeholder {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  padding: 12px 0;
}

.state-card {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 86px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
}

.selection-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 12px;
  z-index: 2;
}

.selection-status {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.selection-status.active {
  color: #4dd0e1;
}
</style>
