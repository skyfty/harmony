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
      :min="props.min"
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
  if (normalized === null) {
    // Keep the current text if it's not a valid number; don't emit.
    return
  }

  localValues[axis] = normalized
  emit('update:axis', axis, normalized)
}

function onInput(axis: VectorAxis, value: string | number) {
  const text = typeof value === 'number' ? value.toString() : value
  localValues[axis] = text

  // Update the scene immediately for complete numeric values (e.g. spinner up/down arrows).
  if (props.disabled || props.readonly) return
  if (editingAxis.value !== axis) return

  const trimmed = text.trim()
  if (!isCompleteNumberText(trimmed)) return
  emit('update:axis', axis, trimmed)
}

function onLabelDblClick() {
  emit('dblclick:label')
}

function formatValue(value: VectorValue): string {
  if (typeof value === 'number') return truncateNumberToTwoDecimals(value)
  const normalized = normalizeToTwoDecimals(value)
  return normalized ?? value
}

function truncateNumberToTwoDecimals(value: number): string {
  if (!Number.isFinite(value)) return '0.00'
  // Truncate (not round) to 2 decimals.
  const scaled = value * 100
  const truncatedInt = Math.trunc(scaled)
  return (truncatedInt / 100).toFixed(2)
}

function normalizeToTwoDecimals(raw: string): string | null {
  const text = raw.trim()
  if (text.length === 0) return null

  // Accept inputs like: 2, 1.5, 1., .5, -2.3
  // Reject incomplete numbers like: '-', '.', '-.'
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null
  if (text === '-' || text === '.' || text === '-.') return null

  // Pure string-based truncation to avoid floating rounding, then pad to 2 decimals.
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [intRaw = '0', fracRaw = ''] = unsigned.split('.')

  const intPart = intRaw.length === 0 ? '0' : intRaw
  const fracPart = (fracRaw + '00').slice(0, 2) // truncate and pad

  return `${negative ? '-' : ''}${intPart}.${fracPart}`
}

function isCompleteNumberText(text: string): boolean {
  // Reject incomplete numbers like: '-', '.', '-.', '1.' while typing.
  if (text === '-' || text === '.' || text === '-.') return false
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)
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
