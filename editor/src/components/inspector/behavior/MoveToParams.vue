<script setup lang="ts">
import { computed } from 'vue'
import type { MoveToBehaviorParams, MoveToFacingDirection } from '@harmony/schema'

const props = defineProps<{
  modelValue: MoveToBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: MoveToBehaviorParams): void
}>()

const FACING_OPTIONS: Array<{ label: string; value: MoveToFacingDirection }> = [
  { label: 'Node Front', value: 'front' },
  { label: 'Node Back', value: 'back' },
  { label: 'Node Left', value: 'left' },
  { label: 'Node Right', value: 'right' },
]

const params = computed<MoveToBehaviorParams>(() => ({
  speed: Math.max(0, props.modelValue?.speed ?? 2),
  facing: props.modelValue?.facing ?? 'front',
  offset: Math.max(0, props.modelValue?.offset ?? 2),
}))

function updateField<Key extends keyof MoveToBehaviorParams>(key: Key, value: MoveToBehaviorParams[Key]) {
  emit('update:modelValue', {
    ...params.value,
    [key]: value,
  })
}

function updateNumericField(key: 'speed' | 'offset', value: string | number) {
  const numeric = typeof value === 'number' ? value : parseFloat(value)
  const normalized = Number.isFinite(numeric) ? Math.max(0, numeric) : 0
  updateField(key, normalized as MoveToBehaviorParams[typeof key])
}
</script>

<template>
  <div class="move-to-params">
    <v-text-field
      :model-value="params.speed"
      type="number"
      label="Speed (m/s)"
      density="compact"
      variant="underlined"
      hide-details
      min="0"
      step="0.1"
      @update:model-value="updateNumericField('speed', $event)"
    />
    <v-select
      :model-value="params.facing"
      :items="FACING_OPTIONS"
      item-title="label"
      item-value="value"
      label="Facing"
      density="compact"
      variant="underlined"
      hide-details
      @update:model-value="updateField('facing', $event as MoveToFacingDirection)"
    />
    <v-text-field
      :model-value="params.offset"
      type="number"
      label="Offset Distance (m)"
      density="compact"
      variant="underlined"
      hide-details
      min="0"
      step="0.1"
      @update:model-value="updateNumericField('offset', $event)"
    />
  </div>
</template>

<style scoped>
.move-to-params {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
