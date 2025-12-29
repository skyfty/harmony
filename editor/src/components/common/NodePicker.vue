<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNode } from '@harmony/schema'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
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
const { nodes, hierarchyItems } = storeToRefs(sceneStore)
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

function buildHierarchyNameMap(items: HierarchyTreeItem[] | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!items?.length) {
    return map
  }
  const stack: HierarchyTreeItem[] = [...items]
  while (stack.length) {
    const item = stack.pop()
    if (!item) {
      continue
    }
    const trimmedName = typeof item.name === 'string' ? item.name.trim() : ''
    if (trimmedName.length) {
      map.set(item.id, trimmedName)
    }
    if (item.children?.length) {
      stack.push(...item.children)
    }
  }
  return map
}

const hierarchyNameMap = computed(() => buildHierarchyNameMap(hierarchyItems.value))

function resolveNodeName(id: string | null | undefined): string | null {
  if (!id) {
    return null
  }
  const hierarchyName = hierarchyNameMap.value.get(id)
  if (hierarchyName && hierarchyName.trim().length) {
    return hierarchyName
  }
  return findNodeName(nodes.value, id)
}

const hasSelection = computed(() => props.modelValue !== null && props.modelValue !== undefined)

const selectedNodeName = computed(() => resolveNodeName(props.modelValue ?? null))

const selectionHintText = computed(() => props.selectionHint?.trim() ?? '')

const placeholderText = computed(() => {
  const text = props.placeholder?.trim()
  return text && text.length ? text : '未选择节点'
})
const isDisabled = computed(() => props.disabled)

const displayValue = computed(() => selectedNodeName.value ?? props.modelValue ?? null)

function extractDraggedNodeId(event: DragEvent): string | null {
  const transfer = event.dataTransfer
  if (!transfer) {
    return null
  }
  const candidateTypes: string[] = ['application/x-harmony-node', 'application/x-harmony-node-list', 'text/plain']
  for (const type of candidateTypes) {
    const value = transfer.getData(type)
    if (typeof value !== 'string' || !value.trim().length) {
      continue
    }
    if (type === 'application/x-harmony-node-list') {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
          const firstId = parsed.find((entry) => typeof entry === 'string' && entry.trim().length)
          if (typeof firstId === 'string') {
            return firstId.trim()
          }
        }
      } catch (error) {
        console.warn('Failed to parse node drag payload', error)
      }
      continue
    }
    return value.trim()
  }
  return null
}

function canAcceptNodeDrag(event: DragEvent): boolean {
  if (!event.dataTransfer) {
    return false
  }
  const types = Array.from(event.dataTransfer.types ?? [])
  if (types.includes('application/x-harmony-node')) {
    return true
  }
  if (types.includes('application/x-harmony-node-list')) {
    return true
  }
  if (types.includes('text/plain')) {
    return true
  }
  return false
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
  if (!canAcceptNodeDrag(event)) {
    isDragHovering.value = false
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    // Match the effect allowed by hierarchy drags so the drop is accepted by the browser
    event.dataTransfer.dropEffect = 'move'
  }
  isDragHovering.value = true
}

function handleDragOver(event: DragEvent) {
  if (isDisabled.value) {
    return
  }
  if (!canAcceptNodeDrag(event)) {
    isDragHovering.value = false
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    // Align with the allowed effect to ensure the drop event fires
    event.dataTransfer.dropEffect = 'move'
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
  event.preventDefault()
  const nodeId = extractDraggedNodeId(event)
  isDragHovering.value = false
  if (!nodeId) {
    return
  }
  const nodeExists = hierarchyNameMap.value.has(nodeId) || Boolean(findNodeName(nodes.value, nodeId))
  if (!nodeExists) {
    return
  }
  if (isPicking.value) {
    cancelPicking()
  }
  updateValue(nodeId)
}

function handleValueClick() {
  if (isDisabled.value) {
    return
  }
  const nodeId = props.modelValue
  if (!nodeId) {
    return
  }
  const exists = Boolean(findNodeName(nodes.value, nodeId))
  if (!exists) {
    return
  }
  sceneStore.requestNodeHighlight(nodeId)
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
      <span
        v-if="hasSelection"
        class="node-picker__value"
        :class="{ 'node-picker__value--interactive': !isDisabled }"
        @click="handleValueClick"
      >
        {{ displayValue }}
      </span>
      <span v-else class="node-picker__placeholder">{{ placeholderText }}</span>
      <span v-if="!hasSelection" class="node-picker__spacer" />
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
  margin-left: 0.3rem;
}

.node-picker__value {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.92);
}

.node-picker__value--interactive {
  cursor: pointer;
}

.node-picker__value--interactive:hover {
  color: rgba(255, 255, 255, 0.95);
}

.node-picker__placeholder {
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.5);
}

.node-picker__placeholder--suffix {
  font-size: 0.85rem;
  color: rgba(233, 236, 241, 0.35);
  margin-left: auto;
  white-space: nowrap;
}

.node-picker__spacer {
  flex: 1 1 auto;
}

.node-picker__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
