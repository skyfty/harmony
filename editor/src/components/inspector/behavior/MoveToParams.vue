<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { MoveToBehaviorParams } from '@harmony/schema'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: MoveToBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: MoveToBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const params = computed<MoveToBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  duration: Math.max(0, props.modelValue?.duration ?? 0.6),
  offset: Math.max(0, props.modelValue?.offset ?? 1),
}))

const pickerRef = ref<{ cancelPicking: () => void } | null>(null)

function emitUpdate(patch: Partial<MoveToBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}

function updateDuration(value: string | number) {
  const numeric = typeof value === 'number' ? value : parseFloat(value)
  const normalized = Number.isFinite(numeric) ? Math.max(0, numeric) : 0
  emitUpdate({ duration: normalized })
}

function updateOffset(value: string | number) {
  const numeric = typeof value === 'number' ? value : parseFloat(value)
  const normalized = Number.isFinite(numeric) ? Math.max(0, numeric) : 0
  emitUpdate({ offset: normalized })
}

function updateTarget(nodeId: string | null) {
  emitUpdate({ targetNodeId: nodeId })
}

function handlePickStateChange(active: boolean) {
  emit('pick-state-change', active)
}

function cancelPicking() {
  pickerRef.value?.cancelPicking()
}

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  cancelPicking()
})
</script>

<template>
  <div class="move-to-params">
    <NodePicker
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select the node to move to"
      placeholder="No node selected"
      selection-hint="Click a node in the scene to select it. The selection appears on the left; a clear button appears on the right."
      @update:modelValue="updateTarget"
      @pick-state-change="handlePickStateChange"
    />
    <v-text-field
      :model-value="params.duration"
      type="number"
      label="Movement duration (s)"
      density="compact"
      variant="underlined"
      hide-details
      min="0"
      step="0.1"
      @update:model-value="updateDuration($event)"
    />
    <v-text-field
      :model-value="params.offset"
      type="number"
      label="Offset distance (m)"
      density="compact"
      variant="underlined"
      hide-details
      min="0"
      step="0.1"
      @update:model-value="updateOffset($event)"
    />
  </div>
</template>

<style scoped>
.move-to-params {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}
</style>
