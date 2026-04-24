<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import type { ControlCharacterBehaviorParams } from '@schema'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: ControlCharacterBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: ControlCharacterBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

type NodePickerHandle = { cancelPicking: () => void }

const pickerRefs = new Map<string, NodePickerHandle>()
const activePickerKeys = new Set<string>()

const params = computed<ControlCharacterBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
}))

function emitUpdate(patch: Partial<ControlCharacterBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}

function updateTarget(nodeId: string | null) {
  emitUpdate({ targetNodeId: nodeId })
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
      :ref="registerPicker('character')"
      :model-value="params.targetNodeId"
      label="Character node"
      pick-hint="Choose the node that should receive character movement control"
      placeholder="Character node"
      selection-hint="Click a node in the scene to set the controlled character."
      @update:model-value="updateTarget"
      @pick-state-change="(active) => handlePickStateChange('character', active)"
    />
  </div>
</template>
