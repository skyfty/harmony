<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { WARP_GATE_COMPONENT_TYPE, type WarpGateComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const warpGateComponent = computed(
  () => selectedNode.value?.components?.[WARP_GATE_COMPONENT_TYPE] as
    | SceneNodeComponentState<WarpGateComponentProps>
    | undefined,
)

function handleToggleComponent() {
  const component = warpGateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = warpGateComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel value="warp-gate">
    <v-expansion-panel-title>
      <div class="warp-gate-panel-header">
        <span class="warp-gate-panel-title">Warp Gate Component</span>
        <v-spacer />
        <v-menu
          v-if="warpGateComponent"
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
              <v-list-item-title>{{ warpGateComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="warp-gate-settings">
        <p class="warp-gate-hint">Warp gates have no adjustable parameters yet. Use behaviors to define their actions.</p>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.warp-gate-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.warp-gate-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.warp-gate-settings {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-inline: 0.4rem;
}

.warp-gate-hint {
  font-size: 0.78rem;
  color: rgba(220, 225, 232, 0.65);
  margin: 0;
}
</style>
