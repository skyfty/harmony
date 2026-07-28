<script setup lang="ts">
import { computed } from 'vue'
import type { RestoreCameraBehaviorParams } from '@schema/core'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: RestoreCameraBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: RestoreCameraBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const params = computed<RestoreCameraBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
}))

function emitUpdate(patch: Partial<RestoreCameraBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}
</script>

<template>
  <div class="restore-camera-params">
    <NodePicker
      :model-value="params.targetNodeId"
      label="Controlled node"
      pick-hint="Select the character or vehicle node whose camera offset should be restored"
      placeholder="Controlled node"
      selection-hint="Click a node in the scene to restore its follow camera offset."
      @update:model-value="(value) => emitUpdate({ targetNodeId: value })"
      @pick-state-change="(active) => emit('pick-state-change', active)"
    />
  </div>
</template>

<style scoped>
.restore-camera-params {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
</style>