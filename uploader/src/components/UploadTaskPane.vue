<template>
  <v-card flat>
    <v-card-title class="d-flex align-center justify-space-between">
      <div class="text-truncate">
        {{ task.file.name }}
      </div>
      <v-chip size="small" color="primary" variant="tonal">
        {{ prettySize }}
      </v-chip>
    </v-card-title>
    <v-divider></v-divider>
    <v-card-text class="pt-6">
      <v-row dense>
        <v-col cols="12" md="6">
          <v-text-field v-model="task.name" label="资源名称" required />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="task.type"
            :items="assetTypeOptions"
            item-title="label"
            item-value="value"
            label="资源类型"
            @update:model-value="handleTypeChange"
          />
        </v-col>
        <v-col cols="12">
          <v-textarea
            v-model="task.description"
            auto-grow
            rows="2"
            label="资源描述"
          />
        </v-col>
        <v-col cols="12">
          <v-combobox
            v-model="tagInput"
            :items="tagItems"
            label="资源标签"
            chips
            closable-chips
            multiple
            clearable
            return-object
            item-title="name"
            item-value="id"
            hide-selected
            @update:model-value="handleTagInput"
          />
        </v-col>
        <v-col cols="12">
          <div class="mb-2 font-weight-medium">预览</div>
          <PreviewRenderer :task="task" />
        </v-col>
      </v-row>
    </v-card-text>
    <v-divider></v-divider>
    <v-card-actions class="flex-wrap gap-2">
      <v-progress-linear
        :model-value="task.progress"
        height="8"
        rounded="lg"
        class="flex-1"
        color="primary"
        :indeterminate="isUploading && task.progress === 0"
      ></v-progress-linear>
      <v-spacer></v-spacer>
      <v-btn
        v-if="isUploading"
        color="warning"
        variant="tonal"
        @click="cancelUpload"
      >
        取消上传
      </v-btn>
      <v-btn
        v-else
        color="primary"
        :disabled="isUploading"
        @click="startUpload"
      >
        {{ task.status === 'success' ? '重新上传' : '开始上传' }}
      </v-btn>
      <v-btn
        color="error"
        variant="text"
        @click="removeTask"
      >
        关闭标签
      </v-btn>
    </v-card-actions>
    <v-expand-transition>
      <div v-if="task.status === 'success'" class="pa-4">
        <v-alert type="success" variant="tonal">上传成功</v-alert>
      </div>
    </v-expand-transition>
    <v-expand-transition>
      <div v-if="task.status === 'error' && task.error" class="pa-4">
        <v-alert type="error" variant="tonal">{{ task.error }}</v-alert>
      </div>
    </v-expand-transition>
    <v-expand-transition>
      <div v-if="task.status === 'canceled'" class="pa-4">
        <v-alert type="warning" variant="tonal">已取消上传</v-alert>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetTag, AssetType } from '@/types'
import { useUploadStore, type UploadTask } from '@/stores/upload'
import PreviewRenderer from './UploadTaskPreviewRenderer.vue'

interface Props {
  task: UploadTask
  availableTags: AssetTag[]
  assetTypeOptions: Array<{ value: AssetType; label: string }>
}

const props = defineProps<Props>()

const uploadStore = useUploadStore()
const tagInput = ref<Array<AssetTag | string>>([...props.task.tags])
const isUploading = computed(() => props.task.status === 'uploading')

const tagItems = computed(() => props.availableTags)

watch(
  () => props.task.tags,
  (next: AssetTag[]) => {
    tagInput.value = [...next]
  },
)

const prettySize = computed(() => {
  const size = props.task.size
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
})

async function handleTagInput(values: Array<AssetTag | string>): Promise<void> {
  const hasNew = values.some((value) => typeof value === 'string')
  if (hasNew) {
    await uploadStore.syncTagValues(props.task.id, values)
    tagInput.value = [...props.task.tags]
  } else {
    uploadStore.updateTaskTags(props.task.id, values as AssetTag[])
  }
}

function startUpload(): void {
  uploadStore.startUpload(props.task.id)
}

function cancelUpload(): void {
  uploadStore.cancelUpload(props.task.id)
}

function removeTask(): void {
  uploadStore.removeTask(props.task.id)
}

function handleTypeChange(): void {
  void uploadStore.refreshPreview(props.task.id).catch((error: unknown) => console.warn('刷新预览失败', error))
}
</script>
