<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  sceneName: string
  groundWidth: number
  groundDepth: number
  confirmError?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:sceneName', value: string): void
  (e: 'update:groundWidth', value: number): void
  (e: 'update:groundDepth', value: number): void
}>()

const name = computed({
  get: () => props.sceneName,
  set: (v: string) => emit('update:sceneName', v),
})

const width = computed({
  get: () => props.groundWidth,
  set: (v: number) => emit('update:groundWidth', v),
})

const depth = computed({
  get: () => props.groundDepth,
  set: (v: number) => emit('update:groundDepth', v),
})
</script>

<template>
  <v-divider class="my-4" />

  <v-text-field
    id="new-scene-name"
    v-model="name"
    label="Scene Name"
    variant="outlined"
    density="comfortable"
    autofocus
  />

  <v-row dense>
    <v-col cols="6">
      <v-text-field
        v-model.number="width"
        label="Ground Width (m)"
        variant="outlined"
        density="comfortable"
        type="number"
        min="1"
        step="1"
        suffix="m"
      />
    </v-col>
    <v-col cols="6">
      <v-text-field
        v-model.number="depth"
        label="Ground Depth (m)"
        variant="outlined"
        density="comfortable"
        type="number"
        min="1"
        step="1"
        suffix="m"
      />
    </v-col>
  </v-row>

  <v-alert
    v-if="props.confirmError"
    type="error"
    density="comfortable"
    border="start"
    border-color="error"
    class="mt-4"
  >
    {{ props.confirmError }}
  </v-alert>
</template>

<style scoped>
/* keep minimal styling — parent dialogs provide layout */
</style>
