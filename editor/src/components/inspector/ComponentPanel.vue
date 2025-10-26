<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@/types/node-component'
import { componentManager } from '@/runtime/components'

const sceneStore = useSceneStore()
const { selectedNode } = storeToRefs(sceneStore)

const availableComponents = computed(() => {
  const node = selectedNode.value
  if (!node) {
    return []
  }
  const existingTypes = new Set((node.components ?? []).map((entry) => entry.type))
  return componentManager
    .listDefinitions()
    .filter((definition) => definition.canAttach(node) && !existingTypes.has(definition.type))
})

const nodeComponents = computed(() => selectedNode.value?.components ?? [])

function handleToggle(component: SceneNodeComponentState) {
  if (!selectedNode.value) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(selectedNode.value.id, component.id)
}

function handleRemove(component: SceneNodeComponentState) {
  if (!selectedNode.value) {
    return
  }
  sceneStore.removeNodeComponent(selectedNode.value.id, component.id)
}

function handleAdd(type: string) {
  if (!selectedNode.value) {
    return
  }
  sceneStore.addNodeComponent(selectedNode.value.id, type)
}
</script>

<template>
  <v-expansion-panel value="components">
    <v-expansion-panel-title>
      Components
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div v-if="nodeComponents.length" class="component-list">
        <div v-for="component in nodeComponents" :key="component.id" class="component-entry">
          <div class="component-header">
            <v-icon size="18" class="component-icon">
              {{ componentManager.getDefinition(component.type)?.icon ?? 'mdi-puzzle' }}
            </v-icon>
            <span class="component-name">
              {{ componentManager.getDefinition(component.type)?.label ?? component.type }}
            </span>
            <v-spacer />
            <v-btn
              icon
              size="x-small"
              variant="text"
              :title="component.enabled ? 'Disable' : 'Enable'"
              @click.stop="handleToggle(component)"
            >
              <v-icon size="18">
                {{ component.enabled ? 'mdi-toggle-switch' : 'mdi-toggle-switch-off' }}
              </v-icon>
            </v-btn>
            <v-btn
              icon
              size="x-small"
              variant="text"
              title="Remove component"
              @click.stop="handleRemove(component)"
            >
              <v-icon size="18">mdi-delete</v-icon>
            </v-btn>
          </div>
          <div class="component-body">
            <div v-if="component.type === 'wall'" class="component-fields">
              <v-text-field
                v-model.number="component.props.height"
                type="number"
                label="Height (m)"
                variant="outlined"
                density="comfortable"
                :step="0.1"
                @blur="sceneStore.updateNodeComponentProps(selectedNode?.id ?? '', component.id, { height: component.props.height })"
              />
              <v-text-field
                v-model.number="component.props.width"
                type="number"
                label="Width (m)"
                variant="outlined"
                density="comfortable"
                :step="0.05"
                @blur="sceneStore.updateNodeComponentProps(selectedNode?.id ?? '', component.id, { width: component.props.width })"
              />
              <v-text-field
                v-model.number="component.props.thickness"
                type="number"
                label="Thickness (m)"
                variant="outlined"
                density="comfortable"
                :step="0.05"
                @blur="sceneStore.updateNodeComponentProps(selectedNode?.id ?? '', component.id, { thickness: component.props.thickness })"
              />
            </div>
            <div v-else class="component-placeholder">
              No inspector defined for this component type yet.
            </div>
          </div>
        </div>
      </div>
      <div v-else class="component-empty">
        No components attached to this node.
      </div>
      <div v-if="availableComponents.length" class="component-actions">
        <v-menu location="bottom" origin="auto" transition="fade-transition">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="tonal" prepend-icon="mdi-plus">
              Add Component
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              v-for="definition in availableComponents"
              :key="definition.type"
              :value="definition.type"
              @click="handleAdd(definition.type)"
            >
              <template #prepend>
                <v-icon size="18">{{ definition.icon ?? 'mdi-puzzle' }}</v-icon>
              </template>
              <v-list-item-title>{{ definition.label }}</v-list-item-title>
              <v-list-item-subtitle v-if="definition.description">
                {{ definition.description }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.component-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.component-entry {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background-color: rgba(20, 24, 32, 0.7);
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.component-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.component-icon {
  color: #8ab4f8;
}

.component-name {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.component-fields {
  display: grid;
  gap: 0.4rem;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.component-actions {
  margin-top: 0.75rem;
  display: flex;
  justify-content: flex-start;
}

.component-empty {
  color: rgba(233, 236, 241, 0.7);
  font-size: 0.85rem;
  padding: 0.4rem 0;
}

.component-placeholder {
  color: rgba(233, 236, 241, 0.6);
  font-style: italic;
  font-size: 0.85rem;
}
</style>
