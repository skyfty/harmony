<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { AssetTag, AssetType, ManagedAsset, ResourceCategory } from '@/types'

const props = defineProps<{
  modelValue: boolean
  mode: 'create' | 'edit'
  categories: ResourceCategory[]
  tags: AssetTag[]
  asset?: ManagedAsset | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'submit', payload: { mode: 'create' | 'edit'; formData: FormData; assetId?: string }): void
  (event: 'request-manage-tags'): void
}>()

const assetTypeOptions: Array<{ value: AssetType; label: string }> = [
  { value: 'model', label: '模型' },
  { value: 'image', label: '图片' },
  { value: 'texture', label: '纹理' },
  { value: 'material', label: '材质' },
  { value: 'mesh', label: '网格' },
  { value: 'prefab', label: '预制体' },
  { value: 'video', label: '视频' },
  { value: 'file', label: '文件' },
]

const form = reactive({
  name: '',
  type: 'model' as AssetType,
  categoryId: '' as string | null,
  tagIds: [] as string[],
  description: '' as string | null,
})

const fileField = ref<File | null>(null)
const thumbnailField = ref<File | null>(null)
const submitting = ref(false)
const errorMessage = ref<string | null>(null)

const dialogTitle = computed(() => (props.mode === 'edit' ? '编辑资产' : '上传资产'))
const isCreateMode = computed(() => props.mode === 'create')
const selectedAsset = computed(() => props.asset ?? null)

const categoryOptions = computed(() => props.categories.map((category) => ({
  title: category.name,
  value: category.id,
  type: category.type,
})))

function initializeForm(): void {
  const asset = selectedAsset.value
  form.name = asset?.name ?? ''
  form.type = asset?.type ?? 'model'
  form.categoryId = asset?.categoryId ?? props.categories[0]?.id ?? null
  form.tagIds = asset?.tagIds ? [...asset.tagIds] : []
  form.description = asset?.description ?? null
  fileField.value = null
  thumbnailField.value = null
  errorMessage.value = null
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      initializeForm()
      submitting.value = false
      errorMessage.value = null
    }
  },
)

watch(
  () => props.asset,
  () => {
    if (props.modelValue) {
      initializeForm()
    }
  },
)

function close(): void {
  emit('update:modelValue', false)
}

function appendMetadata(formData: FormData): void {
  if (form.name.trim().length) {
    formData.append('name', form.name.trim())
  }
  if (form.type) {
    formData.append('type', form.type)
  }
  if (form.categoryId) {
    formData.append('categoryId', form.categoryId)
  }
  if (form.description && form.description.trim().length) {
    formData.append('description', form.description.trim())
  }
  form.tagIds.forEach((tagId) => {
    if (tagId.trim().length) {
      formData.append('tagIds', tagId)
    }
  })
}

function handleFileInput(files?: File[] | File | null): void {
  if (!files) {
    fileField.value = null
    return
  }
  if (Array.isArray(files)) {
    fileField.value = files[0] ?? null
    return
  }
  fileField.value = files
}

function handleThumbnailInput(files?: File[] | File | null): void {
  if (!files) {
    thumbnailField.value = null
    return
  }
  if (Array.isArray(files)) {
    thumbnailField.value = files[0] ?? null
    return
  }
  thumbnailField.value = files
}

async function handleSubmit(): Promise<void> {
  if (submitting.value) {
    return
  }
  if (!form.name.trim().length) {
    errorMessage.value = '请输入资产名称'
    return
  }
  if (!form.categoryId) {
    errorMessage.value = '请选择资产分类'
    return
  }
  if (isCreateMode.value && !fileField.value) {
    errorMessage.value = '请上传资产文件'
    return
  }

  const formData = new FormData()
  appendMetadata(formData)
  if (fileField.value) {
    formData.append('file', fileField.value)
  }
  if (thumbnailField.value) {
    formData.append('thumbnail', thumbnailField.value)
  }

  submitting.value = true
  errorMessage.value = null
  emit('submit', {
    mode: props.mode,
    formData,
    assetId: selectedAsset.value?.id,
  })
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    close()
  }
}

function setSubmittingState(state: boolean): void {
  submitting.value = state
}

function setErrorMessage(message: string | null): void {
  errorMessage.value = message
}

defineExpose({
  setSubmitting: setSubmittingState,
  setError: setErrorMessage,
  reset: initializeForm,
})
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="560" persistent @keydown.esc.stop.prevent="handleDialogKeydown">
    <v-card>
      <v-card-title class="text-h6 d-flex align-center justify-space-between">
        <span>{{ dialogTitle }}</span>
        <v-btn icon="mdi-close" variant="text" size="small" @click="close" />
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-form @submit.prevent>
          <v-text-field
            v-model="form.name"
            label="资产名称"
            variant="outlined"
            density="comfortable"
            required
            clearable
          />
          <div class="d-flex flex-wrap gap-4">
            <v-select
              v-model="form.type"
              :items="assetTypeOptions"
              item-title="label"
              item-value="value"
              label="资产类型"
              density="comfortable"
              variant="outlined"
              class="flex-grow-1"
            />
            <v-select
              v-model="form.categoryId"
              :items="categoryOptions"
              item-title="title"
              item-value="value"
              label="资产分类"
              density="comfortable"
              variant="outlined"
              class="flex-grow-1"
            />
          </div>
          <v-autocomplete
            v-model="form.tagIds"
            :items="tags"
            item-title="name"
            item-value="id"
            density="comfortable"
            variant="outlined"
            label="资产标签"
            multiple
            chips
            closable-chips
          >
            <template #append>
              <v-btn icon="mdi-plus-circle" variant="text" size="small" @click="emit('request-manage-tags')" />
            </template>
          </v-autocomplete>
          <v-textarea
            v-model="form.description"
            label="资产描述"
            rows="3"
            auto-grow
            variant="outlined"
            density="comfortable"
          />
          <div class="d-flex flex-column gap-4 mt-4">
            <v-file-input
              label="资产文件"
              show-size
              variant="outlined"
              prepend-icon="mdi-upload"
              accept="*/*"
              density="comfortable"
              :hint="isCreateMode ? '上传资产文件' : '如需替换文件，请重新选择'"
              persistent-hint
              @update:model-value="handleFileInput"
            />
            <div v-if="!isCreateMode && selectedAsset && !fileField">
              <v-alert type="info" density="comfortable" variant="tonal">
                当前文件：{{ selectedAsset?.originalFilename ?? selectedAsset?.name }}
              </v-alert>
            </div>
            <v-file-input
              label="缩略图（可选）"
              show-size
              variant="outlined"
              prepend-icon="mdi-image"
              accept="image/*"
              density="comfortable"
              @update:model-value="handleThumbnailInput"
            />
            <div v-if="!isCreateMode && selectedAsset?.thumbnailUrl && !thumbnailField">
              <v-img :src="selectedAsset?.thumbnailUrl" height="140" cover class="rounded-lg" />
            </div>
          </div>
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mt-4">
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">取消</v-btn>
        <v-btn color="primary" :loading="submitting" @click="handleSubmit">
          {{ isCreateMode ? '上传' : '保存' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
