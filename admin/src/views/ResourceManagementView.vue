<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AssetFormDialog from '@/components/AssetFormDialog.vue'
import AssetTagManagerDialog from '@/components/AssetTagManagerDialog.vue'
import {
  createAsset,
  listAssetTags,
  listAssets,
  listResourceCategories,
  refreshAssetManifest,
  removeAsset,
  updateAsset,
} from '@/api/modules/resources'
import type { AssetTag, AssetType, ManagedAsset, ResourceCategory } from '@/types'

const categories = ref<ResourceCategory[]>([])
const tags = ref<AssetTag[]>([])
const assets = ref<ManagedAsset[]>([])
const total = ref(0)
const loading = ref(false)
const deleting = ref<string | null>(null)
const manifestRefreshing = ref(false)

const assetDialogVisible = ref(false)
const assetDialogMode = ref<'create' | 'edit'>('create')
const selectedAsset = ref<ManagedAsset | null>(null)
const assetDialogRef = ref<InstanceType<typeof AssetFormDialog> | null>(null)
const tagManagerVisible = ref(false)

const filter = reactive({
  page: 1,
  pageSize: 12,
  keyword: '',
  categoryId: '' as string | null,
  types: [] as AssetType[],
  tagIds: [] as string[],
})

const paginationLength = computed(() => Math.max(1, Math.ceil(total.value / filter.pageSize)))
const typeOptions: Array<{ label: string; value: AssetType }> = [
  { value: 'model', label: '模型' },
  { value: 'image', label: '图片' },
  { value: 'texture', label: '纹理' },
  { value: 'material', label: '材质' },
  { value: 'mesh', label: '网格' },
  { value: 'prefab', label: '预制体' },
  { value: 'video', label: '视频' },
  { value: 'file', label: '文件' },
]

const CATEGORY_ICON_MAP: Record<AssetType, string> = {
  model: 'mdi-cube-outline',
  image: 'mdi-image',
  texture: 'mdi-texture-box',
  material: 'mdi-palette',
  mesh: 'mdi-vector-triangle',
  prefab: 'mdi-cube-scan',
  video: 'mdi-video',
  file: 'mdi-file-outline',
}

function resolveCategoryIcon(type: AssetType): string {
  return CATEGORY_ICON_MAP[type] ?? 'mdi-file-outline'
}

const canFilterByTags = computed(() => tags.value.length > 0)

async function ensureCategories(): Promise<void> {
  try {
    const result = await listResourceCategories()
    categories.value = result
    if (!filter.categoryId && result.length) {
      filter.categoryId = result[0]!.id
    }
  } catch (error) {
    console.error('Failed to load categories', error)
  }
}

async function ensureTags(): Promise<void> {
  try {
    tags.value = await listAssetTags()
  } catch (error) {
    console.error('Failed to load asset tags', error)
  }
}

async function loadAssets(): Promise<void> {
  loading.value = true
  try {
    const { data, total: totalCount } = await listAssets({
      page: filter.page,
      pageSize: filter.pageSize,
      keyword: filter.keyword || undefined,
      categoryId: filter.categoryId || undefined,
      types: filter.types.length ? filter.types : undefined,
      tagIds: filter.tagIds.length ? filter.tagIds : undefined,
    })
    assets.value = data
    total.value = totalCount
  } catch (error) {
    console.error('Failed to load assets', error)
  } finally {
    loading.value = false
  }
}

function openCreateDialog(): void {
  assetDialogMode.value = 'create'
  selectedAsset.value = null
  assetDialogVisible.value = true
}

function openEditDialog(asset: ManagedAsset): void {
  assetDialogMode.value = 'edit'
  selectedAsset.value = asset
  assetDialogVisible.value = true
}

async function handleAssetSubmit(payload: { mode: 'create' | 'edit'; formData: FormData; assetId?: string }): Promise<void> {
  if (!assetDialogRef.value) {
    return
  }
  assetDialogRef.value.setSubmitting(true)
  assetDialogRef.value.setError(null)
  try {
    if (payload.mode === 'create') {
      await createAsset(payload.formData)
    } else if (payload.assetId) {
      await updateAsset(payload.assetId, payload.formData)
    } else {
      throw new Error('缺少资产 ID，无法更新资产')
    }
    assetDialogVisible.value = false
    await Promise.all([loadAssets(), ensureTags()])
    manifestRefreshing.value = true
    await refreshAssetManifest().catch(() => undefined)
  } catch (error) {
    console.error('Failed to save asset', error)
    assetDialogRef.value.setError((error as Error).message ?? '保存资产失败')
  } finally {
    assetDialogRef.value.setSubmitting(false)
    manifestRefreshing.value = false
  }
}

async function handleDeleteAsset(asset: ManagedAsset): Promise<void> {
  if (deleting.value) {
    return
  }
  if (!window.confirm(`确定删除资产 “${asset.name}” 吗？该操作不可撤销。`)) {
    return
  }
  deleting.value = asset.id
  try {
    await removeAsset(asset.id)
    await loadAssets()
    manifestRefreshing.value = true
    await refreshAssetManifest().catch(() => undefined)
  } catch (error) {
    console.error('Failed to delete asset', error)
  } finally {
    deleting.value = null
    manifestRefreshing.value = false
  }
}

function handlePageChange(page: number): void {
  filter.page = page
  void loadAssets()
}

function handleSearch(): void {
  filter.page = 1
  void loadAssets()
}

function handleRefresh(): void {
  void loadAssets()
  manifestRefreshing.value = true
  void refreshAssetManifest().finally(() => {
    manifestRefreshing.value = false
  })
}

watch(
  () => filter.categoryId,
  () => {
    filter.page = 1
    void loadAssets()
  },
)

