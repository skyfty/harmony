<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { SceneExportFormat, SceneExportOptions } from '@/types/scene-export'
import type { SceneResourceSummary } from '@harmony/schema'


const props = defineProps<{
  modelValue: boolean
  defaultFileName: string
  initialOptions: SceneExportOptions
  exporting: boolean
  progress: number
  progressMessage: string
  errorMessage?: string | null
  resourceSummary?: SceneResourceSummary | null
  resourceSummaryLoading?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: SceneExportOptions): void
  (event: 'cancel'): void
  (event: 'publish', payload: SceneExportOptions): void
}>()

const form = reactive<SceneExportOptions>(getInitialFormState())
const fileNameError = ref<string | null>(null)

const formatOptions = [
  { label: '.json', value: 'json' as SceneExportFormat },
  { label: '.glb', value: 'glb' as SceneExportFormat },
]

function getInitialFormState(): SceneExportOptions {
  const sanitizedName = sanitizeInputName(props.defaultFileName || 'scene')
  return {
    fileName: sanitizedName || 'scene',
    includeTextures: props.initialOptions.includeTextures,
    includeAnimations: props.initialOptions.includeAnimations,
    includeSkybox: props.initialOptions.includeSkybox,
    includeLights: props.initialOptions.includeLights,
    includeHiddenNodes: props.initialOptions.includeHiddenNodes,
    includeSkeletons: props.initialOptions.includeSkeletons,
    includeExtras: props.initialOptions.includeExtras,
    includeOutlineMeshes: props.initialOptions.includeOutlineMeshes ?? true,
    rotateCoordinateSystem: !!props.initialOptions.rotateCoordinateSystem,
    lazyLoadMeshes: props.initialOptions.lazyLoadMeshes ?? true,
    format: props.initialOptions.format ?? 'json',
  }
}

const dialogModel = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const progressValue = computed(() => {
  const clamped = Number.isFinite(props.progress) ? Math.min(Math.max(props.progress, 0), 100) : 0
  return clamped
})

const progressLabel = computed(() => {
  if (!props.exporting && !props.progressMessage) {
    return ''
  }
  return props.progressMessage || `Export progress ${Math.round(progressValue.value)}%`
})

const hasResourceSummary = computed(() => Boolean(props.resourceSummary))

const summaryDisplay = computed(() => {
  const summary = props.resourceSummary
  if (!summary) {
    return {
      total: '0 B',
      embedded: '0 B',
      external: '0 B',
      unknownCount: 0,
      textures: '0 B',
    }
  }
  return {
    total: formatByteSize(summary.totalBytes),
    embedded: formatByteSize(summary.embeddedBytes),
    external: formatByteSize(summary.externalBytes),
    unknownCount: summary.unknownAssetIds?.length ?? 0,
    textures: formatByteSize(summary.textureBytes ?? 0),
  }
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      Object.assign(form, getInitialFormState())
      fileNameError.value = null
    }
  },
)

watch(
  () => props.defaultFileName,
  (name) => {
    if (!props.modelValue || props.exporting) {
      return
    }
    const sanitized = sanitizeInputName(name)
    if (sanitized && form.fileName !== sanitized) {
      form.fileName = sanitized
    }
  },
)

