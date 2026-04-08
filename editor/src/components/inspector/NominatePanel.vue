<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNode, SceneNodeComponentState } from '@schema'
import NodePicker from '@/components/common/NodePicker.vue'
import { generateUuid } from '@/utils/uuid'
import { useSceneStore } from '@/stores/sceneStore'
import {
  NOMINATE_COMPONENT_TYPE,
  clampNominateComponentProps,
  type NominateComponentEntry,
  type NominateComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, nodes } = storeToRefs(sceneStore)

const nominateComponent = computed(
  () => selectedNode.value?.components?.[NOMINATE_COMPONENT_TYPE] as
    | SceneNodeComponentState<NominateComponentProps>
    | undefined,
)

const nominateProps = computed(() => clampNominateComponentProps(nominateComponent.value?.props))
const entries = computed(() => nominateProps.value.entries ?? [])

function findNodeName(tree: SceneNode[] | undefined, targetId: string | null | undefined): string {
  if (!tree?.length || !targetId) {
    return ''
  }
  for (const node of tree) {
    if (node.id === targetId) {
      return node.name?.trim() ?? ''
    }
    const nested = findNodeName(node.children, targetId)
    if (nested) {
      return nested
    }
  }
  return ''
}

function updateEntries(nextEntries: NominateComponentEntry[]): void {
  const component = nominateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, {
    entries: nextEntries,
  })
}

function handleAddEntry(): void {
  const nextEntries = [
    ...entries.value,
    {
      id: generateUuid(),
      key: '',
      nodeId: null,
      defaultVisible: true,
    },
  ]
  updateEntries(nextEntries)
}

function handleRemoveEntry(entryId: string): void {
  updateEntries(entries.value.filter((entry) => entry.id !== entryId))
}

function handleToggleComponent(): void {
  const component = nominateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent(): void {
  const component = nominateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleEntryNodeChange(entryId: string, nextNodeId: string | null): void {
  const nextEntries = entries.value.map((entry) => {
    if (entry.id !== entryId) {
      return entry
    }
    const currentKey = entry.key?.trim() ?? ''
    const nextName = findNodeName(nodes.value, nextNodeId)
    return {
      ...entry,
      nodeId: nextNodeId,
      key: currentKey || nextName,
    }
  })
  updateEntries(nextEntries)
}

function handleEntryKeyChange(entryId: string, value: string): void {
  const nextEntries = entries.value.map((entry) => {
    if (entry.id !== entryId) {
      return entry
    }
    return {
      ...entry,
      key: value,
    }
  })
  updateEntries(nextEntries)
}

function handleEntryVisibilityChange(entryId: string, value: boolean | null): void {
  const nextEntries = entries.value.map((entry) => {
    if (entry.id !== entryId) {
      return entry
    }
    return {
      ...entry,
      defaultVisible: value !== false,
    }
  })
  updateEntries(nextEntries)
}
</script>

<template>
  <v-expansion-panel :value="NOMINATE_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="nominate-panel__header">
        <span class="nominate-panel__title">Nominate</span>
        <v-spacer />
        <v-btn
          v-if="nominateComponent"
          size="small"
          variant="text"
          icon="mdi-plus"
          :disabled="!nominateComponent.enabled"
          aria-label="Add Item"
          @click.stop="handleAddEntry"
        />
        <v-menu
          v-if="nominateComponent"
          location="bottom end"
          origin="auto"
          transition="fade-transition"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              variant="text"
              size="small"
              class="component-menu-btn"
              @click.stop
            >
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent()">
              <v-list-item-title>{{ nominateComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="handleRemoveComponent()">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="nominate-panel__body">
        <div v-if="entries.length" class="nominate-panel__list">
          <div v-for="entry in entries" :key="entry.id" class="nominate-entry">
            <div class="nominate-entry__fields">
              <NodePicker
                :model-value="entry.nodeId"
                pick-hint="Click a node in the scene to control"
                selection-hint="Select the scene node controlled by this nominate item"
                placeholder="Target Node"
                :disabled="!nominateComponent?.enabled"
                @update:modelValue="(value) => handleEntryNodeChange(entry.id, value as string | null)"
              />
              <v-text-field
                label="Identifier"
                density="compact"
                variant="underlined"
                hint="Defaults to the selected node name"
                persistent-hint
                :model-value="entry.key"
                :disabled="!nominateComponent?.enabled"
                @update:modelValue="(value) => handleEntryKeyChange(entry.id, String(value ?? ''))"
              />
              <v-switch
                label="Visible By Default"
                color="primary"
                density="compact"
                hide-details
                inset
                :model-value="entry.defaultVisible"
                :disabled="!nominateComponent?.enabled"
                @update:modelValue="(value) => handleEntryVisibilityChange(entry.id, value as boolean | null)"
              />
            </div>
            <div class="nominate-entry__actions">
              <v-btn
                icon
                variant="text"
                density="compact"
                :disabled="!nominateComponent?.enabled"
                @click="handleRemoveEntry(entry.id)"
              >
                <v-icon size="18">mdi-delete</v-icon>
              </v-btn>
            </div>
          </div>
        </div>
        <div v-else class="nominate-panel__empty">
          Add nominate items to map external identifiers to scene nodes.
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.nominate-panel__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.nominate-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.nominate-panel__body {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding-inline: 0.4rem;
}

.nominate-panel__list {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.nominate-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
  padding: 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
}

.nominate-entry__fields {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-width: 0;
}

.nominate-entry__actions {
  display: flex;
  align-items: center;
}

.nominate-panel__empty {
  font-size: 0.84rem;
  color: rgba(233, 236, 241, 0.58);
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>