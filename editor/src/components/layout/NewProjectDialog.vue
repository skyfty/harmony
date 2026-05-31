<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SceneCreatorPane from './SceneCreatorPane.vue'
import {type ProjectCreateParams} from '@/types/project-summary'

type ProjectNameDialogMode = 'create' | 'rename'

const props = defineProps<{
  modelValue: boolean
  mode?: ProjectNameDialogMode
  initialName?: string
  errorMessage?: string | null
  submitting?: boolean
}>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: ProjectCreateParams): void
  (event: 'confirm', payload: { name: string }): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const mode = computed<ProjectNameDialogMode>(() => props.mode ?? 'create')
const dialogTitle = computed(() => (mode.value === 'create' ? 'New Project' : 'Rename Project'))
const confirmLabel = computed(() => (mode.value === 'create' ? 'Create and Open' : 'Rename'))

const name = ref('')
const defaultSceneName = ref('New Scene')
const defaultPlanningData = ref<import('@/types/planning-scene-data').PlanningSceneData | null>(null)
const localErrorMessage = ref('')

const displayErrorMessage = computed(() => props.errorMessage ?? localErrorMessage.value)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = props.initialName?.trim() || (mode.value === 'create' ? 'New Project' : '')
      localErrorMessage.value = ''
      if (mode.value === 'create') {
        defaultSceneName.value = 'New Scene'
        defaultPlanningData.value = null
      }
    }
    if (!open) {
      localErrorMessage.value = ''
      defaultPlanningData.value = null
    }
  },
  { immediate: true },
)

watch(
  () => props.errorMessage,
  (next) => {
    if (next) {
      localErrorMessage.value = ''
    }
  },
)

watch(name, () => {
  if (localErrorMessage.value && name.value.trim().length) {
    localErrorMessage.value = ''
  }
})

function handleCancel() {
  dialogOpen.value = false
}

function handleConfirm() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    if (mode.value === 'rename') {
      localErrorMessage.value = 'Project name is required.'
      return
    }
  }

  if (mode.value === 'create') {
    emit('confirm', {
      name: trimmed.length ? trimmed : 'New Project',
      defaultScene: {
        name: defaultSceneName.value,
        planningData: defaultPlanningData.value,
      },
    })
    return
  }

  emit('confirm', { name: trimmed })
}
</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="520">
    <v-card>
      <v-card-title class="text-h6">{{ dialogTitle }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          label="Project Name"
          variant="underlined"
          density="comfortable"
          clearable
          :disabled="props.submitting === true"
          :error="!!displayErrorMessage"
          :error-messages="displayErrorMessage ? [displayErrorMessage] : []"
          @keydown.enter.prevent="handleConfirm"
        />

        <SceneCreatorPane
          v-if="mode === 'create'"
          v-model:sceneName="defaultSceneName"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="props.submitting === true" @click="handleCancel">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :loading="props.submitting === true" :disabled="props.submitting === true" @click="handleConfirm">{{ confirmLabel }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
