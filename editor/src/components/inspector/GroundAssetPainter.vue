<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import { useTerrainStore } from '@/stores/terrainStore'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import { loadScatterAssets, terrainScatterPresets } from '@/resources/projectProviders/asset'
import { useScatterAssetSelection } from '@/stores/useScatterAssetSelection'

const props = defineProps<{
  category: TerrainScatterCategory
  updateTerrainSelection?: boolean
  selectedProviderAssetId?: string | null
  search?: string
  showSearch?: boolean
}>()

const emit = defineEmits<{
  (event: 'asset-select', payload: { asset: ProjectAsset; providerAssetId: string }): void
  (event: 'update:search', value: string): void
}>()

const terrainStore = useTerrainStore()

const { scatterSelectedAsset, scatterProviderAssetId } = storeToRefs(terrainStore)

const categoryKeys = Object.keys(terrainScatterPresets) as TerrainScatterCategory[]
const assetBuckets = reactive<Record<TerrainScatterCategory, ProjectAsset[]>>(
  categoryKeys.reduce((acc, key) => {
    acc[key] = []
    return acc
  }, {} as Record<TerrainScatterCategory, ProjectAsset[]>),
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
  (value) => {
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

const filteredAssets = computed(() => {
  const list = assetBuckets[props.category] ?? []
  if (!normalizedSearch.value) {
    return list
  }
  return list.filter((asset) => asset.name.toLowerCase().includes(normalizedSearch.value))
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

async function ensureAssetsLoaded(category: TerrainScatterCategory): Promise<void> {
  if (loadingMap[category]) {
    return
  }
  if (assetBuckets[category]?.length) {
    return
  }
  loadingMap[category] = true
  errorMap[category] = null
  try {
    assetBuckets[category] = await loadScatterAssets(category)
  } catch (error) {
    console.warn('Failed to load scatter assets', error)
    errorMap[category] = (error as Error).message ?? '无法加载资源列表'
  } finally {
    loadingMap[category] = false
  }
}

async function handleAssetClick(asset: ProjectAsset): Promise<void> {
  await selectScatterAsset(asset)
}

function assetThumbnail(asset: ProjectAsset): string | null {
  return asset.thumbnail ?? null
}

function isAssetActive(assetId: string): boolean {
  if (props.selectedProviderAssetId != null) {
    return props.selectedProviderAssetId === assetId
  }
  if (scatterProviderAssetId.value) {
    return scatterProviderAssetId.value === assetId
  }
  return scatterSelectedAsset.value?.id === assetId
}

onMounted(() => {
  if (props.updateTerrainSelection !== false) {
    terrainStore.setScatterCategory(props.category)
  }
  void ensureAssetsLoaded(props.category)
})

watch(
  () => props.category,
  (category) => {
    if (props.updateTerrainSelection !== false) {
      terrainStore.setScatterCategory(category)
    }
    void ensureAssetsLoaded(category)
  },
)
</script>

<template>
  <div class="asset-painter">
    <div v-if="props.showSearch !== false" class="asset-toolbar">
      <v-text-field
        :model-value="searchQuery"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="asset-search"
        prepend-inner-icon="mdi-magnify"
        placeholder="搜索撒件预设"
        :disabled="loadingMap[props.category]"
        @update:model-value="handleSearchInput"
      />
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
          v-for="asset in filteredAssets"
          :key="asset.id"
          class="thumbnail-item"
          type="button"
          :title="asset.name || '未命名'"
          :aria-label="asset.name || '未命名'"
          :class="{ 'is-selected': isAssetActive(asset.id) }"
          @click="handleAssetClick(asset)"
        >
          <div class="thumbnail" :style="{ backgroundImage: assetThumbnail(asset) ? `url(${assetThumbnail(asset)})` : undefined }">
            <span v-if="!assetThumbnail(asset)" class="thumbnail-placeholder">
              <v-icon icon="mdi-cube-outline" size="20" />
            </span>
          </div>
        </button>
      </div>
      <div v-else class="empty-placeholder">
        <span v-if="isFiltering && hasAnyAssets">未找到匹配的预设</span>
        <span v-else>当前分类没有可用资源</span>
      </div>
    </template>

    <div v-if="selectingAssetId" class="selection-overlay">
      <v-progress-circular indeterminate size="32" color="primary" />
    </div>
  </div>
</template>

<style scoped>
.asset-painter {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  grid-template-columns: repeat(auto-fill, 60px);
  gap: 2px;
  max-height: calc((62px * 4) + (2px * 3));
  overflow-y: auto;
  padding-right: 2px;
  justify-content: flex-start;
}

.thumbnail-item {
  border: none;
  background: transparent;
  padding: 0;
  width: 60px;
  height: 60px;
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
  width: 56px;
  height: 56px;
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
