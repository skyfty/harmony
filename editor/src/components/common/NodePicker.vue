<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNode } from '@harmony/schema'
import type { NodePickerOwner } from '@/stores/nodePickerStore'
import { useSceneStore } from '@/stores/sceneStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'

type ExposedMethods = {
  cancelPicking: () => void
}

const props = withDefaults(
  defineProps<{
    modelValue: string | null | undefined
    owner?: NodePickerOwner
    pickHint?: string
    selectionHint?: string
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    owner: 'behavior-target',
    pickHint: 'Select a node',
    selectionHint: '',
    placeholder: '未选择节点',
    disabled: false,
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | null): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const { nodes } = storeToRefs(sceneStore)
const nodePickerStore = useNodePickerStore()

const isPicking = ref(false)
const activeRequestId = ref<number | null>(null)
const isDragHovering = ref(false)

function findNodeName(tree: SceneNode[] | undefined, id: string | null | undefined): string | null {
  if (!tree || !id) {
    return null
  }
  for (const node of tree) {
    if (node.id === id) {
      const name = node.name?.trim()
      return name && name.length ? name : node.id
    }
    const match = findNodeName(node.children, id)
    if (match) {
      return match
    }
  }
  return null
}

const hasSelection = computed(() => props.modelValue !== null && props.modelValue !== undefined)

const selectedNodeName = computed(() => findNodeName(nodes.value, props.modelValue ?? null))

const selectionHintText = computed(() => props.selectionHint?.trim() ?? '')

const placeholderText = computed(() => props.placeholder)
const isDisabled = computed(() => props.disabled)

const displayValue = computed(() => selectedNodeName.value ?? props.modelValue ?? null)

function resolveDraggedNodeId(event: DragEvent): string | null {
  const transfer = event.dataTransfer
  if (!transfer) {
    return null
  }
  const plain = transfer.getData('text/plain')
  if (plain && findNodeName(nodes.value, plain)) {
    return plain
  }
  return null
}

function updateValue(next: string | null) {
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
    event.stopImmediatePropagation?.()
    cancelPicking()
  }
}

function addGlobalListeners() {
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('pointerdown', handlePointerDown, true)
}

function removeGlobalListeners() {
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('pointerdown', handlePointerDown, true)
}

function startPicking() {
  if (isPicking.value || isDisabled.value) {
    return
  }
  isPicking.value = true
  emit('pick-state-change', true)
  activeRequestId.value = nodePickerStore.beginPick({
    owner: props.owner,
    hint: props.pickHint,
    handlers: {
      onPick(nodeId: string) {
        activeRequestId.value = null
        stopPicking()
        updateValue(nodeId)
      },
      onCancel() {
        activeRequestId.value = null
        stopPicking()
      },
    },
  })
  addGlobalListeners()
}

function stopPicking() {
  if (!isPicking.value) {
    return
  }
  activeRequestId.value = null
  isPicking.value = false
  emit('pick-state-change', false)
  removeGlobalListeners()
}

function cancelPicking() {
  if (!isPicking.value) {
    return
  }
  if (activeRequestId.value && nodePickerStore.activeRequestId === activeRequestId.value) {
    nodePickerStore.cancelActivePick('user')
  } else {
    stopPicking()
  }
}

function clearSelection() {
  updateValue(null)
}

function handleDragEnter(event: DragEvent) {
  if (isDisabled.value) {
    return
  }
  const nodeId = resolveDraggedNodeId(event)
  if (!nodeId) {
    isDragHovering.value = false
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'link'
  }
  isDragHovering.value = true
}

function handleDragOver(event: DragEvent) {
  if (isDisabled.value) {
    return
  }
  const nodeId = resolveDraggedNodeId(event)
  if (!nodeId) {
    isDragHovering.value = false
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'link'
  }
  isDragHovering.value = true
}

function handleDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  isDragHovering.value = false
}

function handleDrop(event: DragEvent) {
  if (isDisabled.value) {
    return
  }
  const nodeId = resolveDraggedNodeId(event)
  isDragHovering.value = false
  if (!nodeId) {
    return
  }
  event.preventDefault()
  if (isPicking.value) {
    cancelPicking()
  }
  updateValue(nodeId)
}

const exposed: ExposedMethods = {
  cancelPicking,
}

defineExpose(exposed)

onBeforeUnmount(() => {
  if (isPicking.value) {
    cancelPicking()
  }
  removeGlobalListeners()
})
</script>

<template>
  <div class="node-picker">
    <div
      class="node-picker__target"
      :class="{ 'node-picker__target--hover': isDragHovering }"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <v-btn
        class="node-picker__icon-button"
        size="small"
        variant="text"
        icon="mdi-crosshairs-gps"
        :loading="isPicking"
        :disabled="isDisabled"
        @click="startPicking"
      />
      <span v-if="hasSelection" class="node-picker__value">
        {{ displayValue }}
      </span>
      <span v-else class="node-picker__placeholder">{{ placeholderText }}</span>
      <v-btn
        class="node-picker__icon-button node-picker__icon-button--clear"
        size="small"
        variant="text"
        icon="mdi-close"
        :disabled="!hasSelection || isDisabled"
        @click="clearSelection"
      />
    </div>
    <div v-if="isPicking && selectionHintText" class="node-picker__hint">
      {{ selectionHintText }}
    </div>
  </div>
</template>

<style scoped>
.node-picker {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.node-picker__target {
  flex: 1;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.4rem;
  border-radius: 6px;
  background: rgba(233, 236, 241, 0.06);
}

.node-picker__target--hover {
  border: 1px dashed rgba(77, 208, 225, 0.8);
  background: rgba(77, 208, 225, 0.12);
}

.node-picker__icon-button {
  color: rgba(233, 236, 241, 0.82);
}

.node-picker__icon-button--clear {
  margin-left: auto;
}

.node-picker__value {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.92);
}

.node-picker__placeholder {
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.5);
}

.node-picker__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
