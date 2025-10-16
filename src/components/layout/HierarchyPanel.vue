<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore, type HierarchyDropPosition } from '@/stores/sceneStore'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
import { getNodeIcon } from '@/types/node-icons'
import AddNodeMenu from '../common/AddNodeMenu.vue'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()

const sceneStore = useSceneStore()
const { hierarchyItems, selectedNodeId, selectedNodeIds } = storeToRefs(sceneStore)

const opened = ref<string[]>([])
const selectionAnchorId = ref<string | null>(null)
const suppressSelectionSync = ref(false)
const dragState = ref<{ sourceId: string | null; targetId: string | null; position: HierarchyDropPosition | null }>(
  {
    sourceId: null,
    targetId: null,
    position: null,
  },
)
const panelRef = ref<HTMLDivElement | null>(null)


const active = computed({
  get: () => (selectedNodeId.value ? [selectedNodeId.value] : []),
  set: (ids: string[]) => {
    const nextId = ids[0] ?? null
    if (nextId !== selectedNodeId.value) {
      sceneStore.selectNode(nextId)
    }
  },
})

watch(
  hierarchyItems,
  (items) => {
    opened.value = expandAll(items)
  },
  { immediate: true },
)

const flattenedHierarchyItems = computed(() => flattenHierarchyItems(hierarchyItems.value))
const allNodeIds = computed(() => flattenedHierarchyItems.value.map((item) => item.id))
const hasSelection = computed(() => selectedNodeIds.value.length > 0)
const hasHierarchyNodes = computed(() => flattenedHierarchyItems.value.length > 0)
const areAllNodesVisible = computed(() => flattenedHierarchyItems.value.every((item) => item.visible))
const anyNodeHidden = computed(() => flattenedHierarchyItems.value.some((item) => !item.visible))
const visibilityToggleIcon = computed(() => (areAllNodesVisible.value ? 'mdi-eye-off-outline' : 'mdi-eye-outline'))
const visibilityToggleTitle = computed(() => (areAllNodesVisible.value ? '隐藏所有节点' : '显示所有节点'))
const anyNodeLocked = computed(() => flattenedHierarchyItems.value.some((item) => item.locked))
const areAllNodesLocked = computed(
  () => hasHierarchyNodes.value && flattenedHierarchyItems.value.every((item) => item.locked),
)
const lockToggleIcon = computed(() => (areAllNodesLocked.value ? 'mdi-lock-open-variant-outline' : 'mdi-lock-outline'))
const lockToggleTitle = computed(() => (areAllNodesLocked.value ? '解除全部锁定' : '锁定全部节点'))

watch(allNodeIds, (ids) => {
  if (selectionAnchorId.value && !ids.includes(selectionAnchorId.value)) {
    selectionAnchorId.value = selectedNodeIds.value[selectedNodeIds.value.length - 1] ?? null
  }
})

watch(
  selectedNodeIds,
  (ids) => {
    if (suppressSelectionSync.value) {
      suppressSelectionSync.value = false
    }
    if (ids.length === 0) {
      selectionAnchorId.value = null
      return
    }
    if (!selectionAnchorId.value || !ids.includes(selectionAnchorId.value)) {
      selectionAnchorId.value = ids[ids.length - 1] ?? null
    }
  },
  { immediate: true, deep: true },
)

const rootDropClasses = computed(() => ({
  'root-drop-active':
    dragState.value.sourceId !== null &&
    dragState.value.targetId === null &&
    dragState.value.position !== null,
  'root-drop-before':
    dragState.value.sourceId !== null &&
    dragState.value.targetId === null &&
    dragState.value.position === 'before',
  'root-drop-after':
    dragState.value.sourceId !== null &&
    dragState.value.targetId === null &&
    dragState.value.position === 'after',
}))

function expandAll(items: HierarchyTreeItem[]): string[] {
  const collected: string[] = []
  for (const item of items) {
    collected.push(item.id)
    if (Array.isArray(item.children) && item.children.length) {
      collected.push(...expandAll(item.children))
    }
  }
  return collected
}

