<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  GUIDEBOARD_COMPONENT_TYPE,
  type GuideboardComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const guideboardComponent = computed(
  () => selectedNode.value?.components?.[GUIDEBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<GuideboardComponentProps>
    | undefined,
)

const localInitiallyVisible = ref(false)

watch(
  () => guideboardComponent.value?.props,
  (props) => {
    localInitiallyVisible.value = props?.initiallyVisible === true
  },
  { immediate: true, deep: true },
)

function handleToggleComponent() {
  const component = guideboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = guideboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleVisibilityChange(value: boolean | null) {
  const component = guideboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const nextValue = value === true
  localInitiallyVisible.value = nextValue
  sceneStore.updateNodeComponentProps(nodeId, component.id, { initiallyVisible: nextValue })
}
</script>

<template>
  <v-expansion-panel value="guideboard">
    <v-expansion-panel-title>
      <div class="guideboard-panel-header">
        <span class="guideboard-panel-title">Guideboard Component</span>
        <v-spacer />
        <v-menu
          v-if="guideboardComponent"
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
              <v-list-item-title>{{ guideboardComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="guideboard-settings">
        <v-checkbox
          :model-value="localInitiallyVisible"
          label="Initially Visible"
          color="primary"
          density="comfortable"
          :disabled="!guideboardComponent?.enabled"
          inset
          @update:modelValue="handleVisibilityChange"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.guideboard-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.guideboard-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.guideboard-settings {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-inline: 0.4rem;
}

.guideboard-hint {
  font-size: 0.78rem;
  color: rgba(220, 225, 232, 0.65);
  margin: 0;
}
</style>
