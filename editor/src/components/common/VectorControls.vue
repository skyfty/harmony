<template>
  <div class="vector-group">
    <div class="vector-label" @dblclick="onLabelDblClick">{{ props.label }}</div>
    <v-text-field
      v-for="axis in axes"
      :key="axis"
      :label="axis.toUpperCase()"
      :model-value="localValues[axis]"
      type="number"
      step="0.1"
      density="compact"
      variant="underlined"
      color="primary"
      hide-details
      class="vector-input"
      :disabled="props.disabled"
      :readonly="props.readonly || props.disabled"
      inputmode="decimal"
      @focus="() => onFocus(axis)"
      @blur="() => onBlur(axis)"
      @update:modelValue="(value) => onInput(axis, value)"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

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
  (event: 'dblclick:label'): void
}>()

const axes: VectorAxis[] = ['x', 'y', 'z']

const localValues = reactive<Record<VectorAxis, string>>({
  x: '',
  y: '',
  z: '',
})

const editingAxis = ref<VectorAxis | null>(null)

watch(
  () => props.modelValue,
  (modelValue) => {
    for (const axis of axes) {
      if (editingAxis.value === axis) continue
      localValues[axis] = formatValue(modelValue[axis])
    }
      console.log('watch', localValues)

  },
  { immediate: true, deep: true },
)

function onFocus(axis: VectorAxis) {
  if (props.disabled || props.readonly) return
  editingAxis.value = axis
}

function onBlur(axis: VectorAxis) {
  if (props.disabled || props.readonly) return
  editingAxis.value = null

  const normalized = normalizeToTwoDecimals(localValues[axis])
  if (normalized !== null) {
    localValues[axis] = normalized
  }

  emit('update:axis', axis, localValues[axis])
}

function onInput(axis: VectorAxis, value: string | number) {
  localValues[axis] = typeof value === 'number' ? value.toString() : value
}

function onLabelDblClick() {
  emit('dblclick:label')
}

function formatValue(value: VectorValue): string {
  if (typeof value === 'number') return value.toFixed(2)
  const normalized = normalizeToTwoDecimals(value)
  return normalized ?? value
}

function normalizeToTwoDecimals(raw: string): string | null {
  const text = raw.trim()
  if (text.length === 0) return null

  // Accept inputs like: 2, 1.5, 1., .5, -2.3
  // Reject incomplete numbers like: '-', '.', '-.'
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null
  if (text === '-' || text === '.' || text === '-.') return null

  const n = Number(text)
  if (!Number.isFinite(n)) return null
  return (Math.floor(n * 100) / 100).toString()  // truncate to 2 decimal places
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
  user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
}

.vector-input {
  max-width: 90px;
}
</style>