watch(
  () => [...filter.types],
  () => {
    filter.page = 1
    void loadAssets()
  },
)

watch(
  () => [...filter.tagIds],
  () => {
    filter.page = 1
    void loadAssets()
  },
)

watch(
  () => filter.pageSize,
  () => {
    filter.page = 1
    void loadAssets()
  },
)

onMounted(() => {
  void ensureCategories().then(() => loadAssets())
  void ensureTags()
})
</script>

<template>
  <div>
    <v-row>
      <v-col cols="12" md="3">
        <v-card elevation="3">
          <v-card-title class="text-h6 font-weight-medium">资源分类</v-card-title>
          <v-divider class="my-2" />
          <v-list density="compact" nav>
            <v-list-item
              v-for="category in categories"
              :key="category.id"
              :title="category.name"
              :active="category.id === filter.categoryId"
              @click="filter.categoryId = category.id"
            >
              <template #prepend>
                <v-icon :icon="resolveCategoryIcon(category.type)" />
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
      <v-col cols="12" md="9">
        <v-card elevation="3">
          <v-card-title class="d-flex flex-wrap align-center gap-3">
            <span class="text-h6 font-weight-medium">资产列表</span>
            <v-spacer />
            <v-text-field
              v-model="filter.keyword"
              density="compact"
              placeholder="搜索资产"
              prepend-inner-icon="mdi-magnify"
              clearable
              hide-details
              class="mr-2"
              style="max-width: 240px"
              @keyup.enter="handleSearch"
              @click:clear="handleSearch"
            />
            <v-select
              v-model="filter.types"
              :items="typeOptions"
              item-title="label"
              item-value="value"
              density="compact"
              hide-details
              multiple
              chips
              closable-chips
              label="类型"
              style="max-width: 200px"
            />
            <v-autocomplete
              v-if="canFilterByTags"
              v-model="filter.tagIds"
              :items="tags"
              item-title="name"
              item-value="id"
              density="compact"
              multiple
              chips
              closable-chips
              hide-details
              label="标签"
              style="max-width: 220px"
            />
            <v-btn variant="text" prepend-icon="mdi-tag-multiple" @click="tagManagerVisible = true">
              标签管理
            </v-btn>
            <v-btn color="primary" prepend-icon="mdi-upload" @click="openCreateDialog">
              上传资产
            </v-btn>
          </v-card-title>
          <v-divider />
          <v-skeleton-loader v-if="loading" type="image, article@3" class="ma-4" />
          <v-container v-else fluid>
            <div class="d-flex justify-end align-center mb-4">
              <v-btn
                icon
                variant="text"
                :loading="manifestRefreshing"
                :disabled="loading"
                @click="handleRefresh"
              >
                <v-icon>mdi-refresh</v-icon>
              </v-btn>
            </div>
            <v-row>
              <v-col v-for="asset in assets" :key="asset.id" cols="12" sm="6" md="4">
                <v-card elevation="2">
                  <v-img
                    v-if="asset.thumbnailUrl"
                    :src="asset.thumbnailUrl"
                    height="160"
                    cover
                  />
                  <v-sheet v-else class="d-flex align-center justify-center" height="160" color="grey-lighten-4">
                    <v-icon icon="mdi-file" size="48" color="grey-darken-1" />
                  </v-sheet>
                  <v-card-title class="text-subtitle-1 font-weight-medium">
                    {{ asset.name }}
                  </v-card-title>
                  <v-card-subtitle class="text-caption text-medium-emphasis">
                    {{ (asset.size / 1024 / 1024).toFixed(2) }} MB · {{ asset.type }}
                  </v-card-subtitle>
                  <v-card-text class="py-0">
                    <div v-if="asset.description" class="text-body-2 mb-2 text-truncate">
                      {{ asset.description }}
                    </div>
                    <div v-if="asset.tags.length" class="d-flex flex-wrap gap-2">
                      <v-chip v-for="tag in asset.tags" :key="tag.id" size="small" color="primary" variant="tonal">
                        {{ tag.name }}
                      </v-chip>
                    </div>
                  </v-card-text>
                  <v-card-actions>
                    <v-btn variant="text" :href="asset.downloadUrl" target="_blank" prepend-icon="mdi-eye">
                      预览
                    </v-btn>
                    <v-btn variant="text" color="primary" prepend-icon="mdi-pencil" @click="openEditDialog(asset)">
                      编辑
                    </v-btn>
                    <v-spacer />
                    <v-btn
                      variant="text"
                      color="error"
                      prepend-icon="mdi-delete"
                      :loading="deleting === asset.id"
                      @click="handleDeleteAsset(asset)"
                    >
                      删除
                    </v-btn>
                  </v-card-actions>
                </v-card>
              </v-col>
            </v-row>
            <div v-if="!loading && !assets.length" class="text-center text-medium-emphasis py-10">
              暂无资产，请先上传
            </div>
            <v-pagination
              v-model="filter.page"
              :length="paginationLength"
              total-visible="7"
              class="my-4"
              @update:model-value="handlePageChange"
            />
            <div class="d-flex justify-end mb-4">
              <v-select
                v-model="filter.pageSize"
                :items="[12, 24, 48]"
                density="compact"
                style="max-width: 120px"
                label="每页数量"
              />
            </div>
          </v-container>
        </v-card>
      </v-col>
    </v-row>
    <AssetFormDialog
      ref="assetDialogRef"
      v-model="assetDialogVisible"
      :mode="assetDialogMode"
      :categories="categories"
      :tags="tags"
      :asset="selectedAsset"
      @submit="handleAssetSubmit"
      @request-manage-tags="tagManagerVisible = true"
    />
    <AssetTagManagerDialog v-model="tagManagerVisible" @updated="ensureTags" />
  </div>
</template>
