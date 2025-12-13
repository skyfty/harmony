<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { PROTAGONIST_COMPONENT_TYPE, type ProtagonistComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const protagonistComponent = computed(
  () => selectedNode.value?.components?.[PROTAGONIST_COMPONENT_TYPE] as
    | SceneNodeComponentState<ProtagonistComponentProps>
    | undefined,
)

const localName = ref('')

watch(
  () => protagonistComponent.value?.props,
  (props) => {
    localName.value = props?.name ?? ''
  },
  { immediate: true, deep: true },
)

function handleToggleComponent() {
  const component = protagonistComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = protagonistComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleNameChange(value: string) {
  const component = protagonistComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  localName.value = value
  sceneStore.updateNodeComponentProps(nodeId, component.id, { name: value })
}
</script>

<template>
  <v-expansion-panel value="protagonist">
    <v-expansion-panel-title>
      <div class="protagonist-panel-header">
        <span class="protagonist-panel-title">Protagonist</span>
        <v-spacer />
        <v-menu
          v-if="protagonistComponent"
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
              <v-list-item-title>{{ protagonistComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="protagonist-settings">
        <v-text-field
          :model-value="localName"
          label="Name"
          density="comfortable"
          variant="outlined"
          hide-details
          :disabled="!protagonistComponent?.enabled"
          @update:modelValue="handleNameChange"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.protagonist-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.protagonist-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.protagonist-settings {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-inline: 0.4rem;
}
</style>
