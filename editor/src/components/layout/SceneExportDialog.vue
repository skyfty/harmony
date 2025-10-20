<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

export type SceneExportDialogOptions = {
  includeTextures: boolean
  includeAnimations: boolean
  includeSkybox: boolean
  includeLights: boolean
  includeHiddenNodes: boolean
  includeSkeletons: boolean
  includeCameras: boolean
  includeExtras: boolean
}

export type SceneExportDialogPayload = SceneExportDialogOptions & {
  fileName: string
}

const props = defineProps<{
  modelValue: boolean
  defaultFileName: string
  initialOptions: SceneExportDialogOptions
  exporting: boolean
  progress: number
  progressMessage: string
  errorMessage?: string | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: SceneExportDialogPayload): void
  (event: 'cancel'): void
}>()

const form = reactive<SceneExportDialogPayload>(getInitialFormState())
const fileNameError = ref<string | null>(null)

function getInitialFormState(): SceneExportDialogPayload {
  const sanitizedName = sanitizeInputName(props.defaultFileName || 'scene')
  return {
    fileName: sanitizedName || 'scene',
    includeTextures: props.initialOptions.includeTextures,
    includeAnimations: props.initialOptions.includeAnimations,
    includeSkybox: props.initialOptions.includeSkybox,
    includeLights: props.initialOptions.includeLights,
    includeHiddenNodes: props.initialOptions.includeHiddenNodes,
    includeSkeletons: props.initialOptions.includeSkeletons,
    includeCameras: props.initialOptions.includeCameras,
    includeExtras: props.initialOptions.includeExtras,
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

function sanitizeInputName(input: string): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.replace(/\.glb$/i, '')
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

function handleConfirm() {
  if (props.exporting) {
    return
  }
  if (!validate()) {
    return
  }
  const payload: SceneExportDialogPayload = {
    ...form,
    fileName: form.fileName.trim(),
  }
  emit('confirm', payload)
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
      <v-card-title class="dialog-title">Scene Export</v-card-title>
      <v-card-text>
        <p class="dialog-hint">Enter a file name and choose what to include in the export. The resulting file is saved as <code>.glb</code>.</p>
        <v-text-field
          v-model="form.fileName"
          label="文件名"
          :disabled="exporting"
          :error="!!fileNameError"
          :error-messages="fileNameError ? [fileNameError] : []"
          density="comfortable"
          variant="outlined"
          @keydown.enter.prevent="handleConfirm"
        >
          <template #append-inner>
            <span class="field-suffix">.glb</span>
          </template>
        </v-text-field>

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
            v-model="form.includeCameras"
            :disabled="exporting"
            label="Cameras"
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
        <v-btn
          variant="text"
          color="secondary"
          :disabled="exporting"
          @click="handleCancel"
        >
          Cancel
        </v-btn>
        <v-spacer />
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
.dialog-title {
  font-weight: 600;
}

.dialog-hint {
  margin-bottom: 12px;
  font-size: 0.92rem;
  color: rgba(0, 0, 0, 0.64);
}

.field-suffix {
  font-size: 0.85rem;
  color: rgba(0, 0, 0, 0.54);
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px 12px;
  margin-top: 8px;
  margin-bottom: 12px;
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
