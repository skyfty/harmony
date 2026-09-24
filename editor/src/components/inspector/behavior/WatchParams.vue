<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { WatchBehaviorParams, WatchRestorePositionSource } from '@schema/core'
import { normalizeWatchRestorePositionSource } from '@schema/core'
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
  restorePositionSource: normalizeWatchRestorePositionSource(props.modelValue?.restorePositionSource),
}))

const restorePositionOptions: Array<{ title: string; value: WatchRestorePositionSource }> = [
  { title: 'Do not restore', value: 'none' },
  { title: 'Move To previous pose', value: 'moveToPreviousPose' },
]

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

function handleRestorePositionSourceChange(value: unknown) {
  emitUpdate({ restorePositionSource: normalizeWatchRestorePositionSource(value) })
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
    <v-select
      :model-value="params.restorePositionSource"
      :items="restorePositionOptions"
      label="Restore position on leave"
      density="compact"
      variant="underlined"
      hide-details
      @update:model-value="handleRestorePositionSourceChange"
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
