<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { createContent, listContents, removeContent, updateContent } from '@/api/modules/contents'
import type { ContentEntry, ContentMutationPayload } from '@/types'

const contents = ref<ContentEntry[]>([])
const total = ref(0)
const loading = ref(false)
const dialogOpen = ref(false)
const saving = ref(false)
const editingContent = ref<ContentEntry | null>(null)
const errorMessage = ref<string | null>(null)

const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
  status: '',
})

const form = reactive<ContentMutationPayload>({
  slug: '',
  title: '',
  summary: '',
  body: '',
  status: 'draft',
})

const headers = [
  { title: '标题', value: 'title', width: 220 },
  { title: '标识', value: 'slug', width: 200 },
  { title: '状态', value: 'status', width: 120 },
  { title: '更新时间', value: 'updatedAt', width: 200 },
  { title: '操作', value: 'actions', sortable: false, align: 'end' as const, width: 140 },
]

async function loadContents(): Promise<void> {
  try {
    loading.value = true
    const { data, total: totalCount } = await listContents({ ...query })
    contents.value = data
    total.value = totalCount
  } catch (error) {
    console.error('Failed to load contents', error)
  } finally {
    loading.value = false
  }
}

function resetForm(): void {
  form.slug = ''
  form.title = ''
  form.summary = ''
  form.body = ''
  form.status = 'draft'
  editingContent.value = null
  errorMessage.value = null
}

function openCreateDialog(): void {
  resetForm()
  dialogOpen.value = true
}

function openEditDialog(entry: ContentEntry): void {
  editingContent.value = entry
  form.slug = entry.slug
  form.title = entry.title
  form.summary = entry.summary ?? ''
  form.body = entry.body ?? ''
  form.status = entry.status
  dialogOpen.value = true
}

async function submitForm(): Promise<void> {
  if (!form.slug || !form.title) {
    errorMessage.value = '请填写内容标识和标题'
    return
  }
  const payload: ContentMutationPayload = {
    slug: form.slug,
    title: form.title,
    summary: form.summary || undefined,
    body: form.body || undefined,
    status: form.status,
  }
  try {
    saving.value = true
    if (editingContent.value) {
      await updateContent(editingContent.value.id, payload)
    } else {
      await createContent(payload)
    }
    dialogOpen.value = false
    await loadContents()
  } catch (error) {
    console.error('Failed to save content', error)
    errorMessage.value = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

async function handleRemove(entry: ContentEntry): Promise<void> {
  if (!confirm(`确定删除内容 ${entry.title} 吗？`)) {
    return
  }
  try {
    await removeContent(entry.id)
    await loadContents()
  } catch (error) {
    console.error('Failed to remove content', error)
  }
}

function handlePageChange(page: number): void {
  query.page = page
  void loadContents()
}

function handlePageSizeChange(size: number): void {
  query.pageSize = size
  query.page = 1
  void loadContents()
}

function handleSearch(): void {
  query.page = 1
  void loadContents()
}

onMounted(() => {
  void loadContents()
})
</script>

<template>
  <div>
    <v-card elevation="3">
      <v-card-title class="d-flex align-center">
        <span class="text-h6 font-weight-medium">内容管理</span>
        <v-spacer />
        <v-select
          v-model="query.status"
          :items="[
            { title: '全部', value: '' },
            { title: '草稿', value: 'draft' },
            { title: '已发布', value: 'published' },
          ]"
          density="compact"
          class="mr-3"
          style="max-width: 160px"
          label="状态"
          @update:model-value="handleSearch"
        />
        <v-text-field
          v-model="query.keyword"
          density="compact"
          placeholder="搜索内容"
          clearable
          prepend-inner-icon="mdi-magnify"
          class="mr-3"
          @keyup.enter="handleSearch"
          @click:clear="handleSearch"
        />
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
          新建内容
        </v-btn>
      </v-card-title>
      <v-data-table-server
        :items="contents"
        :items-length="total"
        :loading="loading"
        :page="query.page"
        :items-per-page="query.pageSize"
        :headers="headers"
        item-value="id"
        class="elevation-0"
        @update:page="handlePageChange"
        @update:items-per-page="handlePageSizeChange"
      >
        <template #item.status="{ item }">
          <v-chip :color="item.status === 'published' ? 'success' : 'warning'" size="small" variant="tonal">
            {{ item.status === 'published' ? '已发布' : '草稿' }}
          </v-chip>
        </template>
        <template #item.updatedAt="{ item }">
          {{ item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '--' }}
        </template>
        <template #item.actions="{ item }">
          <v-btn icon="mdi-pencil" size="small" variant="text" @click="openEditDialog(item)" />
          <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="handleRemove(item)" />
        </template>
      </v-data-table-server>
    </v-card>

    <v-dialog v-model="dialogOpen" max-width="720">
      <v-card>
        <v-card-title class="text-h6 font-weight-medium">
          {{ editingContent ? '编辑内容' : '新建内容' }}
        </v-card-title>
        <v-card-text>
          <v-text-field v-model="form.title" label="标题" required />
          <v-text-field v-model="form.slug" label="标识 (slug)" required />
          <v-select
            v-model="form.status"
            :items="[
              { title: '草稿', value: 'draft' },
              { title: '已发布', value: 'published' },
            ]"
            label="状态"
          />
          <v-textarea v-model="form.summary" label="摘要" rows="3" auto-grow />
          <v-textarea v-model="form.body" label="内容" rows="8" auto-grow />
          <v-alert v-if="errorMessage" type="error" density="compact" class="mt-4">
            {{ errorMessage }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialogOpen = false">取消</v-btn>
          <v-btn color="primary" :loading="saving" @click="submitForm">
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
