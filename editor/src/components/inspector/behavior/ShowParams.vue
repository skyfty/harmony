<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNode, ShowBehaviorParams } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'

const props = defineProps<{
  modelValue: ShowBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: ShowBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const { nodes } = storeToRefs(sceneStore)
const nodePickerStore = useNodePickerStore()

const params = computed<ShowBehaviorParams>(() => ({
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

function updateParams(next: ShowBehaviorParams) {
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
    hint: 'Select a node to show',
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

function clearTarget() {
  updateParams({ targetNodeId: null })
}

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  if (isPicking.value) {
    cancelPicking()
  }
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('pointerdown', handlePointerDown, true)
})
</script>

<template>
  <div class="visibility-params">
    <div class="visibility-params__status">
      <span class="visibility-params__label">Node To Show</span>
      <span v-if="params.targetNodeId" class="visibility-params__value">
        {{ targetNodeName ?? params.targetNodeId }}
      </span>
      <span v-else class="visibility-params__placeholder">Defaults to this behavior's node</span>
    </div>
    <div class="visibility-params__actions">
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-crosshairs-gps"
        :loading="isPicking"
        @click="startPicking"
      >
        Pick From Scene
      </v-btn>
      <v-btn
        size="small"
        color="secondary"
        variant="text"
        :disabled="!params.targetNodeId"
        @click="clearTarget"
      >
        Clear
      </v-btn>
    </div>
    <div v-if="isPicking" class="visibility-params__hint">
      Click a node in the scene or right-click / press Esc to cancel.
    </div>
  </div>
</template>

<style scoped>
.visibility-params {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.visibility-params__status {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.visibility-params__label {
  font-size: 0.78rem;
  color: rgba(233, 236, 241, 0.65);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.visibility-params__value {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.92);
}

.visibility-params__placeholder {
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.5);
}

.visibility-params__actions {
  display: flex;
  gap: 0.5rem;
}

.visibility-params__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