function formatByteSize(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  const digits = index === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(digits)} ${units[index]}`
}

function sanitizeInputName(input: string): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.replace(/\.(glb|json)$/i, '')
}

function validate(): boolean {
  const trimmed = form.fileName.trim()
  if (!trimmed) {
    fileNameError.value = 'Please enter a file name'
    return false
  }
  if (!/^[\w\-\. ]+$/.test(trimmed)) {
    fileNameError.value = 'File name may only contain letters, numbers, spaces, underscores, and hyphens'
    return false
  }
  fileNameError.value = null
  return true
}

function handleCancel() {
  if (props.exporting) {
    return
  }
  emit('cancel')
  emit('update:modelValue', false)
}

function normalFileizeInputName(input: string): string {
  const trimmed = input.trim()
  if (props.initialOptions.format === 'glb') {
    if (/\.(glb)$/i.test(trimmed)) {
      return trimmed
    }
    return `${trimmed}.glb`
  } else {
    if (/\.(json)$/i.test(trimmed)) {
      return trimmed
    }
    return `${trimmed}.json`
  }
}

function handleConfirm() {
  if (props.exporting) {
    return
  }
  if (!validate()) {
    return
  }
  const payload: SceneExportOptions = {
    ...form,
    fileName:  normalFileizeInputName(form.fileName),
  }
  emit('confirm', payload)
}

function handlePublish() {
  if (props.exporting) {
    return
  }
  if (!validate()) {
    return
  }
  const payload: SceneExportOptions = {
    ...form,
    fileName: normalFileizeInputName(form.fileName),
  }
  emit('publish', payload)
}

</script>

<template>
  <v-dialog
    v-model="dialogModel"
    :persistent="exporting"
    max-width="520"
    scrollable
  >
    <v-card>
      <v-toolbar density="compact" class="panel-toolbar" height="40px">
        <div class="toolbar-text">
          <div class="material-title">Scene Export</div>
        </div>
        <v-spacer />
        <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleCancel" />
      </v-toolbar>
      <v-card-text>
        <div class="file-input-row">
          <v-text-field
            v-model="form.fileName"
            label="File name"
            :disabled="exporting"
            :error="!!fileNameError"
            :error-messages="fileNameError ? [fileNameError] : []"
            density="comfortable"
            variant="outlined"
            @keydown.enter.prevent="handleConfirm"
          />
          <v-select
            v-model="form.format"
            class="format-select"
            :disabled="exporting"
            :items="formatOptions"
            item-title="label"
            item-value="value"
            label="Format"
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </div>

        <div class="options-grid">
          <v-checkbox
            v-model="form.includeTextures"
            :disabled="exporting"
            label="Include textures"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.includeAnimations"
            :disabled="exporting"
            label="Include animations"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.includeSkybox"
            :disabled="exporting"
            label="Skybox parameters"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.includeLights"
            :disabled="exporting"
            label="Lights and settings"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.includeHiddenNodes"
            :disabled="exporting"
            label="Hidden nodes"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.includeSkeletons"
            :disabled="exporting"
            label="Skeleton data"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.includeExtras"
            :disabled="exporting"
            label="Additional extensions"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.includeOutlineMeshes"
            :disabled="exporting"
            label="Generate outline meshes"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.lazyLoadMeshes"
            :disabled="exporting"
            label="Lazy load meshes"
            density="compact"
            hide-details
          />
          <v-checkbox
            v-model="form.rotateCoordinateSystem"
            :disabled="exporting"
            label="Rotate coordinate system"
            density="compact"
            hide-details
          />
        </div>

        <div class="summary-section">
          <div v-if="resourceSummaryLoading" class="summary-item summary-item--loading">
            正在分析资源大小…
          </div>
          <div v-else-if="hasResourceSummary" class="summary-item">
            <div class="summary-row">
              <span class="summary-label">资源总大小</span>
              <span class="summary-value">{{ summaryDisplay.total }}</span>
            </div>
            <div class="summary-sub">
              嵌入资源：{{ summaryDisplay.embedded }} · 外部资源：{{ summaryDisplay.external }}
            </div>
            <div class="summary-sub">
              纹理资源：{{ summaryDisplay.textures }}
            </div>
            <div v-if="summaryDisplay.unknownCount" class="summary-warning">
              有 {{ summaryDisplay.unknownCount }} 个资源大小未知
            </div>
          </div>
          <div v-else class="summary-item summary-item--empty">
            资源大小暂不可用
          </div>
        </div>

        <transition name="fade">
          <div v-if="exporting || progressValue > 0" class="progress-section">
            <v-progress-linear
              :model-value="progressValue"
              height="6"
              color="primary"
              rounded
            />
            <div v-if="progressLabel" class="progress-label">{{ progressLabel }}</div>
          </div>
        </transition>

        <transition name="fade">
          <v-alert
            v-if="errorMessage"
            class="mt-3"
            type="error"
            density="comfortable"
            border="start"
            variant="tonal"
          >
            {{ errorMessage }}
          </v-alert>
        </transition>
      </v-card-text>
      <v-divider />
      <v-card-actions class="dialog-actions">
        <v-spacer />
        <v-btn
          color="secondary"
          variant="tonal"
          :loading="exporting"
          :disabled="exporting"
          style="margin-right: 8px"
          @click="handlePublish"
        >
          Publish
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="exporting"
          :disabled="exporting"
          @click="handleConfirm"
        >
          Export
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>

.material-details-panel-enter-active,
.material-details-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.material-details-panel-enter-from,
.material-details-panel-leave-to {
  opacity: 0;
  transform: translate(-105%, 10px);
}

.material-details-panel {
  position: fixed;
  top: 0;
  left: 0;
  transform: translateX(-100%);
  width: 300px;
  max-height: calc(100% - 400px);
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  z-index: 24;
}


.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.toolbar-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toolbar-close {
  color: rgba(233, 236, 241, 0.72);
}
.dialog-title {
  font-weight: 600;
}

.dialog-hint {
  margin-bottom: 12px;
  font-size: 0.92rem;
  color: rgba(0, 0, 0, 0.64);
}

.file-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.format-select {
  min-width: 108px;
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px 12px;
  margin-top: 8px;
  margin-bottom: 12px;
}


.summary-section {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  background: rgba(22, 29, 40, 0.72);
  min-height: 72px;
  display: flex;
  align-items: center;
}

.summary-item {
  width: 100%;
}

.summary-item--loading,
.summary-item--empty {
  color: rgba(239, 244, 255, 0.78);
  font-size: 0.9rem;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.summary-label {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.summary-value {
  font-weight: 700;
  color: #7fb3ff;
}

.summary-sub {
  font-size: 0.82rem;
  color: rgba(224, 231, 247, 0.76);
}

.summary-warning {
  margin-top: 6px;
  font-size: 0.78rem;
  color: #ffb74d;
}

.progress-section {
  margin-top: 4px;
}

.progress-label {
  margin-top: 6px;
  font-size: 0.85rem;
  color: rgba(0, 0, 0, 0.72);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.dialog-actions {
  padding-inline: 16px;
}
</style>
