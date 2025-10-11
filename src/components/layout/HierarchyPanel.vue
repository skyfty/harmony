<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import HierarchyAddMenu from './HierarchyAddMenu.vue'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()

const sceneStore = useSceneStore()
const { hierarchyItems, selectedNodeId } = storeToRefs(sceneStore)

const opened = ref<string[]>([])
const checkboxSelection = ref<string[]>([])

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

const allNodeIds = computed(() => flattenIds(hierarchyItems.value))
const hasSelection = computed(() => checkboxSelection.value.length > 0)
const isAllSelected = computed(
  () => allNodeIds.value.length > 0 && checkboxSelection.value.length === allNodeIds.value.length,
)

watch(allNodeIds, (ids) => {
  checkboxSelection.value = checkboxSelection.value.filter((id) => ids.includes(id))
})

function expandAll(items: Array<{ id: string; children?: Array<unknown> }>): string[] {
  const collected: string[] = []
  for (const item of items) {
    collected.push(item.id)
    if (Array.isArray(item.children) && item.children.length) {
      collected.push(...expandAll(item.children as Array<{ id: string; children?: Array<unknown> }>))
    }
  }
  return collected
}

function flattenIds(items: Array<{ id: string; children?: Array<unknown> }>): string[] {
  const ids: string[] = []
  for (const item of items) {
    ids.push(item.id)
    if (Array.isArray(item.children) && item.children.length) {
      ids.push(...flattenIds(item.children as Array<{ id: string; children?: Array<unknown> }>))
    }
  }
  return ids
}

function isItemSelected(id: string) {
  return checkboxSelection.value.includes(id)
}

function handleCheckboxChange(id: string, value: boolean | null) {
  const nextState = Boolean(value)
  if (nextState) {
    if (!checkboxSelection.value.includes(id)) {
      checkboxSelection.value = [...checkboxSelection.value, id]
    }
  } else {
    checkboxSelection.value = checkboxSelection.value.filter((itemId) => itemId !== id)
  }
}

function handleSelectAll() {
  if (!allNodeIds.value.length) return
  checkboxSelection.value = [...allNodeIds.value]
}

function handleClearSelection() {
  checkboxSelection.value = []
}

function handleDeleteSelected() {
  if (!checkboxSelection.value.length) return
  sceneStore.removeSceneNodes(checkboxSelection.value)
  checkboxSelection.value = []
}

</script>

<template>
  <v-card class="panel-card" elevation="4">
    <v-toolbar density="compact" title="Hierarchy" class="panel-toolbar" height="40">
      <v-spacer />
      <v-btn icon="mdi-window-minimize" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="panel-body hierarchy-body">
      <v-toolbar density="compact" class="tree-toolbar" flat height="36">
    
        <HierarchyAddMenu />

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
          icon="mdi-select-all"
          variant="text"
          density="compact"
          :disabled="isAllSelected"
          @click="handleSelectAll"
        />
        <v-btn
          icon="mdi-select-off"
          variant="text"
          density="compact"
          :disabled="!hasSelection"
          @click="handleClearSelection"
        />
      </v-toolbar>
      <v-treeview
        v-model:opened="opened"
        v-model:activated="active"
        density="compact"
        :items="hierarchyItems"
        item-title="name"
        item-value="id"
        color="primary"
        activatable
        open-on-click
        class="hierarchy-tree"
      >
        <template #prepend>
          <v-icon size="small" class="node-icon">mdi-cube-outline</v-icon>
        </template>
        <template #append="{ item }">
          <div class="tree-node-trailing" @mousedown.stop @click.stop>
            
            <v-checkbox
              :model-value="isItemSelected(item.id)"
              :class="['node-checkbox', { 'is-selected': isItemSelected(item.id) }]"
              density="compact"
              hide-details
              color="primary"
              :ripple="false"
              @update:modelValue="handleCheckboxChange(item.id, $event)"
            />
          </div>
        </template>
      </v-treeview>
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

.tree-toolbar :deep(.v-btn) {
  width: 20px;
  height: 20px;
  min-width: 20px;
  padding: 0;
}

.v-toolbar .v-toolbar__content .v-btn {
    height: 20px;
    padding: 0 12px 0 12px;
    min-width: 20px;
    font-size: 12px;
    margin-left: 3px;
}

.tree-toolbar :deep(.v-btn .v-icon) {
  font-size: 16px;
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


.hierarchy-tree :deep(.v-treeview-item) {
  min-height: 30px;
}

.hierarchy-tree :deep(.v-list-item-title) {
  font-size: 0.85rem;
}


.tree-node-trailing {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 32px;
}

.hierarchy-tree :deep(.node-checkbox) {
  opacity: 0;
  transform: scale(0.75);
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
}

.hierarchy-tree :deep(.v-treeview-item:hover .node-checkbox),
.hierarchy-tree :deep(.v-treeview-item:focus-within .node-checkbox),
.hierarchy-tree :deep(.node-checkbox.is-selected) {
  opacity: 1;
  transform: scale(0.9);
  pointer-events: auto;
}

.hierarchy-tree :deep(.node-checkbox .v-selection-control) {
  min-height: 18px;
}

.hierarchy-tree :deep(.node-checkbox .v-selection-control__input) {
  width: 16px;
  height: 16px;
}

.hierarchy-tree :deep(.node-checkbox .v-icon) {
  font-size: 16px;
}

.node-icon {
  opacity: 0.7;
  margin-right: 6px;
}
</style>
