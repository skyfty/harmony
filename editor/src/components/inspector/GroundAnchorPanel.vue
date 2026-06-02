<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  GROUND_ANCHOR_COMPONENT_TYPE,
  clampGroundAnchorComponentProps,
  type GroundAnchorComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const component = computed(
  () =>
    selectedNode.value?.components?.[GROUND_ANCHOR_COMPONENT_TYPE] as
      | SceneNodeComponentState<GroundAnchorComponentProps>
      | undefined,
)

const componentEnabled = computed(() => component.value?.enabled !== false)
const normalizedProps = computed(() => clampGroundAnchorComponentProps(component.value?.props ?? null))

function updateLabel(value: string): void {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, currentComponent.id, {
    label: clampGroundAnchorComponentProps({ label: value }).label,
  })
}

function handleToggleComponent(): void {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, currentComponent.id)
}

function handleRemoveComponent(): void {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, currentComponent.id)
}
</script>

<template>
  <v-expansion-panel :value="GROUND_ANCHOR_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="ground-anchor-panel__header">
        <span class="ground-anchor-panel__title">Ground Anchor</span>
        <v-spacer />
        <v-menu
          v-if="component"
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
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="ground-anchor-panel__content">
        <v-text-field
          :model-value="normalizedProps.label"
          label="Label"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
          @update:model-value="(value) => updateLabel(String(value ?? ''))"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.ground-anchor-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.ground-anchor-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.ground-anchor-panel__content {
  display: grid;
  gap: 0.5rem;
}

.ground-anchor-panel__hint {
  opacity: 0.86;
  font-size: 0.9rem;
  line-height: 1.25rem;
}
</style>
