<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { VIEW_POINT_COMPONENT_TYPE, type ViewPointComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const viewPointComponent = computed(
  () => selectedNode.value?.components?.[VIEW_POINT_COMPONENT_TYPE] as
    | SceneNodeComponentState<ViewPointComponentProps>
    | undefined,
)

const localInitiallyVisible = ref(true)

watch(
  () => viewPointComponent.value?.props,
  (props) => {
    localInitiallyVisible.value = props?.initiallyVisible !== false
  },
  { immediate: true, deep: true },
)

function handleToggleComponent() {
  const component = viewPointComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = viewPointComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleVisibilityChange(value: boolean | null) {
  const component = viewPointComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const nextValue = value !== false
  localInitiallyVisible.value = nextValue
  sceneStore.updateNodeComponentProps(nodeId, component.id, { initiallyVisible: nextValue })
}
</script>

<template>
  <v-expansion-panel value="view-point">
    <v-expansion-panel-title>
      <div class="view-point-panel-header">
        <span class="view-point-panel-title">View Point Component</span>
        <v-spacer />
        <v-menu
          v-if="viewPointComponent"
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
              <v-list-item-title>{{ viewPointComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="view-point-settings">
        <v-checkbox
          :model-value="localInitiallyVisible"
          label="Initially Visible"
          color="primary"
          density="comfortable"
          :disabled="!viewPointComponent?.enabled"
          inset
          @update:modelValue="handleVisibilityChange"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.view-point-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.view-point-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.view-point-settings {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-inline: 0.4rem;
}
</style>
