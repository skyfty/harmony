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
      placeholder="未选择节点"
      selection-hint="点击场景中的节点进行选择，显示在左侧，右侧显示清除按钮。"
      @update:modelValue="handleTargetChange"
      @pick-state-change="handlePickStateChange"
    />
    <v-switch
      :model-value="params.caging"
      inset
      color="primary"
      density="compact"
      hide-details
      label="锁定观察时的相机"
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
