<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useSceneStore } from '@/stores/sceneStore'
import { assetProvider } from '@/resources/projectProviders/asset'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    assetId?: string
    assetType?: string
    seriesId?: string
    assets?: ProjectAsset[]
    title?: string
    confirmText?: string
    cancelText?: string
  }>(),
  {
    assetId: '',
    assetType: '',
    seriesId: '',
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'update:assetId', value: string): void
  (event: 'confirm', value: ProjectAsset): void
  (event: 'cancel'): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const sceneStore = useSceneStore()
const { assetCatalog } = storeToRefs(sceneStore)

const selectedAssetId = ref(props.assetId ?? '')
const remoteAssets = ref<ProjectAsset[]>([])
const remoteLoaded = ref(false)
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const searchTerm = ref('')

function flattenCatalog(catalog: Record<string, ProjectAsset[]> | undefined): ProjectAsset[] {
  if (!catalog) {
    return []
  }
  return Object.values(catalog).flatMap((group) => (Array.isArray(group) ? group : []))
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
  } catch (error) {
    console.warn('Failed to load asset provider manifest', error)
    errorMessage.value = (error as Error).message ?? '无法加载资产列表'
  } finally {
    loading.value = false
  }
}

watch(dialogOpen, (open) => {
  if (open) {
    selectedAssetId.value = props.assetId ?? ''
    if (!props.assets?.length) {
      void loadRemoteAssets()
    }
  } else {
    searchTerm.value = ''
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
  const typeFilter = props.assetType?.trim() ?? ''
  const seriesFilter = props.seriesId?.trim() ?? ''
  const term = searchTerm.value.trim().toLowerCase()
  return allAssets.value.filter((asset) => {
    if (typeFilter && asset.type !== typeFilter) {
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

const selectedAsset = computed(() => {
  const id = selectedAssetId.value
  if (!id) {
    return null
  }
  return allAssets.value.find((asset) => asset.id === id) ?? null
})

function handleAssetClick(asset: ProjectAsset) {
  selectedAssetId.value = asset.id
  emit('update:assetId', asset.id)
}

function handleConfirm() {
  if (!selectedAsset.value) {
    return
  }
  emit('confirm', selectedAsset.value)
  dialogOpen.value = false
}

function handleCancel() {
  emit('cancel')
  dialogOpen.value = false
}

function retryLoading() {
  remoteLoaded.value = false
  void loadRemoteAssets()
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
  <v-dialog v-model="dialogOpen" max-width="960">
    <v-card class="asset-dialog">
      <v-card-title class="asset-dialog__header">
        <span class="asset-dialog__title">{{ title ?? '选择资产' }}</span>
        <v-text-field
          v-model="searchTerm"
          class="asset-dialog__search"
          density="comfortable"
          variant="outlined"
          prepend-inner-icon="mdi-magnify"
          placeholder="搜索资产"
          clearable
          hide-details
        />
      </v-card-title>

      <v-card-text class="asset-dialog__content">
        <v-alert
          v-if="errorMessage"
          type="error"
          density="comfortable"
          variant="tonal"
          class="asset-dialog__alert"
        >
          <div class="asset-dialog__alert-message">{{ errorMessage }}</div>
          <v-btn size="small" variant="text" @click="retryLoading">重新尝试</v-btn>
        </v-alert>

        <div v-if="loading" class="asset-dialog__loading">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <div v-else class="asset-dialog__grid">
          <div
            v-for="asset in filteredAssets"
            :key="asset.id"
            class="asset-dialog__tile"
            :class="{ 'asset-dialog__tile--selected': asset.id === selectedAssetId }"
            @click="handleAssetClick(asset)"
          >
            <div class="asset-dialog__thumbnail">
              <v-img
                v-if="asset.thumbnail"
                :src="asset.thumbnail"
                :alt="asset.name"
                height="120"
                cover
              />
              <div
                v-else
                class="asset-dialog__thumbnail-placeholder"
                :style="{ backgroundColor: asset.previewColor || '#455A64' }"
              >
                {{ resolveInitials(asset) }}
              </div>
            </div>
            <div class="asset-dialog__meta">
              <div class="asset-dialog__name" :title="asset.name">{{ asset.name }}</div>
              <div class="asset-dialog__type">{{ asset.type }}</div>
            </div>
          </div>
        </div>

        <div v-if="!loading && !filteredAssets.length" class="asset-dialog__empty">
          暂无符合条件的资产
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="asset-dialog__actions">
        <v-spacer />
        <v-btn variant="text" @click="handleCancel">{{ cancelText ?? '取消' }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!selectedAsset"
          @click="handleConfirm"
        >
          {{ confirmText ?? '确认' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.asset-dialog__header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.asset-dialog__title {
  font-size: 1.1rem;
  font-weight: 600;
}

.asset-dialog__search {
  max-width: 240px;
  margin-left: auto;
}

.asset-dialog__content {
  min-height: 320px;
}

.asset-dialog__alert {
  margin-bottom: 0.75rem;
}

.asset-dialog__alert-message {
  margin-bottom: 0.5rem;
}

.asset-dialog__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}

.asset-dialog__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.75rem;
}

.asset-dialog__tile {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(20, 24, 30, 0.75);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.asset-dialog__tile:hover {
  border-color: rgba(77, 208, 225, 0.8);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.28);
}

.asset-dialog__tile--selected {
  border-color: rgba(77, 208, 225, 1);
  box-shadow: 0 6px 22px rgba(0, 188, 212, 0.35);
}

.asset-dialog__thumbnail {
  width: 100%;
  background: rgba(33, 150, 243, 0.16);
}

.asset-dialog__thumbnail-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  font-size: 1.4rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.82);
}

.asset-dialog__meta {
  padding: 0.65rem 0.75rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.asset-dialog__name {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.asset-dialog__type {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}

.asset-dialog__empty {
  margin-top: 1.5rem;
  text-align: center;
  color: rgba(233, 236, 241, 0.65);
}

.asset-dialog__actions {
  padding: 0.75rem 1rem;
}
</style>
