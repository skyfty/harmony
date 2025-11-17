<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { AssetTypes } from '@harmony/schema/asset-types'
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
const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  model: '模型',
  image: '图片',
  texture: '纹理',
  hdri: 'HDRI',
  material: '材质',
  mesh: '网格',
  prefab: '预制体',
  video: '视频',
  file: '文件',
}

const typeOptions: Array<{ label: string; value: AssetType }> = AssetTypes.map((type) => ({
  value: type,
  label: ASSET_TYPE_LABELS[type] ?? type,
}))

const canFilterByTags = computed(() => tags.value.length > 0)

type CategoryTreeItem = {
  id: string
  title: string
  pathString: string
  children?: CategoryTreeItem[]
}

const categoryTreeSelection = ref<string[]>([])

function isCategoryTreeItem(item: unknown): item is CategoryTreeItem {
  if (!item || typeof item !== 'object') {
    return false
  }
  const record = item as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.title === 'string'
    && typeof record.pathString === 'string'
}

function categoryToTreeItem(category: ResourceCategory): CategoryTreeItem {
  const pathNames = Array.isArray(category.path) && category.path.length
    ? category.path.map((item) => item?.name ?? '').filter((name) => name.length > 0)
    : [category.name]
  return {
    id: category.id,
    title: category.name,
    pathString: pathNames.join(' / '),
    children: Array.isArray(category.children) && category.children.length
      ? category.children.map((child) => categoryToTreeItem(child))
      : undefined,
  }
}

const categoryTreeItems = computed<CategoryTreeItem[]>(() => categories.value.map((category) => categoryToTreeItem(category)))

function pickFirstCategoryId(list: ResourceCategory[]): string | null {
  for (const category of list) {
    if (category && typeof category.id === 'string') {
      return category.id
    }
    if (Array.isArray(category.children) && category.children.length) {
      const childId = pickFirstCategoryId(category.children)
      if (childId) {
        return childId
      }
    }
  }
  return null
}

function categoryExists(categoryId: string | null, list: ResourceCategory[] = categories.value): boolean {
  if (!categoryId) {
    return false
  }
  for (const category of list) {
    if (category.id === categoryId) {
      return true
    }
    if (Array.isArray(category.children) && category.children.length) {
      if (categoryExists(categoryId, category.children)) {
        return true
      }
    }
  }
  return false
}

watch(
  () => filter.categoryId,
  (value) => {
    categoryTreeSelection.value = value ? [value] : []
  },
  { immediate: true },
)

function handleTreeSelection(selection: unknown): void {
  const normalized = Array.isArray(selection)
    ? selection.filter((item): item is string => typeof item === 'string')
    : []
  const next = normalized[0] ?? null
  if (next !== filter.categoryId) {
    filter.categoryId = next
  }
}

async function ensureCategories(): Promise<void> {
  try {
    const result = await listResourceCategories()
    categories.value = result
    if (filter.categoryId && !categoryExists(filter.categoryId, result)) {
      filter.categoryId = pickFirstCategoryId(result)
    } else if (!filter.categoryId && result.length) {
      filter.categoryId = pickFirstCategoryId(result)
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

function handleCategoryCreated(category: ResourceCategory): void {
  filter.categoryId = category.id
  void ensureCategories()
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
        <v-card elevation="3" class="category-panel">
          <v-card-title class="text-h6 font-weight-medium">资源分类</v-card-title>
          <v-divider class="my-2" />
          <v-list density="compact" nav>
            <v-list-item
              :active="!filter.categoryId"
              prepend-icon="mdi-view-grid"
              title="全部资产"
              @click="filter.categoryId = null"
            />
          </v-list>
          <v-divider class="my-2" />
          <v-treeview
            :items="categoryTreeItems"
            :selected="categoryTreeSelection"
            activatable
            item-value="id"
            item-title="title"
            density="compact"
            open-on-click
            :return-object="false"
            class="category-tree"
            @update:selected="handleTreeSelection"
          >
            <template #prepend>
              <v-icon icon="mdi-folder" size="small" class="mr-1" />
            </template>
            <template #title="{ item }">
              <div v-if="isCategoryTreeItem(item)" class="d-flex flex-column">
                <span>{{ item.title }}</span>
                <span class="text-caption text-medium-emphasis">{{ item.pathString }}</span>
              </div>
            </template>
          </v-treeview>
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
      @category-created="handleCategoryCreated"
    />
    <AssetTagManagerDialog v-model="tagManagerVisible" @updated="ensureTags" />
  </div>
</template>

<style scoped>
.category-panel {
  max-height: calc(100vh - 160px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.category-tree {
  flex: 1 1 auto;
  overflow-y: auto;
}
</style>
