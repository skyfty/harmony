<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  initialName?: string
  initialGroundWidth?: number
  initialGroundDepth?: number
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: { name: string; groundWidth: number; groundDepth: number }): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const sceneName = ref('New Scene')
const groundWidth = ref<number>(100)
const groundDepth = ref<number>(100)

function normalizeDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(20000, Math.max(1, numeric))
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      sceneName.value = props.initialName?.trim().length
        ? props.initialName.trim()
        : 'New Scene'
      groundWidth.value = normalizeDimension(props.initialGroundWidth, 100)
      groundDepth.value = normalizeDimension(props.initialGroundDepth, 100)
      await nextTick()
      const input = document.getElementById('new-scene-name') as HTMLInputElement | null
      input?.focus()
      input?.select()
    } else {
      sceneName.value = 'New Scene'
      groundWidth.value = 100
      groundDepth.value = 100
    }
  },
  { immediate: true },
)

function confirm() {
  const trimmed = sceneName.value.trim()
  const name = trimmed.length ? trimmed : 'New Scene'
  const width = normalizeDimension(groundWidth.value, 100)
  const depth = normalizeDimension(groundDepth.value, 100)
  groundWidth.value = width
  groundDepth.value = depth
  emit('confirm', { name, groundWidth: width, groundDepth: depth })
  emit('update:modelValue', false)
}

function cancel() {
  emit('update:modelValue', false)
}

</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="420">
    <v-card>
      <v-card-title>New Scene</v-card-title>
      <v-card-text>
        <v-text-field
          id="new-scene-name"
          v-model="sceneName"
          label="Scene Name"
          variant="outlined"
          density="comfortable"
          autofocus
          @keydown.enter.prevent="confirm"
        />
        <v-row dense>
          <v-col cols="6">
            <v-text-field
              v-model.number="groundWidth"
              label="Ground Width (m)"
              variant="outlined"
              density="comfortable"
              type="number"
              min="1"
              step="1"
              suffix="m"
              @keydown.enter.prevent="confirm"
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model.number="groundDepth"
              label="Ground Depth (m)"
              variant="outlined"
              density="comfortable"
              type="number"
              min="1"
              step="1"
              suffix="m"
              @keydown.enter.prevent="confirm"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="confirm">Create</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
