<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { createAssetTag, deleteAssetTag, listAssetTags, updateAssetTag } from '@/api/modules/resources'
import type { AssetTag } from '@/types'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'updated'): void
}>()

const tags = ref<AssetTag[]>([])
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const deletePending = ref<string | null>(null)

const formState = reactive({
  id: null as string | null,
  name: '',
  description: '' as string | null,
})

const isEditing = computed(() => formState.id !== null)
const dialogTitle = computed(() => (props.modelValue ? '标签管理' : ''))

async function loadTags(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    tags.value = await listAssetTags()
  } catch (error) {
    console.error('Failed to load asset tags', error)
    errorMessage.value = '加载标签失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function resetForm(): void {
  formState.id = null
  formState.name = ''
  formState.description = null
}

function close(): void {
  emit('update:modelValue', false)
}

async function submitForm(): Promise<void> {
  if (saving.value) {
    return
  }
  const name = formState.name.trim()
  if (!name.length) {
    errorMessage.value = '请输入标签名称'
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    if (isEditing.value && formState.id) {
      await updateAssetTag(formState.id, { name, description: formState.description?.trim() ?? null })
    } else {
      await createAssetTag({ names: [name], description: formState.description?.trim() ?? null })
    }
    resetForm()
    await loadTags()
    emit('updated')
  } catch (error) {
    console.error('Failed to save asset tag', error)
    errorMessage.value = (error as Error).message ?? '保存标签失败'
  } finally {
    saving.value = false
  }
}

function startEdit(tag: AssetTag): void {
  formState.id = tag.id
  formState.name = tag.name
  formState.description = tag.description ?? null
}

async function handleDelete(tag: AssetTag): Promise<void> {
  if (deletePending.value) {
    return
  }
  if (!window.confirm(`确定删除标签 “${tag.name}” 吗？删除后将无法恢复。`)) {
    return
  }
  deletePending.value = tag.id
  errorMessage.value = null
  try {
    await deleteAssetTag(tag.id)
    await loadTags()
    emit('updated')
  } catch (error) {
    console.error('Failed to delete asset tag', error)
    errorMessage.value = (error as Error).message ?? '删除标签失败'
  } finally {
    deletePending.value = null
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      resetForm()
      void loadTags()
    }
  },
)
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" persistent>
    <v-card>
      <v-card-title class="text-h6 d-flex align-center justify-space-between">
        <span>{{ dialogTitle }}</span>
        <v-btn icon="mdi-close" variant="text" size="small" @click="close" />
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-form @submit.prevent>
          <v-text-field
            v-model="formState.name"
            label="标签名称"
            variant="outlined"
            density="comfortable"
            clearable
            required
          />
          <v-textarea
            v-model="formState.description"
            label="标签描述"
            rows="2"
            auto-grow
            variant="outlined"
            density="comfortable"
            clearable
          />
          <div class="d-flex justify-end mb-4">
            <v-btn
              :color="isEditing ? 'primary' : 'success'"
              :loading="saving"
              prepend-icon="mdi-check"
              @click="submitForm"
            >
              {{ isEditing ? '保存标签' : '新增标签' }}
            </v-btn>
            <v-btn v-if="isEditing" class="ml-2" variant="text" @click="resetForm">取消编辑</v-btn>
          </div>
        </v-form>
        <v-alert v-if="errorMessage" class="mb-4" type="error" variant="tonal">
          {{ errorMessage }}
        </v-alert>
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />
        <v-list v-else density="compact" lines="two">
          <v-list-item v-for="tag in tags" :key="tag.id">
            <v-list-item-title class="font-weight-medium">{{ tag.name }}</v-list-item-title>
            <v-list-item-subtitle>{{ tag.description || '—' }}</v-list-item-subtitle>
            <template #append>
              <v-btn icon="mdi-pencil" variant="text" size="small" @click="startEdit(tag)" />
              <v-btn
                icon="mdi-delete"
                variant="text"
                size="small"
                :loading="deletePending === tag.id"
                color="error"
                @click="handleDelete(tag)"
              />
            </template>
          </v-list-item>
          <div v-if="!tags.length" class="text-caption text-medium-emphasis py-6 text-center">
            暂无标签，先添加一个吧
          </div>
        </v-list>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
