<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { PRELOADABLE_COMPONENT_TYPE, type PreloadableComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const preloadableComponent = computed(
  () =>
    selectedNode.value?.components?.[PRELOADABLE_COMPONENT_TYPE] as
      | SceneNodeComponentState<PreloadableComponentProps>
      | undefined,
)

const componentEnabled = computed(() => preloadableComponent.value?.enabled !== false)

function handleToggleComponent() {
  const component = preloadableComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleEnabledChange(value: boolean | null) {
  const component = preloadableComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  if (value === null) {
    return
  }
  sceneStore.setNodeComponentEnabled(nodeId, component.id, value)
}

function handleRemoveComponent() {
  const component = preloadableComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel :value="PRELOADABLE_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="preloadable-panel__header">
        <span class="preloadable-panel__title">Preloadable</span>
        <v-spacer />
        <v-menu
          v-if="preloadableComponent"
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
      <div class="preloadable-panel__content">
        <div class="preloadable-panel__hint">
          Export 时会将“本节点 + 子树”涉及的模型资产加入场景预加载列表，进入场景后可立即显示。
        </div>
        <v-switch
          label="Enable preload on entry"
          density="compact"
          hide-details
          color="primary"
          :model-value="componentEnabled"
          @update:modelValue="handleEnabledChange"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.preloadable-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.preloadable-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.preloadable-panel__content {
  display: grid;
  gap: 0.5rem;
}

.preloadable-panel__hint {
  opacity: 0.86;
  font-size: 0.9rem;
  line-height: 1.25rem;
}
</style>
