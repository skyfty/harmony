<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { WatchBehaviorParams } from '@harmony/schema'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: WatchBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: WatchBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const params = computed<WatchBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  caging: props.modelValue?.caging ?? false,
}))

const pickerRef = ref<{ cancelPicking: () => void } | null>(null)

function emitUpdate(patch: Partial<WatchBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}

function handleTargetChange(nodeId: string | null) {
  emitUpdate({ targetNodeId: nodeId })
}

function handleCagingChange(enabled: boolean) {
  emitUpdate({ caging: enabled })
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
  <div class="watch-params">
    <NodePicker
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select a node to watch"
      placeholder="No node selected"
      selection-hint="Click a node in the scene to select; it appears on the left with a clear button on the right."
      @update:modelValue="handleTargetChange"
      @pick-state-change="handlePickStateChange"
    />
    <v-switch
      :model-value="params.caging"
      color="primary"
      density="compact"
      hide-details
      label="Lock camera while watching"
      @update:model-value="handleCagingChange(Boolean($event))"
    />
  </div>
</template>

<style scoped>
.watch-params {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
</style>
