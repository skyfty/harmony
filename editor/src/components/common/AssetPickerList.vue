<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { assetProvider } from '@/resources/projectProviders/asset'
import { determineAssetCategoryId } from '@/stores/assetCatalog'

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
      thumbnailSize: 78,
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
const gridRef = ref<HTMLDivElement | null>(null)

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
    if (props.active) {
      emit('layout')
    }
  }
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
        prepend-inner-icon="mdi-magnify"
        placeholder="Search assets"
        clearable
        hide-details
      />
    </div>

    <div class="asset-picker-list__body">
      <div v-if="loading" class="asset-picker-list__loading">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <div v-else ref="gridRef" class="asset-picker-list__grid">
        <div
          class="asset-picker-list__tile asset-picker-list__tile--none"
          :class="{ 'asset-picker-list__tile--selected': !selectedAssetId }"
          data-asset-id="__none__"
          @click="handleClearSelection"
        >
          <div class="asset-picker-list__thumbnail">
            <div class="asset-picker-list__thumbnail-placeholder asset-picker-list__thumbnail-placeholder--none">
              <v-icon size="28">mdi-close-circle-outline</v-icon>
            </div>
          </div>
        </div>

        <div
          v-for="asset in filteredAssets"
          :key="asset.id"
          class="asset-picker-list__tile"
          :class="{ 'asset-picker-list__tile--selected': asset.id === selectedAssetId }"
          :data-asset-id="asset.id"
          @click="handleAssetClick(asset)"
        >
          <div class="asset-picker-list__thumbnail" :style="{ height: (props.thumbnailSize ?? 78) + 'px' }">
            <v-img
              v-if="assetThumbnailUrl(asset)"
              :src="assetThumbnailUrl(asset) || undefined"
              :alt="asset.name"
              :height="props.thumbnailSize"
              cover
            />
            <div
              v-else
              class="asset-picker-list__thumbnail-placeholder"
              :style="{ backgroundColor: asset.previewColor || '#455A64' }"
            >
              {{ resolveInitials(asset) }}
            </div>
            <div class="asset-picker-list__name" :title="asset.name">{{ asset.name }}</div>
          </div>
        </div>
      </div>

      <div v-if="!loading && !filteredAssets.length" class="asset-picker-list__empty">
        No assets match the criteria
      </div>
    </div>
  </div>
</template>

<style scoped>
.asset-picker-list {
  display: flex;
  flex-direction: column;
  width: 100%;
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

.asset-picker-list__body {
  flex: 1;
  padding: 8px 14px 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 300px;
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
  gap: 0.45rem;
}

.asset-picker-list__tile {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(20, 24, 30, 0.8);
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
  position: relative;
  width: 100%;
  height: 78px;
  background: rgba(33, 150, 243, 0.18);
  overflow: hidden;
}

.asset-picker-list__thumbnail :deep(img) {
  height: 100%;
  width: 100%;
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

.asset-picker-list__name {
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

.asset-picker-list__empty {
  padding: 12px 0 18px;
  text-align: center;
  color: rgba(233, 236, 241, 0.65);
  font-size: 0.82rem;
}
</style>
