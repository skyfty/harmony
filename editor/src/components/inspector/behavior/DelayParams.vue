<script setup lang="ts">
import { computed } from 'vue'
import type { DelayBehaviorParams } from '@harmony/schema'

const props = defineProps<{
  modelValue: DelayBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: DelayBehaviorParams): void
}>()

const params = computed<DelayBehaviorParams>(() => ({
  seconds: Math.max(0, props.modelValue?.seconds ?? 0),
}))

function updateSeconds(value: string | number) {
  const numeric = typeof value === 'number' ? value : parseFloat(value)
  const normalized = Number.isFinite(numeric) ? Math.max(0, numeric) : 0
  emit('update:modelValue', { seconds: normalized })
}
</script>

<template>
  <div class="delay-params">
    <v-text-field
      :model-value="params.seconds"
      type="number"
      label="Duration (seconds)"
      density="compact"
      variant="underlined"
      hide-details
      step="0.1"
      min="0"
      @update:model-value="updateSeconds($event)"
    />
  </div>
</template>

<style scoped>
.delay-params {
  display: flex;
  flex-direction: column;
}
</style>
