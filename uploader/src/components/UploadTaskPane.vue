<template>
  <v-card flat>
    <v-card-title class="d-flex align-center justify-space-between">
      <div class="text-truncate">
        {{ task.file.name }}
      </div>
      <div class="d-flex align-center gap-2">
        <v-chip size="small" color="primary" variant="tonal">
          {{ prettySize }}
        </v-chip>
        <v-divider vertical class="mx-2" inset></v-divider>
        <v-btn
          v-if="isUploading"
          icon="mdi-stop-circle"
          color="warning"
          variant="text"
          :title="'取消上传'"
          @click="cancelUpload"
        />
        <v-btn
          v-else
          icon="mdi-cloud-upload"
          color="primary"
          variant="text"
          :disabled="isUploading"
          :title="task.status === 'success' ? '重新上传' : '开始上传'"
          @click="startUpload"
        />

        <v-tooltip text="使用 AI 生成标签" location="top">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              icon="mdi-robot-outline"
              variant="text"
              color="primary"
              :loading="task.aiTagLoading"
              :disabled="task.aiTagLoading || (!task.name && !task.description)"
              @click.stop="handleGenerateAiTags"
            />
          </template>
        </v-tooltip>
        <v-btn
          icon="mdi-close"
          color="default"
          variant="text"
          :title="'关闭标签'"
          @click="removeTask"
        />
      </div>
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
            <v-col cols="12" md="6">
              <SeriesSelector
                :model-value="task.seriesId"
                :series-options="seriesOptions"
                :loading="loadingSeries"
                label="资源系列"
                clearable
                allow-create
                :create-series="uploadStore.createSeries"
                @update:model-value="handleSeriesChange"
                @series-created="handleSeriesCreate"
              />
            </v-col>
            <v-col cols="12" md="6">
              <CategoryPathSelector
                v-model="task.categoryId"
                :categories="categories"
                :disabled="loadingCategories"
                label="资源分类"
                @category-selected="handleCategorySelected"
                @category-created="handleCategoryCreated"
              />
            </v-col>
            <v-col cols="12">
              <div class="task-color-row">
                <v-text-field
                  v-model="task.color"
                  label="主体颜色"
                  placeholder="#RRGGBB"
                  @blur="normalizeTaskColor"
                >
                  <template #append-inner>
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
                  </template>
                </v-text-field>
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
              <v-textarea
                v-model="task.description"
                rows="4"
                label="资源描述"
                class="task-description"
                @blur="handleDescriptionBlur"
              />
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
                class="tag-selector"
                @update:model-value="handleTagInput"
              >
              </v-combobox>
            </v-col>
          </v-row>
        </v-col>
        <v-col cols="12" md="5" class="task-preview-col d-flex">
          <div class="task-preview-wrapper">
            <PreviewRenderer :task="task" />
          </div>
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
import type { AssetSeries, AssetTag, AssetType, ResourceCategory } from '@/types'
import { useUploadStore, type UploadTask } from '@/stores/upload'
import PreviewRenderer from './UploadTaskPreviewRenderer.vue'
import CategoryPathSelector from '@/components/CategoryPathSelector.vue'
import SeriesSelector from '@/components/SeriesSelector.vue'
import { buildCategoryPathString } from '@/utils/categoryPath'

interface Props {
  task: UploadTask
  availableTags: AssetTag[]
  assetTypeOptions: Array<{ value: AssetType; label: string }>
}

const props = defineProps<Props>()

const uploadStore = useUploadStore()
const tagInput = ref<Array<AssetTag | string>>([...props.task.tags])
const isUploading = computed(() => props.task.status === 'uploading')
const categories = computed(() => uploadStore.categories)
const loadingCategories = computed(() => uploadStore.loadingCategories)
const seriesOptions = computed(() => uploadStore.seriesOptions)
const loadingSeries = computed(() => uploadStore.loadingSeries)
const previewBadge = computed(() => {
  switch (props.task.preview.kind) {
    case 'image':
      return '图片'
    case 'text':
      return '文本'
    case 'model':
      return '模型'
    case 'hdri':
      return 'HDRI'
    default:
      return null
  }
})
// Mark as used for TS when referenced in template
void previewBadge

const tagItems = computed(() => props.availableTags)

