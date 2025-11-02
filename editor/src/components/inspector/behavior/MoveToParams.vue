<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { MoveToBehaviorParams, MoveToFacingDirection, SceneNode } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'

const props = defineProps<{
  modelValue: MoveToBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: MoveToBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const nodePickerStore = useNodePickerStore()
const { nodes } = storeToRefs(sceneStore)

const FACING_OPTIONS: Array<{ label: string; value: MoveToFacingDirection }> = [
  { label: 'Front', value: 'front' },
  { label: 'Back', value: 'back' },
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
]

const params = computed<MoveToBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  speed: Math.max(0, props.modelValue?.speed ?? 10),
  facing: props.modelValue?.facing ?? 'front',
  offset: Math.max(0, props.modelValue?.offset ?? 1),
}))

const isPicking = ref(false)
let activeRequestId: number | null = null

function findNodeName(tree: SceneNode[] | undefined, id: string | null): string | null {
  if (!tree || !id) {
    return null
  }
  for (const node of tree) {
    if (node.id === id) {
      return node.name?.trim().length ? node.name : node.id
    }
    const match = findNodeName(node.children, id)
    if (match) {
      return match
    }
  }
  return null
}

const targetNodeName = computed(() => findNodeName(nodes.value, params.value.targetNodeId))

function emitUpdate(patch: Partial<MoveToBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}

function updateSpeed(value: string | number) {
  const numeric = typeof value === 'number' ? value : parseFloat(value)
  const normalized = Number.isFinite(numeric) ? Math.max(0, numeric) : 0
  emitUpdate({ speed: normalized })
}

function updateOffset(value: string | number) {
  const numeric = typeof value === 'number' ? value : parseFloat(value)
  const normalized = Number.isFinite(numeric) ? Math.max(0, numeric) : 0
  emitUpdate({ offset: normalized })
}

function updateFacing(value: MoveToFacingDirection) {
  emitUpdate({ facing: value })
}

function updateTarget(nodeId: string | null) {
  emitUpdate({ targetNodeId: nodeId })
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
    hint: 'Select the node to move to',
    handlers: {
      onPick(nodeId: string) {
        activeRequestId = null
        stopPicking()
        updateTarget(nodeId)
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
  updateTarget(null)
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
  <div class="move-to-params">
    <div class="move-to-params__row">
      <div class="move-to-params__target">
        <v-btn
          class="move-to-params__icon-button"
          size="small"
          variant="text"
          icon="mdi-crosshairs-gps"
          :loading="isPicking"
          @click="startPicking"
        />
        <span v-if="params.targetNodeId" class="move-to-params__value">
          {{ targetNodeName ?? params.targetNodeId }}
        </span>
        <span v-else class="move-to-params__placeholder">No node selected</span>
        <v-btn
          class="move-to-params__icon-button move-to-params__icon-button--clear"
          size="small"
          variant="text"
          icon="mdi-close"
          :disabled="!params.targetNodeId"
          @click="clearTarget"
        />
      </div>
    </div>
    <div v-if="isPicking" class="move-to-params__hint">
      Click a node in the scene to select it. The selection appears on the left; a clear button appears on the right.
    </div>
    <v-text-field
      :model-value="params.speed"
      type="number"
      label="Movement speed (m/s)"
      density="compact"
      variant="underlined"
      hide-details
      min="0"
      step="0.1"
      @update:model-value="updateSpeed($event)"
    />
    <v-select
      :model-value="params.facing"
      :items="FACING_OPTIONS"
      item-title="label"
      item-value="value"
      label="Facing direction"
      density="compact"
      variant="underlined"
      hide-details
      @update:model-value="updateFacing($event as MoveToFacingDirection)"
    />
    <v-text-field
      :model-value="params.offset"
      type="number"
      label="Offset distance (m)"
      density="compact"
      variant="underlined"
      hide-details
      min="0"
      step="0.1"
      @update:model-value="updateOffset($event)"
    />
  </div>
</template>

<style scoped>
.move-to-params {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}

.move-to-params__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.move-to-params__target {
  flex: 1;
  min-height: 32px;
  display: flex;
  align-items: center;
  padding: 0 0.4rem;
  border-radius: 6px;
  background: rgba(233, 236, 241, 0.06);
}

.move-to-params__icon-button {
  color: rgba(233, 236, 241, 0.82);
}

.move-to-params__icon-button--clear {
  margin-left: auto;
}

.move-to-params__value {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.92);
}

.move-to-params__placeholder {
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.5);
}

.move-to-params__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
