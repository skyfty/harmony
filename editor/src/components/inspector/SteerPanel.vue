<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNode, SceneNodeComponentState } from '@schema'
import NodePicker from '@/components/common/NodePicker.vue'
import { generateUuid } from '@/utils/uuid'
import { useSceneStore } from '@/stores/sceneStore'
import {
  STEER_COMPONENT_TYPE,
  clampSteerComponentProps,
  type SteerComponentEntry,
  type SteerComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, nodes } = storeToRefs(sceneStore)

const steerComponent = computed(
  () => selectedNode.value?.components?.[STEER_COMPONENT_TYPE] as
    | SceneNodeComponentState<SteerComponentProps>
    | undefined,
)

const steerProps = computed(() => clampSteerComponentProps(steerComponent.value?.props))
const entries = computed(() => steerProps.value.entries ?? [])
const defaultEntryId = computed(() => steerProps.value.defaultEntryId)

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

function updateSteerProps(patch: Partial<SteerComponentProps>): void {
  const component = steerComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch as Partial<Record<string, unknown>>)
}

function updateEntries(nextEntries: SteerComponentEntry[]): void {
  const nextDefaultEntryId = defaultEntryId.value && nextEntries.some((entry) => entry.id === defaultEntryId.value)
    ? defaultEntryId.value
    : null
  updateSteerProps({
    entries: nextEntries,
    defaultEntryId: nextDefaultEntryId,
  })
}

function handleAddEntry(): void {
  updateEntries([
    ...entries.value,
    {
      id: generateUuid(),
      key: '',
      nodeId: null,
    },
  ])
}

function handleRemoveEntry(entryId: string): void {
  const nextEntries = entries.value.filter((entry) => entry.id !== entryId)
  updateSteerProps({
    entries: nextEntries,
    defaultEntryId: defaultEntryId.value === entryId ? null : defaultEntryId.value,
  })
}

function handleToggleComponent(): void {
  const component = steerComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent(): void {
  const component = steerComponent.value
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
  updateEntries(entries.value.map((entry) => {
    if (entry.id !== entryId) {
      return entry
    }
    return {
      ...entry,
      key: value,
    }
  }))
}

function handleDefaultEntryChange(entryId: string, value: boolean | null): void {
  if (!value && defaultEntryId.value !== entryId) {
    return
  }
  updateSteerProps({
    defaultEntryId: value ? entryId : null,
  })
}
</script>

<template>
  <v-expansion-panel :value="STEER_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="steer-panel__header">
        <span class="steer-panel__title">Steer</span>
        <v-spacer />
        <v-btn
          v-if="steerComponent"
          size="small"
          variant="text"
          icon="mdi-plus"
          :disabled="!steerComponent.enabled"
          aria-label="Add Item"
          @click.stop="handleAddEntry"
        />
        <v-menu
          v-if="steerComponent"
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
              <v-list-item-title>{{ steerComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="steer-panel__body">
        <div v-if="entries.length" class="steer-panel__list">
          <div
            v-for="entry in entries"
            :key="entry.id"
            class="steer-entry"
            :class="{ 'steer-entry--default': defaultEntryId === entry.id }"
          >
            <div class="steer-entry__fields">
              <div class="steer-entry__meta">
                <span v-if="defaultEntryId === entry.id" class="steer-entry__badge">Auto Drive Default</span>
                <span v-else class="steer-entry__badge steer-entry__badge--muted">Optional Default</span>
              </div>
              <NodePicker
                owner="steer-target"
                :model-value="entry.nodeId"
                pick-hint="Click a vehicle node in the scene to drive"
                selection-hint="Select the vehicle node mapped by this steer item"
                placeholder="Vehicle"
                :disabled="!steerComponent?.enabled"
                @update:modelValue="(value) => handleEntryNodeChange(entry.id, value as string | null)"
              />
              <v-text-field
                label="Identifier"
                density="compact"
                variant="underlined"
                persistent-hint
                :model-value="entry.key"
                :disabled="!steerComponent?.enabled"
                @update:modelValue="(value) => handleEntryKeyChange(entry.id, String(value ?? ''))"
              />
              <v-switch
                label="Default Vehicle"
                color="primary"
                density="compact"
                hide-details
                :model-value="defaultEntryId === entry.id"
                :disabled="!steerComponent?.enabled || !entry.nodeId"
                @update:modelValue="(value) => handleDefaultEntryChange(entry.id, value as boolean | null)"
              />
            </div>
            <div class="steer-entry__actions">
              <v-btn
                icon
                variant="text"
                density="compact"
                :disabled="!steerComponent?.enabled"
                @click="handleRemoveEntry(entry.id)"
              >
                <v-icon size="18">mdi-delete</v-icon>
              </v-btn>
            </div>
          </div>
        </div>
        <div v-else class="steer-panel__empty">
          Add steer items to map external identifiers to vehicle nodes.
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.steer-panel__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.steer-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.steer-panel__body {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding-inline: 0.4rem;
}

.steer-panel__list {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.steer-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
  padding: 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
  transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
}

.steer-entry--default {
  border-color: rgba(76, 175, 80, 0.45);
  background: rgba(76, 175, 80, 0.08);
  box-shadow: 0 0 0 1px rgba(76, 175, 80, 0.12) inset;
}

.steer-entry__fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.steer-entry__meta {
  display: flex;
  align-items: center;
}

.steer-entry__badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.5rem;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: rgba(76, 175, 80, 0.16);
  color: rgba(198, 255, 204, 0.96);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.steer-entry__badge--muted {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(233, 236, 241, 0.7);
}

.steer-entry__actions {
  display: flex;
  align-items: center;
}

.steer-entry__hint {
  margin-top: -0.4rem;
  font-size: 0.76rem;
  line-height: 1.4;
  color: rgba(233, 236, 241, 0.62);
}

.steer-panel__empty {
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