const TYPE_COLOR_FALLBACK: Record<AssetType, string> = {
  model: '#26c6da',
  mesh: '#26c6da',
  image: '#1e88e5',
  texture: '#8e24aa',
  material: '#ffb74d',
  hdri: '#80cbc4',
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


const colorPreview = computed(() => normalizeHexColor(props.task.color) ?? normalizeHexColor(props.task.asset?.color) ?? TYPE_COLOR_FALLBACK[props.task.type] ?? '#607d8b')

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

function resolveCategoryLabel(category: ResourceCategory | null): string {
  if (!category) {
    return ''
  }
  const names = Array.isArray(category.path) && category.path.length
    ? category.path.map((item) => item?.name ?? '').filter((name) => name.length > 0)
    : [category.name]
  return buildCategoryPathString(names)
}

function findCategoryById(targetId: string | null, list: ResourceCategory[] = categories.value): ResourceCategory | null {
  if (!targetId) {
    return null
  }
  for (const category of list) {
    if (category.id === targetId) {
      return category
    }
    if (Array.isArray(category.children) && category.children.length) {
      const found = findCategoryById(targetId, category.children)
      if (found) {
        return found
      }
    }
  }
  return null
}

function handleCategorySelected(payload: { id: string | null; label: string }): void {
  props.task.categoryId = payload.id
  props.task.categoryPathLabel = payload.label
  props.task.updatedAt = Date.now()
}

function handleCategoryCreated(category: ResourceCategory): void {
  props.task.categoryId = category.id
  props.task.categoryPathLabel = resolveCategoryLabel(category)
  props.task.updatedAt = Date.now()
}

function handleSeriesChange(value: string | null): void {
  uploadStore.updateTaskSeries(props.task.id, value)
}

function handleSeriesCreate(series: AssetSeries): void {
  uploadStore.updateTaskSeries(props.task.id, series.id)
}

watch(
  () => [props.task.categoryId, categories.value],
  () => {
    const matched = findCategoryById(props.task.categoryId)
    const nextLabel = resolveCategoryLabel(matched)
    if (props.task.categoryPathLabel !== nextLabel) {
      props.task.categoryPathLabel = nextLabel
      props.task.updatedAt = Date.now()
    }
  },
  { deep: true },
)

uploadStore.ensureCategoriesLoaded().catch((error: unknown) => console.warn('加载分类失败', error))
uploadStore.ensureSeriesLoaded().catch((error: unknown) => console.warn('加载系列失败', error))

function handleGenerateAiTags(): void {
  void uploadStore.generateTagsWithAi(props.task.id)
}

function handleDescriptionBlur(): void {
  if (!props.task.description?.trim()) {
    return
  }
  void uploadStore.generateTagsWithAi(props.task.id, { auto: true })
}
</script>

<style scoped>
.task-color-row {
  display: flex;
}

.task-color-button {
  width: 40px;
  min-width: 40px;
  height: 40px;
  border-radius: 8px;
  box-shadow: none;
}

.task-color-row :deep(.v-field__append-inner) {
  padding-inline-end: 4px;
}

.task-color-row :deep(.v-field) {
  align-items: center;
}

.task-color-picker {
  padding: 12px;
}

.tag-selector :deep(.v-field__append-inner) {
  padding-inline-end: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: visible;
}

.tag-selector__ai-btn {
  margin-inline-start: 4px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--v-theme-primary);
  background-color: color-mix(in srgb, var(--v-theme-primary) 14%, transparent);
}

.tag-selector__ai-btn :deep(.v-icon) {
  color: currentColor;
}

.tag-selector__ai-btn.v-btn--disabled {
  color: rgba(0, 0, 0, 0.38);
  background-color: color-mix(in srgb, rgba(0, 0, 0, 0.38) 12%, transparent);
}

.tag-selector__message {
  margin-top: 6px;
  font-size: 0.85rem;
}

.tag-selector__message--error {
  color: #ef9a9a;
}

.tag-selector__message--hint {
  color: #80cbc4;
}

.task-dimension-grid {
  display: flex;
  flex-wrap: nowrap;
  gap: 12px;
  align-items: flex-end;
}

.task-dimension-grid :deep(.v-text-field) {
  flex: 1 1 0;
  min-width: 0;
}

.task-size-chip {
  align-self: center;
  margin-left: auto;
}
.task-description :deep(textarea) {
  resize: vertical;
}
.task-description {
  margin-bottom: 8px;
}

.task-preview-col {
  margin-top: 12px;
}

@media (min-width: 960px) {
  .task-preview-col {
    margin-top: 0;
  }
}

.task-preview-wrapper {
  flex: 1 1 auto;
  display: flex;
  min-height: 320px;
}

.task-preview-wrapper :deep(.preview-renderer) {
  flex: 1 1 auto;
}
</style>
