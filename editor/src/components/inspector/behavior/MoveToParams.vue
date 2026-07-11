<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { MoveToBehaviorParams } from '@schema/core'
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
  kinetics: props.modelValue?.kinetics === true,
}))

const pickerRef = ref<{ cancelPicking: () => void } | null>(null)

function emitUpdate(patch: Partial<MoveToBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}

function updateTarget(nodeId: string | null) {
  emitUpdate({ targetNodeId: nodeId })
}

function updateKinetics(value: boolean) {
  emitUpdate({ kinetics: value })
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
    <v-checkbox
      :model-value="params.kinetics"
      class="move-to-params__kinetics"
      label="Kinetics"
      density="compact"
      hide-details
      @update:model-value="updateKinetics(Boolean($event))"
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
