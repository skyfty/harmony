<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  PHYSICS_AUTHORITY_COMPONENT_TYPE,
  type PhysicsAuthorityComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const physicsAuthorityComponent = computed(
  () => selectedNode.value?.components?.[PHYSICS_AUTHORITY_COMPONENT_TYPE] as
    | SceneNodeComponentState<PhysicsAuthorityComponentProps>
    | undefined,
)

const componentEnabled = computed(() => physicsAuthorityComponent.value?.enabled !== false)

const localValues = reactive({
  inputSendIntervalMs: '',
  snapshotLerpMs: '',
  snapThreshold: '',
  inputLeaseMs: '',
})

watch(
  () => physicsAuthorityComponent.value?.props,
  (props) => {
    localValues.inputSendIntervalMs = props?.inputSendIntervalMs?.toString() ?? ''
    localValues.snapshotLerpMs = props?.snapshotLerpMs?.toString() ?? ''
    localValues.snapThreshold = props?.snapThreshold?.toString() ?? ''
    localValues.inputLeaseMs = props?.inputLeaseMs?.toString() ?? ''
  },
  { immediate: true, deep: true },
)

function updateComponentProps(next: Partial<PhysicsAuthorityComponentProps>) {
  const component = physicsAuthorityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, next)
}

function handleToggleComponent() {
  const component = physicsAuthorityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = physicsAuthorityComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function parseNumber(value: string | number): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function handleOptionalNumberChange(key: 'inputSendIntervalMs', value: string) {
  localValues[key] = value
  if (!String(value).trim().length) {
    updateComponentProps({ [key]: null } as Partial<PhysicsAuthorityComponentProps>)
    return
  }
  const parsed = parseNumber(value)
  if (parsed !== null) {
    updateComponentProps({ [key]: parsed } as Partial<PhysicsAuthorityComponentProps>)
  }
}

function handleNumberChange(key: 'snapshotLerpMs' | 'snapThreshold' | 'inputLeaseMs', value: string) {
  localValues[key] = value
  const parsed = parseNumber(value)
  if (parsed !== null) {
    updateComponentProps({ [key]: parsed } as Partial<PhysicsAuthorityComponentProps>)
  }
}
</script>

<template>
  <v-expansion-panel value="physicsAuthority">
    <v-expansion-panel-title>
      <div class="physics-authority-panel__header">
        <span class="physics-authority-panel__title">Physics Authority</span>
        <v-spacer />
        <v-menu
          v-if="physicsAuthorityComponent"
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
      <div class="physics-authority-settings">
        <v-switch
          label="Client Prediction"
          density="compact"
          hide-details
          color="primary"
          :model-value="physicsAuthorityComponent?.props.allowClientPrediction"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => updateComponentProps({ allowClientPrediction: value === true })"
        />
        <v-select
          label="Actor Type"
          density="compact"
          variant="underlined"
          hide-details
          :items="[
            { title: 'Auto', value: 'auto' },
            { title: 'Vehicle', value: 'vehicle' },
            { title: 'Character', value: 'character' },
          ]"
          :model-value="physicsAuthorityComponent?.props.actorType ?? 'auto'"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => updateComponentProps({ actorType: value as PhysicsAuthorityComponentProps['actorType'] })"
        />
        <v-text-field
          label="Input Interval (ms)"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.inputSendIntervalMs"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => handleOptionalNumberChange('inputSendIntervalMs', String(value))"
        />
        <v-text-field
          label="Snapshot Lerp (ms)"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.snapshotLerpMs"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => handleNumberChange('snapshotLerpMs', String(value))"
        />
        <v-text-field
          label="Snap Threshold"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.snapThreshold"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => handleNumberChange('snapThreshold', String(value))"
        />
        <v-text-field
          label="Lease (ms)"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.inputLeaseMs"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => handleNumberChange('inputLeaseMs', String(value))"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.physics-authority-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.physics-authority-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.physics-authority-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.5rem;
}
</style>
