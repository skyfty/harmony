<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { listResourceCategories, uploadAsset } from '@/api/modules/resources'
import { useUiStore } from '@/stores/ui'
import type { ManagedAsset, ResourceCategory } from '@/types'

const emit = defineEmits<{
  (event: 'uploaded', asset: ManagedAsset): void
}>()

const uiStore = useUiStore()
const categories = ref<ResourceCategory[]>([])
const selectedCategory = ref<string | null>(null)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadError = ref<string | null>(null)

async function ensureCategoriesLoaded(): Promise<void> {
  if (categories.value.length) {
    return
  }
  try {
    const result = await listResourceCategories()
    categories.value = result
    selectedCategory.value = result[0]?.id ?? null
  } catch (error) {
    console.error('Failed to load resource categories', error)
    uploadError.value = '加载资源分类失败，请稍后重试'
  }
}

watch(
  () => uiStore.resourceDialogOpen,
  (isOpen) => {
    if (isOpen) {
      void ensureCategoriesLoaded()
      uploadError.value = null
      if (fileInput.value) {
        fileInput.value.value = ''
      }
    }
  },
)

async function handleFileSelection(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement | null
  if (!target?.files?.length) {
    return
  }
  await performUpload(target.files[0]!)
}

async function performUpload(file: File): Promise<void> {
  if (!file) {
    return
  }
  if (!selectedCategory.value) {
    uploadError.value = '请选择资源分类'
    return
  }
  try {
    uploading.value = true
    uploadError.value = null
    const formData = new FormData()
    formData.append('file', file)
    const asset = await uploadAsset(formData, { categoryId: selectedCategory.value })
    emit('uploaded', asset)
    uiStore.closeResourceDialog()
  } catch (error) {
    console.error('Failed to upload resource', error)
    uploadError.value = '上传失败，请稍后重试'
  } finally {
    uploading.value = false
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }
}

function openFilePicker(): void {
  fileInput.value?.click()
}

onMounted(() => {
  if (uiStore.resourceDialogOpen) {
    void ensureCategoriesLoaded()
  }
})
</script>

<template>
  <v-dialog v-model="uiStore.resourceDialogOpen" max-width="480">
    <v-card>
      <v-card-title class="text-h6">上传资源</v-card-title>
      <v-card-text>
        <v-select
          v-model="selectedCategory"
          :items="categories"
          item-title="name"
          item-value="id"
          label="资源分类"
        />
        <input ref="fileInput" class="d-none" type="file" @change="handleFileSelection" />
        <v-btn block class="mt-4" color="primary" :loading="uploading" @click="openFilePicker">
          选择并上传文件
        </v-btn>
        <v-alert v-if="uploadError" type="error" class="mt-4" density="compact">
          {{ uploadError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="uiStore.closeResourceDialog()">取消</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