function flattenHierarchyItems(items: HierarchyTreeItem[]): HierarchyTreeItem[] {
  const result: HierarchyTreeItem[] = []
  for (const item of items) {
    result.push(item)
    if (Array.isArray(item.children) && item.children.length) {
      result.push(...flattenHierarchyItems(item.children))
    }
  }
  return result
}

function isItemSelected(id: string) {
  return selectedNodeIds.value.includes(id)
}

function isItemActive(id: string) {
  return selectedNodeId.value === id
}

function toggleNodeVisibility(id: string) {
  sceneStore.toggleNodeVisibility(id)
}

function toggleNodeSelectionLock(id: string) {
  sceneStore.toggleNodeSelectionLock(id)
}

function isNodeSelectionLocked(id: string) {
  return sceneStore.isNodeSelectionLocked(id)
}

function setActiveNode(id: string | null) {
  selectionAnchorId.value = id
  suppressSelectionSync.value = true
  sceneStore.selectNode(id)
}

function handleDeleteSelected() {
  if (!selectedNodeIds.value.length) return
  const idsToRemove = [...selectedNodeIds.value]
  sceneStore.removeSceneNodes(idsToRemove)
  selectionAnchorId.value = selectedNodeIds.value[selectedNodeIds.value.length - 1] ?? null
}

function handleToggleAllVisibility() {
  const nextVisible = !areAllNodesVisible.value
  sceneStore.setAllNodesVisibility(nextVisible)
}

function handleToggleAllSelectionLock() {
  const nextLocked = !areAllNodesLocked.value
  sceneStore.setAllNodesSelectionLock(nextLocked)
}

function getNodeInteractionClasses(id: string) {
  return {
    ...getNodeDropClasses(id),
    'is-selected': isItemSelected(id),
    'is-active': isItemActive(id),
    'is-locked': isNodeSelectionLocked(id),
  }
}

function resolveNodeIcon(item: HierarchyTreeItem) {
  return getNodeIcon({
    nodeType: item.nodeType,
    lightType: item.lightType,
    hasChildren: Boolean(item.children?.length),
  })
}

function handleNodeClick(event: MouseEvent, nodeId: string) {
  event.stopPropagation()
  event.preventDefault()
  if (event.button !== 0) return

  const isToggle = event.ctrlKey || event.metaKey
  const isRangeSelect = event.shiftKey && selectionAnchorId.value
  const currentlySelected = isItemSelected(nodeId)

  const currentSelection = [...selectedNodeIds.value]
  let nextSelection: string[] = currentSelection

  if (isRangeSelect) {
    const anchorId = selectionAnchorId.value
    const anchorIndex = anchorId ? allNodeIds.value.indexOf(anchorId) : -1
    const targetIndex = allNodeIds.value.indexOf(nodeId)
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
      const rangeIds = allNodeIds.value.slice(start, end + 1)
      const base = isToggle ? currentSelection : []
      nextSelection = Array.from(new Set([...base, ...rangeIds]))
    } else {
      nextSelection = [nodeId]
    }
  } else if (isToggle) {
    nextSelection = currentlySelected
      ? currentSelection.filter((id) => id !== nodeId)
      : [...currentSelection, nodeId]
  } else {
    if (currentSelection.length !== 1 || !currentlySelected) {
      nextSelection = [nodeId]
    }
  }

  if (!nextSelection.length) {
    suppressSelectionSync.value = true
    sceneStore.clearSelection()
    selectionAnchorId.value = null
    return
  }

  suppressSelectionSync.value = true
  sceneStore.setSelection(nextSelection)
  selectionAnchorId.value = nextSelection[nextSelection.length - 1] ?? null
}

function resetDragState() {
  dragState.value = { sourceId: null, targetId: null, position: null }
}

