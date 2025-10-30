<template>
  <div class="vector-group">
    <div class="vector-label">{{ props.label }}</div>
    <v-text-field
      v-for="axis in axes"
      :key="axis"
      :label="axis.toUpperCase()"
      :model-value="formatValue(props.modelValue[axis])"
      :type="props.readonly ? 'text' : 'number'"
      density="compact"
      variant="underlined"
      color="primary"
      hide-details
      class="vector-input"
      :disabled="props.disabled"
      :readonly="props.readonly || props.disabled"
      inputmode="decimal"
      @change="onChange(axis, $event)"
    />
  </div>
</template>

<script setup lang="ts">
type VectorAxis = 'x' | 'y' | 'z'
type VectorValue = number | string
type VectorDisplay = Record<VectorAxis, VectorValue>

const props = defineProps<{
  label: string
  modelValue: VectorDisplay
  min?: number | string
  disabled?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:axis', axis: VectorAxis, value: string): void
}>()

const axes: VectorAxis[] = ['x', 'y', 'z']

function onChange(axis: VectorAxis, event: Event) {
  if (props.disabled || props.readonly) {
    return
  }
  emit('update:axis', axis, (event.target as HTMLInputElement).value)
}

function formatValue(value: VectorValue): string {
  return typeof value === 'number' ? value.toString() : value
}
</script>

<style scoped>
.vector-group {
  display: grid;
  grid-template-columns: 1fr repeat(3, 1fr);
  align-items: center;
  gap: 3px;
  padding: 0.5rem 0rem;
}

.vector-label {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.72);
}

.vector-input {
  max-width: 90px;
}
</style>
