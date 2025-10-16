<template>
  <div class="vector-group">
    <div class="vector-label">{{ props.label }}</div>
    <v-text-field
      v-for="axis in axes"
      :key="axis"
      :label="axis.toUpperCase()"
      :model-value="props.modelValue[axis]"
      type="number"
      density="compact"
      variant="underlined"
      color="primary"
      hide-details
      class="vector-input"
      :disabled="props.disabled"
      :readonly="props.disabled"
      @change="onChange(axis, $event)"
    />
  </div>
</template>

<script setup lang="ts">
import type { Vector3Like } from '@/types/scene'

const props = defineProps<{ label: string; modelValue: Vector3Like; min?: number | string; disabled?: boolean }>()

const emit = defineEmits<{
  (event: 'update:axis', axis: keyof Vector3Like, value: string): void
}>()

const axes: Array<keyof Vector3Like> = ['x', 'y', 'z']

function onChange(axis: keyof Vector3Like, event: Event) {
  if (props.disabled) {
    return
  }
  emit('update:axis', axis, (event.target as HTMLInputElement).value)
}
</script>

<style scoped>
.vector-group {
  display: grid;
  grid-template-columns: 1fr repeat(3, 1fr);
  align-items: center;
  gap: 3px;
  padding: 0.5rem 1rem;
}

.vector-label {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.72);
}

.vector-input {
  max-width: 90px;
}
</style>