function resolveDropPosition(event: DragEvent): HierarchyDropPosition {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return 'inside'
  const rect = target.getBoundingClientRect()
  if (rect.height === 0) return 'inside'
  const offset = event.clientY - rect.top
  const ratio = offset / rect.height
  if (ratio < 0.25) return 'before'
  if (ratio > 0.75) return 'after'
  return 'inside'
}

function getNodeDropClasses(id: string) {
  if (dragState.value.targetId !== id) return {}
  if (!dragState.value.position) {
    return { 'drop-disabled': true }
  }
  return {
    'drop-before': dragState.value.position === 'before',
    'drop-after': dragState.value.position === 'after',
    'drop-inside': dragState.value.position === 'inside',
  }
}

function handleDragStart(event: DragEvent, nodeId: string) {
  dragState.value = { sourceId: nodeId, targetId: null, position: null }
  event.dataTransfer?.setData('text/plain', nodeId)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function handleDragEnd() {
  resetDragState()
}

function handleDragOver(event: DragEvent, targetId: string) {
  const sourceId = dragState.value.sourceId
  if (!sourceId || targetId === sourceId) return

  const isInvalid = sceneStore.isDescendant(sourceId, targetId)
  if (isInvalid) {
    dragState.value = { sourceId, targetId, position: null }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none'
    }
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const position = resolveDropPosition(event)
  dragState.value = { sourceId, targetId, position }
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleDragLeave(event: DragEvent, targetId: string) {
  if (!dragState.value.sourceId) return
  const related = event.relatedTarget as Node | null
  const current = event.currentTarget as HTMLElement | null
  if (current && related && current.contains(related)) return
  if (dragState.value.targetId === targetId) {
    dragState.value = { ...dragState.value, targetId: null, position: null }
  }
}

function handleDrop(event: DragEvent, targetId: string) {
  const { sourceId, position } = dragState.value
  if (!sourceId || !position) {
    resetDragState()
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const moved = sceneStore.moveNode({ nodeId: sourceId, targetId, position })
  if (moved && position === 'inside' && !opened.value.includes(targetId)) {
    opened.value = [...opened.value, targetId]
  }
  resetDragState()
}

function handleNodeDoubleClick(nodeId: string) {
  setActiveNode(nodeId)
  sceneStore.requestCameraFocus(nodeId)
}

function handleTreeDragOver(event: DragEvent) {
  const { sourceId } = dragState.value
  if (!sourceId) return
  const container = event.currentTarget as HTMLElement | null
  if (!container) return
  const rect = container.getBoundingClientRect()
  const offset = event.clientY - rect.top
  const position: HierarchyDropPosition = offset < rect.height / 2 ? 'before' : 'after'
  dragState.value = { sourceId, targetId: null, position }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleTreeDrop(event: DragEvent) {
  const { sourceId, position } = dragState.value
  if (!sourceId || !position) {
    event.preventDefault()
    resetDragState()
    return
  }
  event.preventDefault()
  const moved = sceneStore.moveNode({ nodeId: sourceId, targetId: null, position })
  if (moved && position === 'inside') {
    // treat as append; already handled by store
  }
  resetDragState()
}

function handleTreeDragLeave(event: DragEvent) {
  const { sourceId } = dragState.value
  if (!sourceId) return
  const container = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (container && related && container.contains(related)) return
  if (dragState.value.targetId === null) {
    dragState.value = { sourceId, targetId: null, position: null }
  }
}

</script>

<template>
  <v-card ref="panelRef" class="panel-card" elevation="4">
    <v-toolbar density="compact" title="Hierarchy" class="panel-toolbar" height="40px">

      <v-spacer />
      <v-btn icon="mdi-window-minimize" size="small" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="panel-body hierarchy-body">
      <v-toolbar density="compact" class="tree-toolbar" height="40px">
        <AddNodeMenu>
          <template #activator="{ props }">
            <v-btn
              icon="mdi-plus"
              variant="text"
              density="compact"
              color="primary"
              v-bind="props"
            />
          </template>
        </AddNodeMenu>
        <v-btn
          icon="mdi-delete-outline"
          variant="text"
          density="compact"
          color="error"
          :disabled="!hasSelection"
          @click="handleDeleteSelected"
        />
        <v-spacer />
        <v-btn
          class="global-toggle-btn"
          :class="{ 'is-active': anyNodeHidden }"
          :icon="visibilityToggleIcon"
          variant="text"
          density="compact"
          size="small"
          :title="visibilityToggleTitle"
          :disabled="!hasHierarchyNodes"
          @click="handleToggleAllVisibility"
        />
        <v-btn
          class="global-toggle-btn"
          :class="{ 'is-active': anyNodeLocked }"
          :icon="lockToggleIcon"
          variant="text"
          density="compact"
          size="small"
          :title="lockToggleTitle"
          :disabled="!hasHierarchyNodes"
          @click="handleToggleAllSelectionLock"
        />
      </v-toolbar>
      <div
        class="tree-container"
        :class="rootDropClasses"
        @dragover="handleTreeDragOver"
        @drop="handleTreeDrop"
        @dragleave="handleTreeDragLeave"
      >
        <v-treeview
          v-model:opened="opened"
          v-model:activated="active"
          density="compact"
          :items="hierarchyItems"
          item-title="name"
          item-value="id"
          color="primary"
          activatable
          class="hierarchy-tree"
        >
          <template #prepend="{ item }">
            <v-icon size="small" class="node-icon" :icon="resolveNodeIcon(item)" />
          </template>
          <template #title="{ item }">
            <div
              class="node-label"
              :class="getNodeInteractionClasses(item.id)"
              draggable="true"
              @dragstart="handleDragStart($event, item.id)"
              @dragend="handleDragEnd"
              @dragover="handleDragOver($event, item.id)"
              @dragleave="handleDragLeave($event, item.id)"
              @drop="handleDrop($event, item.id)"
              @click="handleNodeClick($event, item.id)"
              @dblclick.stop.prevent="handleNodeDoubleClick(item.id)"
            >
              <span class="node-label-text">{{ item.name }}</span>
            </div>
          </template>
          <template #append="{ item }">
            <div class="tree-node-trailing" @mousedown.stop @click.stop>
              <v-btn
                :icon="(item.visible ?? true) ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"
                variant="text"
                density="compact"
                size="26"
                class="visibility-btn"
                :class="{ 'is-hidden': !(item.visible ?? true) }"
                :title="(item.visible ?? true) ? 'Hide' : 'Show'"
                @click.stop="toggleNodeVisibility(item.id)"
              />
              <v-btn
                :icon="item.locked ? 'mdi-lock-outline' : 'mdi-lock-open-variant-outline'"
                variant="text"
                density="compact"
                size="26"
                class="selection-lock-btn"
                :class="{ 'is-locked': item.locked }"
                
                :title="item.locked ? '解除禁止鼠标选择' : '禁止鼠标选择'"
                @click.stop="toggleNodeSelectionLock(item.id)"
              />
            </div>
          </template>
        </v-treeview>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgba(36, 38, 41, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.panel-toolbar :deep(.v-toolbar-title) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-inline-start: 0px;
}

.panel-toolbar :deep(.v-btn) {
  width: 32px;
  height: 32px;
}

.panel-body {
  flex: 1;
  overflow: hidden;
  padding: 0;
}

.hierarchy-body {
  padding: 0.2rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tree-toolbar {
  background: rgba(255, 255, 255, 0.02);
  border-radius: 2px;
  padding-inline: 1px;
  gap: 2px;
}

.global-toggle-btn {
  color: rgba(233, 236, 241, 0.64);
  transition: color 120ms ease;
}

.global-toggle-btn.is-active {
  color: #4dd0e1;
}

.global-toggle-btn:disabled {
  color: rgba(233, 236, 241, 0.28);
}


.tree-toolbar-separator {
  margin: 0 4px;
  opacity: 0.12;
}

.tree-toolbar-divider {
  margin: 0px;
  opacity: 0.08;
}

.hierarchy-tree {
  flex: 1;
  overflow-y: auto;
}

.tree-container {
  position: relative;
  flex: 1;
  overflow: hidden;
  border-radius: 6px;
}

.hierarchy-tree :deep(.v-treeview-item__checkbox),
.hierarchy-tree :deep(.v-treeview-item__selection) {
  display: none !important;
}

.hierarchy-tree :deep(.v-treeview-item--active > .v-treeview-item__content) {
  background: transparent;
}


.hierarchy-tree :deep(.v-treeview-item__content) {
  padding-inline-end: 6px;
}

.tree-container.root-drop-before::before,
.tree-container.root-drop-after::before {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 2px;
  border-radius: 2px;
  background: rgba(77, 208, 225, 0.65);
  pointer-events: none;
  z-index: 1;
}

.tree-container.root-drop-before::before {
  top: 4px;
}

.tree-container.root-drop-after::before {
  bottom: 4px;
}

.tree-container.root-drop-active {
  background: rgba(77, 208, 225, 0.08);
}


.hierarchy-tree :deep(.v-treeview-item) {
  min-height: 30px;
  padding-inline: 10px 6px;
}


.hierarchy-tree :deep(.v-list-item-title) {
  font-size: 0.85rem;
}

.node-label {
  display: flex;
  align-items: center;
  position: relative;
  padding: 4px 8px 4px 1px;
  border-radius: 6px;
  cursor: grab;
  user-select: none;
  color: rgba(233, 236, 241, 0.8);
  transition: background-color 140ms ease, color 140ms ease;
  width: 100%;
}

.node-label:active {
  cursor: grabbing;
}

.node-label-text {
  flex: 1;
  min-width: 0;
  color: inherit;
}

.node-label.is-selected {
  color: #4dd0e1;
}

.node-label.is-active {
  color: #fafafa;
}

.node-label.drop-inside {
  background: rgba(77, 208, 225, 0.12);
}

.node-label.drop-before::before,
.node-label.drop-after::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 2px;
  border-radius: 2px;
  background: rgba(77, 208, 225, 0.75);
  pointer-events: none;
}

.node-label.drop-before::before {
  top: 0;
}

.node-label.drop-after::after {
  bottom: 0;
}

.node-label.drop-disabled {
  background: rgba(244, 67, 54, 0.1);
}


.tree-node-trailing {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  min-width: 24px;
  transition: opacity 120ms ease;
}


.visibility-btn {
  margin-right: 0;
  color: rgba(233, 236, 241, 0.72);
  transition: color 120ms ease;

  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.hierarchy-tree :deep(.v-treeview-item:hover .tree-node-trailing) .visibility-btn,
.hierarchy-tree :deep(.v-treeview-item__append:hover .tree-node-trailing) .visibility-btn,
.hierarchy-tree :deep(.v-treeview-item__append:focus-within .tree-node-trailing) .visibility-btn {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
.visibility-btn.is-hidden {
  color: rgba(233, 236, 241, 0.38);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.visibility-btn:disabled {
  color: rgba(233, 236, 241, 0.28);
  cursor: not-allowed;
}

.visibility-btn :deep(.v-icon) {
  font-size: 18px;
}

.selection-lock-btn {
  margin-right: 0;
  color: rgba(233, 236, 241, 0.58);
  transition: color 120ms ease;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.hierarchy-tree :deep(.v-treeview-item:hover .tree-node-trailing) .selection-lock-btn ,
.hierarchy-tree :deep(.v-treeview-item__append:hover .tree-node-trailing) .selection-lock-btn ,
.hierarchy-tree :deep(.v-treeview-item__append:focus-within .tree-node-trailing) .selection-lock-btn  {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
.selection-lock-btn.is-locked {
  color: rgba(233, 236, 241, 0.9);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.selection-lock-btn :deep(.v-icon) {
  font-size: 18px;
}

.node-icon {
  opacity: 0.7;
}

</style>
