<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import type { DriveBehaviorParams } from '@harmony/schema'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: DriveBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: DriveBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

type NodePickerHandle = { cancelPicking: () => void }

const pickerRefs = new Map<string, NodePickerHandle>()
const activePickerKeys = new Set<string>()

const params = computed<DriveBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  seatNodeId: props.modelValue?.seatNodeId ?? null,
  forwardDirectionNodeId: props.modelValue?.forwardDirectionNodeId ?? null,
  exitNodeId: props.modelValue?.exitNodeId ?? null,
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

function updateSeat(nodeId: string | null) {
  emitUpdate({ seatNodeId: nodeId })
}

function updateForwardDirection(nodeId: string | null) {
  emitUpdate({ forwardDirectionNodeId: nodeId })
}

function updateExit(nodeId: string | null) {
  emitUpdate({ exitNodeId: nodeId })
}

function registerPicker(key: string) {
  return (instance: unknown) => {
    if (instance && typeof (instance as NodePickerHandle).cancelPicking === 'function') {
      pickerRefs.set(key, instance as NodePickerHandle)
      return
    }
    pickerRefs.delete(key)
    if (activePickerKeys.delete(key)) {
      emit('pick-state-change', activePickerKeys.size > 0)
    }
  }
}

function handlePickStateChange(key: string, active: boolean) {
  if (active) {
    activePickerKeys.add(key)
  } else {
    activePickerKeys.delete(key)
  }
  emit('pick-state-change', activePickerKeys.size > 0)
}

function cancelPicking() {
  pickerRefs.forEach((picker) => {
    picker.cancelPicking()
  })
  if (activePickerKeys.size) {
    activePickerKeys.clear()
    emit('pick-state-change', false)
  }
}

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  cancelPicking()
})
</script>

<template>
  <div class="drive-params">
    <NodePicker
      :ref="registerPicker('vehicle')"
      :model-value="params.targetNodeId"
      label="Vehicle node"
      pick-hint="Choose the node that owns the vehicle to drive"
      placeholder="Vehicle node"
      selection-hint="Click a node in the scene to set the vehicle target."
      @update:model-value="updateTarget"
      @pick-state-change="(active) => handlePickStateChange('vehicle', active)"
    />
    <NodePicker
      :ref="registerPicker('seat')"
      :model-value="params.seatNodeId"
      label="Seat node"
      placeholder="Seat node"
      pick-hint="Choose the node representing the seat or camera anchor"
      selection-hint="Click a node that marks where the driver should sit."
      @update:model-value="updateSeat"
      @pick-state-change="(active) => handlePickStateChange('seat', active)"
    />
    <NodePicker
      :ref="registerPicker('forward')"
      :model-value="params.forwardDirectionNodeId"
      label="Forward direction node"
      pick-hint="Choose a node that indicates the vehicle's forward direction"
      placeholder="Forward orientation node"
      selection-hint="Click a node that defines forward orientation for the vehicle."
      @update:model-value="updateForwardDirection"
      @pick-state-change="(active) => handlePickStateChange('forward', active)"
    />
    <NodePicker
      :ref="registerPicker('exit')"
      :model-value="params.exitNodeId"
      label="Exit position node"
      pick-hint="Choose a node representing where passengers exit the vehicle"
      placeholder="Exit position node"
      selection-hint="Click a node that marks the disembark location."
      @update:model-value="updateExit"
      @pick-state-change="(active) => handlePickStateChange('exit', active)"
    />
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
