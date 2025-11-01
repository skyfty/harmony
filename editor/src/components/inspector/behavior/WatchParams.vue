<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNode, WatchBehaviorParams } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'

const props = defineProps<{
  modelValue: WatchBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: WatchBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const { nodes } = storeToRefs(sceneStore)
const nodePickerStore = useNodePickerStore()

const params = computed<WatchBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
}))

const isPicking = ref(false)
let activeRequestId: number | null = null

function findNodeName(nodes: SceneNode[] | undefined, id: string | null): string | null {
  if (!nodes || !id) {
    return null
  }
  for (const node of nodes) {
    if (node.id === id) {
      return node.name ?? node.id
    }
    const child = findNodeName(node.children, id)
    if (child) {
      return child
    }
  }
  return null
}

const targetNodeName = computed(() => findNodeName(nodes.value, params.value.targetNodeId))

function updateParams(next: WatchBehaviorParams) {
  emit('update:modelValue', next)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelPicking()
  }
}

function handlePointerDown(event: PointerEvent) {
  if (event.button === 2) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    cancelPicking()
  }
}

function startPicking() {
  if (isPicking.value) {
    return
  }
  isPicking.value = true
  emit('pick-state-change', true)
  activeRequestId = nodePickerStore.beginPick({
    owner: 'behavior-target',
    hint: 'Select a node to watch',
    handlers: {
      onPick(nodeId: string) {
        activeRequestId = null
        stopPicking()
        updateParams({ targetNodeId: nodeId })
      },
      onCancel() {
        activeRequestId = null
        stopPicking()
      },
    },
  })
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('pointerdown', handlePointerDown, true)
}

function cancelPicking() {
  if (!isPicking.value) {
    return
  }
  if (activeRequestId && nodePickerStore.activeRequestId === activeRequestId) {
    nodePickerStore.cancelActivePick('user')
  } else {
    stopPicking()
  }
}

function stopPicking() {
  if (!isPicking.value) {
    return
  }
  isPicking.value = false
  emit('pick-state-change', false)
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('pointerdown', handlePointerDown, true)
}

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  if (isPicking.value) {
    cancelPicking()
  }
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('pointerdown', handlePointerDown, true)
})

function clearTarget() {
  updateParams({ targetNodeId: null })
}
</script>

<template>
  <div class="watch-params">
    <div class="watch-params__row">
      <div class="watch-params__target">
      <v-btn
        class="watch-params__icon-button"
        size="small"
        variant="text"
        icon="mdi-crosshairs-gps"
        :loading="isPicking"
        @click="startPicking"
      />
        <span v-if="params.targetNodeId" class="watch-params__value">
          {{ targetNodeName ?? params.targetNodeId }}
        </span>
        <span v-else class="watch-params__placeholder">未选择节点</span>
      <v-btn
        class="watch-params__icon-button"
        size="small"
        variant="text"
        icon="mdi-close"
        :disabled="!params.targetNodeId"
        @click="clearTarget"
        style="margin-left: auto"
      />
    
      </div>
    </div>
    <div v-if="isPicking" class="watch-params__hint">
      点击场景中的节点进行选择，显示在左侧，右侧显示清除按钮。
    </div>
  </div>
</template>

<style scoped>
.watch-params {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.watch-params__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.watch-params__value {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.92);
}

.watch-params__placeholder {
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.5);
}

.watch-params__target {
  flex: 1;
  min-height: 32px;
  display: flex;
  align-items: center;
  padding: 0 0.4rem;
  border-radius: 6px;
  background: rgba(233, 236, 241, 0.06);
}

.watch-params__icon-button {
  color: rgba(233, 236, 241, 0.82);
}

.watch-params__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
