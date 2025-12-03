<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useTerrainStore } from '@/stores/terrainStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import {
  assetProvider,
  loadScatterAssets,
  terrainScatterPresets,
  type TerrainScatterCategory,
} from '@/resources/projectProviders/asset'

const props = defineProps<{
  category: TerrainScatterCategory
}>()

const terrainStore = useTerrainStore()
const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()

const { scatterProviderAssetId, scatterSelectedAsset } = storeToRefs(terrainStore)

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

const selectingAssetId = ref<string | null>(null)

const hasSelection = computed(() => Boolean(scatterSelectedAsset.value))
const activePreset = computed(() => terrainScatterPresets[props.category])

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

async function ensureAssetCached(asset: ProjectAsset): Promise<void> {
  if (assetCacheStore.hasCache(asset.id)) {
    return
  }
  await assetCacheStore.downloaProjectAsset(asset)
}

async function handleAssetClick(asset: ProjectAsset): Promise<void> {
  if (selectingAssetId.value) {
    return
  }
  selectingAssetId.value = asset.id
  try {
    const registered = sceneStore.copyPackageAssetToAssets(assetProvider.id, asset)
    await ensureAssetCached(registered)
    terrainStore.setScatterSelection({ asset: registered, providerAssetId: asset.id })
  } catch (error) {
    console.warn('Failed to prepare scatter asset', error)
  } finally {
    selectingAssetId.value = null
  }
}

function assetThumbnail(asset: ProjectAsset): string | null {
  return asset.thumbnail ?? asset.thumbnailUrl ?? asset.previewUrl ?? null
}

onMounted(() => {
  terrainStore.setScatterCategory(props.category)
  void ensureAssetsLoaded(props.category)
})
</script>

<template>
  <div class="asset-painter">
    <div class="hint-text">
      {{ activePreset.label }} · 选择一个资源后，按住鼠标中键并在场景中拖动即可连续铺设（自动贴合地形并随机化外观）。
    </div>

    <div class="thumbnail-grid" v-if="!loadingMap[props.category] && !errorMap[props.category]">
      <button
        v-for="asset in assetBuckets[props.category]"
        :key="asset.id"
        class="thumbnail-item"
        type="button"
        :class="{ 'is-selected': scatterProviderAssetId === asset.id }"
        @click="handleAssetClick(asset)"
      >
        <div class="thumbnail" :style="{ backgroundImage: assetThumbnail(asset) ? `url(${assetThumbnail(asset)})` : undefined }">
          <span v-if="!assetThumbnail(asset)" class="thumbnail-placeholder">
            <v-icon icon="mdi-cube-outline" size="20" />
          </span>
        </div>
        <div class="name" :title="asset.name">{{ asset.name }}</div>
      </button>
      <div v-if="!assetBuckets[props.category]?.length" class="empty-placeholder">
        当前分类没有可用资源
      </div>
    </div>

    <div v-else class="state-card">
      <v-progress-circular v-if="loadingMap[props.category]" indeterminate size="28" color="primary" />
      <span v-else>{{ errorMap[props.category] }}</span>
    </div>

    <div v-if="selectingAssetId" class="selection-overlay">
      <v-progress-circular indeterminate size="32" color="primary" />
    </div>

    <div class="selection-status" :class="{ active: hasSelection }">
      <v-icon :icon="hasSelection ? 'mdi-check-circle-outline' : 'mdi-information-outline'" size="18" class="mr-1" />
      <span>
        {{
          hasSelection
            ? `当前资源：${scatterSelectedAsset?.name ?? ''}`
            : '请选择一个资源后再在场景中绘制'
        }}
      </span>
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

.hint-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

.thumbnail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
  gap: 10px;
}

.thumbnail-item {
  border: none;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;
  border: 1px solid transparent;
}

.thumbnail-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.thumbnail-item.is-selected {
  border-color: #4dd0e1;
  background: rgba(77, 208, 225, 0.12);
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
  margin-bottom: 6px;
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
