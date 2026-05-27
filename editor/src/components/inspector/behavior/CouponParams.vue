<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { CouponBehaviorParams } from '@schema/core'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: CouponBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: CouponBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const params = computed<CouponBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
}))

const pickerRef = ref<{ cancelPicking: () => void } | null>(null)

function emitUpdate(patch: Partial<CouponBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}

function handleTargetChange(nodeId: string | null) {
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
  <div class="coupon-params">
    <NodePicker
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select the coupon target node"
      placeholder="Self node"
      selection-hint="Leave empty to use the behavior owner node as the coupon target."
      @update:modelValue="handleTargetChange"
      @pick-state-change="handlePickStateChange"
    />
  </div>
</template>

<style scoped>
.coupon-params {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
</style>
