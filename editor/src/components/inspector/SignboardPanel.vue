<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema'
import { useSceneStore } from '@/stores/sceneStore'
import { SIGNBOARD_COMPONENT_TYPE, type SignboardComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const signboardComponent = computed(
  () => selectedNode.value?.components?.[SIGNBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<SignboardComponentProps>
    | undefined,
)

const localLabel = ref('')

watch(
  () => signboardComponent.value?.props,
  (props) => {
    localLabel.value = props?.label ?? ''
  },
  { immediate: true, deep: true },
)

function handleToggleComponent() {
  const component = signboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = signboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleLabelInput(value: string) {
  localLabel.value = value
}

function handleLabelSubmit() {
  const component = signboardComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { label: localLabel.value })
}
</script>

<template>
  <v-expansion-panel value="signboard">
    <v-expansion-panel-title>
      <div class="signboard-panel-header">
        <span class="signboard-panel-title">Signboard</span>
        <v-spacer />
        <v-menu
          v-if="signboardComponent"
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
              <v-list-item-title>{{ signboardComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="signboard-settings">
        <v-text-field
          :model-value="localLabel"
          label="Display Name"
          hint="Leave empty to use the node name"
          persistent-hint
          density="comfortable"
          variant="underlined"
          :disabled="!signboardComponent?.enabled"
          @update:modelValue="handleLabelInput"
          @blur="handleLabelSubmit"
          @keydown.enter.prevent="handleLabelSubmit"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.signboard-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.signboard-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.signboard-settings {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-inline: 0.4rem;
}
</style>