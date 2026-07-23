<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import {
  GENERAL_MESH_COMPONENT_TYPE,
  clampGeneralMeshComponentProps,
  type GeneralMeshComponentProps,
} from '@schema/components'
import { useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const component = computed(() => selectedNode.value?.components?.[GENERAL_MESH_COMPONENT_TYPE] as
  | SceneNodeComponentState<GeneralMeshComponentProps>
  | undefined)
const componentEnabled = computed(() => component.value?.enabled !== false)
const frustumCullingEnabled = computed(() => clampGeneralMeshComponentProps(component.value?.props).enableFrustumCulling)

function handleToggleComponent() {
  if (component.value && selectedNodeId.value) {
    sceneStore.toggleNodeComponentEnabled(selectedNodeId.value, component.value.id)
  }
}

function handleEnabledChange(value: boolean | null) {
  if (!component.value || !selectedNodeId.value || value === null) {
    return
  }
  sceneStore.setNodeComponentEnabled(selectedNodeId.value, component.value.id, value)
}

function handleFrustumCullingChange(value: boolean | null) {
  if (!component.value || !selectedNodeId.value || value === null) {
    return
  }
  sceneStore.updateNodeComponentProps(selectedNodeId.value, component.value.id, {
    enableFrustumCulling: value,
  })
}

function handleRemoveComponent() {
  if (component.value && selectedNodeId.value) {
    sceneStore.removeNodeComponent(selectedNodeId.value, component.value.id)
  }
}
</script>

<template>
  <v-expansion-panel :value="GENERAL_MESH_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="general-mesh-panel__header">
        <span class="general-mesh-panel__title">General Mesh</span>
        <v-spacer />
        <v-menu v-if="component" location="bottom end" origin="auto" transition="fade-transition">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon variant="text" size="small" class="component-menu-btn" @click.stop>
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent">
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider inset />
            <v-list-item @click.stop="handleRemoveComponent">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <v-switch
        label="视锥体裁剪"
        density="compact"
        hide-details
        color="primary"
        :model-value="frustumCullingEnabled"
        @update:model-value="handleFrustumCullingChange"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.general-mesh-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.general-mesh-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}
</style>
