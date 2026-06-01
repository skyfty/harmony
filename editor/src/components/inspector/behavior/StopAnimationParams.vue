<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { StopAnimationBehaviorParams } from '@schema/core'
import { ANIMATION_COMPONENT_TYPE } from '@schema/components'
import NodePicker from '@/components/common/NodePicker.vue'
import { useSceneStore } from '@/stores/sceneStore'
import { findSceneNodeById } from '@/utils/animationClipCatalog'

const props = defineProps<{
  modelValue: StopAnimationBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: StopAnimationBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const { nodes } = storeToRefs(sceneStore)
const pickerRef = ref<{ cancelPicking: () => void } | null>(null)

const params = computed<StopAnimationBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
}))

const targetNodeHasAnimationComponent = computed(() => {
  const node = findSceneNodeById(nodes.value, params.value.targetNodeId)
  return Boolean(node?.components?.[ANIMATION_COMPONENT_TYPE])
})

function updateTarget(nodeId: string | null) {
  emit('update:modelValue', {
    targetNodeId: nodeId,
  })
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
  <div class="stop-animation-params">
    <NodePicker
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select the node whose Animation component should be stopped"
      placeholder="No node selected"
      selection-hint="The selected node must contain an Animation component."
      @update:modelValue="updateTarget"
      @pick-state-change="handlePickStateChange"
    />
    <div
      v-if="params.targetNodeId && !targetNodeHasAnimationComponent"
      class="stop-animation-params__message stop-animation-params__message--error"
    >
      Selected node must contain an Animation component.
    </div>
  </div>
</template>

<style scoped>
.stop-animation-params {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.stop-animation-params__message {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}

.stop-animation-params__message--error {
  color: #ff8a80;
}
</style>
