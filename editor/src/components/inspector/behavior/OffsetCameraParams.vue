<script setup lang="ts">
import { computed } from 'vue'
import type { OffsetCameraBehaviorParams } from '@schema/core'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: OffsetCameraBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: OffsetCameraBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const params = computed<OffsetCameraBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  cameraFollowDistance: props.modelValue?.cameraFollowDistance ?? 4.2,
  cameraFollowHeight: props.modelValue?.cameraFollowHeight ?? 3.2,
}))

function emitUpdate(patch: Partial<OffsetCameraBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}
</script>

<template>
  <div class="offset-camera-params">
    <NodePicker
      :model-value="params.targetNodeId"
      label="Controlled node"
      pick-hint="Select the character or vehicle node that should use the temporary camera offset"
      placeholder="Controlled node"
      selection-hint="Click a node in the scene to set the camera target."
      @update:model-value="(value) => emitUpdate({ targetNodeId: value })"
      @pick-state-change="(active) => emit('pick-state-change', active)"
    />
    <div class="offset-camera-params__grid">
      <v-text-field
        :model-value="params.cameraFollowDistance"
        type="number"
        step="0.1"
        variant="underlined"
        label="Follow distance"
        density="compact"
        hide-details
        @update:model-value="(value) => emitUpdate({ cameraFollowDistance: Number(value) })"
      />
      <v-text-field
        :model-value="params.cameraFollowHeight"
        type="number"
        step="0.1"
        variant="underlined"
        label="Follow height"
        density="compact"
        hide-details
        @update:model-value="(value) => emitUpdate({ cameraFollowHeight: Number(value) })"
      />
    </div>
  </div>
</template>

<style scoped>
.offset-camera-params {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.offset-camera-params__grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
</style>