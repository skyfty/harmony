<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { DriveBehaviorParams } from '@harmony/schema'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: DriveBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: DriveBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const pickerRef = ref<{ cancelPicking: () => void } | null>(null)

const params = computed<DriveBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
}))

function emitUpdate(patch: Partial<DriveBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
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
  <div class="drive-params">
    <NodePicker
      ref="pickerRef"
      :model-value="params.targetNodeId"
      label="Vehicle node"
      pick-hint="Choose the node that owns the vehicle to drive"
      placeholder="Defaults to the current node"
      selection-hint="Click a node in the scene to set the vehicle target."
      @update:modelValue="updateTarget"
      @pick-state-change="handlePickStateChange"
    />
    <v-alert
      type="info"
      density="comfortable"
      variant="tonal"
      class="drive-params__hint"
    >
      目标节点必须同时具备 Rigidbody 和 Vehicle 组件，才能在预览中创建 RaycastVehicle 并响应驾驶控制。执行脚本后会自动绑定相机并显示驾驶控制面板，用于操纵车辆的运动。
    </v-alert>
  </div>
</template>

<style scoped>
.drive-params {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.drive-params__hint {
  font-size: 0.85rem;
  line-height: 1.4;
}
</style>
