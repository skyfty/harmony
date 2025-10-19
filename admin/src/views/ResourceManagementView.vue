<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import ResourceUploadDialog from '@/components/ResourceUploadDialog.vue'
import { listResourceCategories, listAssets, removeAsset } from '@/services/modules/resources'
import { useUiStore } from '@/stores/ui'
import type { ManagedAsset, ResourceCategory } from '@/types'

const uiStore = useUiStore()
const categories = ref<ResourceCategory[]>([])
const assets = ref<ManagedAsset[]>([])
const total = ref(0)
const loading = ref(false)
const deleting = ref<string | null>(null)

const query = reactive({
  page: 1,
  pageSize: 12,
  keyword: '',
  categoryId: '' as string | null,
})

async function loadCategories(): Promise<void> {
  try {
    categories.value = await listResourceCategories()
    if (!query.categoryId && categories.value.length) {
      query.categoryId = categories.value[0]!.id
    }
  } catch (error) {
    console.error('Failed to load categories', error)
  }
}

async function loadAssets(): Promise<void> {
  try {
    loading.value = true
    const { data, total: totalCount } = await listAssets({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      categoryId: query.categoryId || undefined,
    })
    assets.value = data
    total.value = totalCount
  } catch (error) {
    console.error('Failed to load assets', error)
  } finally {
    loading.value = false
  }
}

async function handleRemoveAsset(asset: ManagedAsset): Promise<void> {
  if (!confirm(`确定删除资源 ${asset.name} 吗？`)) {
    return
  }
  try {
    deleting.value = asset.id
    await removeAsset(asset.id)
    await loadAssets()
  } catch (error) {
    console.error('Failed to delete asset', error)
  } finally {
    deleting.value = null
  }
}

function handlePageChange(page: number): void {
  query.page = page
  void loadAssets()
}

function handlePageSizeChange(size: number): void {
  query.pageSize = size
  query.page = 1
  void loadAssets()
}

function handleSearch(): void {
  query.page = 1
  void loadAssets()
}

function handleUploaded(): void {
  query.page = 1
  void loadAssets()
}

watch(
  () => query.categoryId,
  () => {
    query.page = 1
    void loadAssets()
  },
)

onMounted(() => {
  void loadCategories().then(() => loadAssets())
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
              :active="category.id === query.categoryId"
              @click="query.categoryId = category.id"
            >
              <template #prepend>
                <v-icon :icon="category.type === 'image' ? 'mdi-image' : category.type === 'model' ? 'mdi-cube-outline' : 'mdi-file-outline'" />
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
      <v-col cols="12" md="9">
        <v-card elevation="3">
          <v-card-title class="d-flex align-center">
            <span class="text-h6 font-weight-medium">资源列表</span>
            <v-spacer />
            <v-text-field
              v-model="query.keyword"
              density="compact"
              placeholder="搜索资源"
              prepend-inner-icon="mdi-magnify"
              clearable
              class="mr-3"
              style="max-width: 260px"
              @keyup.enter="handleSearch"
              @click:clear="handleSearch"
            />
            <v-btn color="primary" prepend-icon="mdi-upload" @click="uiStore.openResourceDialog()">
              上传资源
            </v-btn>
          </v-card-title>
          <v-divider />
          <v-skeleton-loader v-if="loading" type="image, article@3" class="ma-4" />
          <v-container v-else fluid>
            <v-row>
              <v-col v-for="asset in assets" :key="asset.id" cols="12" sm="6" md="4">
                <v-card elevation="2">
                  <v-img
                    v-if="asset.previewUrl"
                    :src="asset.previewUrl"
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
                    {{ (asset.size / 1024 / 1024).toFixed(2) }} MB
                  </v-card-subtitle>
                  <v-card-actions>
                    <v-btn variant="text" :href="asset.url" target="_blank" prepend-icon="mdi-eye">
                      预览
                    </v-btn>
                    <v-spacer />
                    <v-btn
                      variant="text"
                      color="error"
                      prepend-icon="mdi-delete"
                      :loading="deleting === asset.id"
                      @click="handleRemoveAsset(asset)"
                    >
                      删除
                    </v-btn>
                  </v-card-actions>
                </v-card>
              </v-col>
            </v-row>
            <div v-if="!loading && !assets.length" class="text-center text-medium-emphasis py-10">
              暂无资源，请先上传
            </div>
            <v-pagination
              v-model="query.page"
              :length="Math.max(1, Math.ceil(total / query.pageSize))"
              total-visible="7"
              class="my-4"
              @update:model-value="handlePageChange"
            />
            <div class="d-flex justify-end mb-4">
              <v-select
                v-model="query.pageSize"
                :items="[12, 24, 48]"
                density="compact"
                style="max-width: 120px"
                label="每页数量"
                @update:model-value="handlePageSizeChange"
              />
            </div>
          </v-container>
        </v-card>
      </v-col>
    </v-row>
    <ResourceUploadDialog @uploaded="handleUploaded" />
  </div>
</template>
