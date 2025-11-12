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
        <v-col cols="12" md="7">
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
              <div class="task-color-row">
                <v-text-field
                  v-model="task.color"
                  label="主体颜色"
                  placeholder="#RRGGBB"
                  @blur="normalizeTaskColor"
                />
                <v-menu
                  :close-on-content-click="false"
                  transition="scale-transition"
                  location="bottom start"
                >
                  <template #activator="{ props: menuProps }">
                    <v-btn
                      v-bind="menuProps"
                      class="task-color-button"
                      :style="{ backgroundColor: colorPreview }"
                      variant="tonal"
                      size="small"
                    >
                      <v-icon color="white">mdi-eyedropper-variant</v-icon>
                    </v-btn>
                  </template>
                  <div class="task-color-picker">
                    <v-color-picker
                      :model-value="colorPreview"
                      mode="hex"
                      :modes="['hex']"
                      hide-inputs
                      @update:model-value="applyTaskColor"
                    />
                  </div>
                </v-menu>
              </div>
            </v-col>
            <v-col v-if="task.type === 'model'" cols="12">
              <div class="task-dimension-grid">
                <v-text-field
                  :model-value="formatDimension(task.dimensionLength)"
                  label="长度 (m)"
                  type="number"
                  step="0.01"
                  min="0"
                  suffix="m"
                  @update:model-value="onLengthInput"
                />
                <v-text-field
                  :model-value="formatDimension(task.dimensionWidth)"
                  label="宽度 (m)"
                  type="number"
                  step="0.01"
                  min="0"
                  suffix="m"
                  @update:model-value="onWidthInput"
                />
                <v-text-field
                  :model-value="formatDimension(task.dimensionHeight)"
                  label="高度 (m)"
                  type="number"
                  step="0.01"
                  min="0"
                  suffix="m"
                  @update:model-value="onHeightInput"
                />
                <v-chip
                  v-if="sizeCategory"
                  class="task-size-chip"
                  size="small"
                  color="secondary"
                  variant="tonal"
                >
                  尺寸分类：{{ sizeCategory }}
                </v-chip>
              </div>
            </v-col>
            <v-col v-else-if="task.type === 'image'" cols="12">
              <div class="task-dimension-grid">
                <v-text-field
                  :model-value="formatInteger(task.imageWidth)"
                  label="图片宽度 (px)"
                  type="number"
                  step="1"
                  min="0"
                  suffix="px"
                  @update:model-value="onImageWidthInput"
                />
                <v-text-field
                  :model-value="formatInteger(task.imageHeight)"
                  label="图片高度 (px)"
                  type="number"
                  step="1"
                  min="0"
                  suffix="px"
                  @update:model-value="onImageHeightInput"
                />
              </div>
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
          </v-row>
        </v-col>
        <v-col cols="12" md="5">
          <div class="d-flex align-center justify-space-between mb-3">
            <div class="font-weight-medium">资源预览</div>
            <v-chip v-if="previewBadge" size="small" variant="tonal" color="secondary">
              {{ previewBadge }}
            </v-chip>
          </div>
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
const previewBadge = computed(() => {
  switch (props.task.preview.kind) {
    case 'image':
      return '图片'
    case 'text':
      return '文本'
    case 'model':
      return '模型'
    default:
      return null
  }
})

const tagItems = computed(() => props.availableTags)

const TYPE_COLOR_FALLBACK: Record<AssetType, string> = {
  model: '#26c6da',
  mesh: '#26c6da',
  image: '#1e88e5',
  texture: '#8e24aa',
  material: '#ffb74d',
  prefab: '#7986cb',
  video: '#ff7043',
  file: '#546e7a',
}

type DimensionKey = 'dimensionLength' | 'dimensionWidth' | 'dimensionHeight'
type ImageDimensionKey = 'imageWidth' | 'imageHeight'

function normalizeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  return /^#([0-9a-fA-F]{6})$/.test(prefixed) ? `#${prefixed.slice(1).toLowerCase()}` : null
}

function computeSizeCategory(length: number | null, width: number | null, height: number | null): string | null {
  const values = [length, width, height]
    .filter((candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0)
  if (!values.length) {
    return null
  }
  const max = Math.max(...values)
  if (max < 0.1) {
    return '微型'
  }
  if (max < 0.5) {
    return '小型'
  }
  if (max < 1) {
    return '普通'
  }
  if (max < 3) {
    return '中型'
  }
  if (max < 10) {
    return '大型'
  }
  if (max < 30) {
    return '巨型'
  }
  return '巨大型'
}

const colorPreview = computed(() => normalizeHexColor(props.task.color) ?? normalizeHexColor(props.task.asset?.color) ?? TYPE_COLOR_FALLBACK[props.task.type] ?? '#607d8b')
const sizeCategory = computed(() => computeSizeCategory(props.task.dimensionLength, props.task.dimensionWidth, props.task.dimensionHeight))

function normalizeTaskColor(): void {
  const normalized = normalizeHexColor(props.task.color)
  props.task.color = normalized ?? ''
}

function applyTaskColor(value: string | null): void {
  const normalized = normalizeHexColor(value)
  if (normalized) {
    props.task.color = normalized
  }
}

function formatDimension(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function setDimension(key: DimensionKey, value: string | number | null): void {
  const parsed = typeof value === 'number' ? value : Number.parseFloat((value ?? '').toString())
  props.task[key] = Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function formatInteger(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : ''
}

function setImageDimension(key: ImageDimensionKey, value: string | number | null): void {
  const parsed = typeof value === 'number' ? value : Number.parseFloat((value ?? '').toString())
  props.task[key] = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

function onLengthInput(value: string | number | null): void {
  setDimension('dimensionLength', value)
}

function onWidthInput(value: string | number | null): void {
  setDimension('dimensionWidth', value)
}

function onHeightInput(value: string | number | null): void {
  setDimension('dimensionHeight', value)
}

function onImageWidthInput(value: string | number | null): void {
  setImageDimension('imageWidth', value)
}

function onImageHeightInput(value: string | number | null): void {
  setImageDimension('imageHeight', value)
}

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
  if (props.task.type !== 'model') {
    props.task.dimensionLength = null
    props.task.dimensionWidth = null
    props.task.dimensionHeight = null
  }
  if (props.task.type !== 'image') {
    props.task.imageWidth = null
    props.task.imageHeight = null
  }
  void uploadStore.refreshPreview(props.task.id).catch((error: unknown) => console.warn('刷新预览失败', error))
}
</script>

<style scoped>
.task-color-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.task-color-button {
  width: 44px;
  min-width: 44px;
  height: 44px;
  border-radius: 8px;
}

.task-color-picker {
  padding: 12px;
}

.task-dimension-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}

.task-size-chip {
  align-self: center;
}
</style>
