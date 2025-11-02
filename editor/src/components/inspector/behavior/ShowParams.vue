<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { ShowBehaviorParams } from '@harmony/schema'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: ShowBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: ShowBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const params = computed<ShowBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
}))

const pickerRef = ref<{ cancelPicking: () => void } | null>(null)

function updateParams(next: ShowBehaviorParams) {
  emit('update:modelValue', next)
}

function handleTargetChange(nodeId: string | null) {
  updateParams({ targetNodeId: nodeId })
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
  <div class="visibility-params">
    <NodePicker
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select a node to show"
      placeholder="未选择节点"
      selection-hint="点击场景中的节点进行选择，显示在左侧，右侧显示清除按钮。"
      @update:modelValue="handleTargetChange"
      @pick-state-change="handlePickStateChange"
    />
  </div>
</template>

<style scoped>
.visibility-params {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
</style>
