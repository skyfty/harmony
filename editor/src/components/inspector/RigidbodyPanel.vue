<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  RIGIDBODY_COMPONENT_TYPE,
  type RigidbodyComponentProps,
  clampRigidbodyComponentProps,
  DEFAULT_RIGIDBODY_MASS,
  MIN_RIGIDBODY_MASS,
  MAX_RIGIDBODY_MASS,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const rigidbodyComponent = computed(() =>
  selectedNode.value?.components?.[RIGIDBODY_COMPONENT_TYPE] as
    | SceneNodeComponentState<RigidbodyComponentProps>
    | undefined,
)

const normalizedProps = computed(() => {
  const props = rigidbodyComponent.value?.props as Partial<RigidbodyComponentProps> | undefined
  return clampRigidbodyComponentProps(props ?? null)
})

const localMass = ref(DEFAULT_RIGIDBODY_MASS)

watch(
  () => normalizedProps.value,
  (props) => {
    localMass.value = props.mass
  },
  { immediate: true, deep: true },
)

function updateComponent(patch: Partial<RigidbodyComponentProps>): void {
  const component = rigidbodyComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch)
}

function handleMassInput(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = clampRigidbodyComponentProps({
    mass: numeric,
  }).mass
  localMass.value = clamped
  if (Math.abs(clamped - normalizedProps.value.mass) <= 1e-4) {
    return
  }
  updateComponent({ mass: clamped })
}


function handleToggleComponent() {
  const component = rigidbodyComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = rigidbodyComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel value="rigidbody">
    <v-expansion-panel-title>
      <div class="rigidbody-panel__header">
        <span class="rigidbody-panel__title">Rigidbody Component</span>
        <v-spacer />
        <v-menu
          v-if="rigidbodyComponent"
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
              <v-list-item-title>{{ rigidbodyComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
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
      <div class="rigidbody-panel__body">

        <v-text-field
          label="Mass"
          type="number"
          density="comfortable"
          variant="outlined"
          :min="MIN_RIGIDBODY_MASS"
          :max="MAX_RIGIDBODY_MASS"
          :step="0.1"
          :disabled="!rigidbodyComponent?.enabled"
          :model-value="localMass"
          @update:modelValue="handleMassInput"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.rigidbody-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.rigidbody-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.rigidbody-panel__body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-inline: 0.4rem;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>
