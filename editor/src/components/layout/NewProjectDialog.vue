<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SceneCreatorPane from './SceneCreatorPane.vue'

const props = defineProps<{ modelValue: boolean; initialName?: string }>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: { name: string; defaultScene?: { name: string; groundWidth: number; groundDepth: number } }): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const name = ref('')
const defaultSceneName = ref('New Scene')
const defaultGroundWidth = ref<number>(100)
const defaultGroundDepth = ref<number>(100)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = props.initialName?.trim() || 'New Project'
    }
  },
  { immediate: true },
)

function handleCancel() {
  dialogOpen.value = false
}

function handleConfirm() {
  const trimmed = name.value.trim()
  emit('confirm', {
    name: trimmed.length ? trimmed : 'New Project',
    defaultScene: {
      name: defaultSceneName.value,
      groundWidth: defaultGroundWidth.value,
      groundDepth: defaultGroundDepth.value,
    },
  })
  dialogOpen.value = false
}
</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="520">
    <v-card>
      <v-card-title class="text-h6">New Project</v-card-title>
      <v-card-text>
        <v-text-field v-model="name" label="Project Name" variant="outlined" density="comfortable" clearable />
 
        <SceneCreatorPane
          v-model:sceneName="defaultSceneName"
          v-model:groundWidth="defaultGroundWidth"
          v-model:groundDepth="defaultGroundDepth"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="handleCancel">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="handleConfirm">Create and Open</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
