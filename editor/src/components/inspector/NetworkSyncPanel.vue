<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  NETWORK_SYNC_COMPONENT_TYPE,
  type NetworkSyncComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const networkSyncComponent = computed(
  () => selectedNode.value?.components?.[NETWORK_SYNC_COMPONENT_TYPE] as
    | SceneNodeComponentState<NetworkSyncComponentProps>
    | undefined,
)

const componentEnabled = computed(() => networkSyncComponent.value?.enabled !== false)

const localValues = reactive({
  leaseMs: '',
  sendIntervalMs: '',
  teleportThreshold: '',
})

watch(
  () => networkSyncComponent.value?.props,
  (props) => {
    localValues.leaseMs = props?.leaseMs?.toString() ?? ''
    localValues.sendIntervalMs = props?.sendIntervalMs?.toString() ?? ''
    localValues.teleportThreshold = props?.teleportThreshold?.toString() ?? ''
  },
  { immediate: true, deep: true },
)

function updateComponentProps(next: Partial<NetworkSyncComponentProps>) {
  const component = networkSyncComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, next)
}

function handleToggleComponent() {
  const component = networkSyncComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = networkSyncComponent.value
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

function handleLeaseMsChange(value: string) {
  localValues.leaseMs = value
  const parsed = parseNumber(value)
  if (parsed !== null) {
    updateComponentProps({ leaseMs: parsed })
  }
}

function handleSendIntervalChange(value: string) {
  localValues.sendIntervalMs = value
  if (!String(value).trim().length) {
    updateComponentProps({ sendIntervalMs: null })
    return
  }
  const parsed = parseNumber(value)
  if (parsed !== null) {
    updateComponentProps({ sendIntervalMs: parsed })
  }
}

function handleTeleportThresholdChange(value: string) {
  localValues.teleportThreshold = value
  const parsed = parseNumber(value)
  if (parsed !== null) {
    updateComponentProps({ teleportThreshold: parsed })
  }
}
</script>

<template>
  <v-expansion-panel value="networkSync">
    <v-expansion-panel-title>
      <div class="network-sync-panel__header">
        <span class="network-sync-panel__title">Node Sync</span>
        <v-spacer />
        <v-menu
          v-if="networkSyncComponent"
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
      <div class="network-sync-settings">
        <v-switch
          label="Sync Position"
          density="compact"
          hide-details
          color="primary"
          :model-value="networkSyncComponent?.props.syncPosition"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => updateComponentProps({ syncPosition: value === true })"
        />
        <v-switch
          label="Sync Rotation"
          density="compact"
          hide-details
          color="primary"
          :model-value="networkSyncComponent?.props.syncRotation"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => updateComponentProps({ syncRotation: value === true })"
        />
        <v-switch
          label="Sync Scale"
          density="compact"
          hide-details
          color="primary"
          :model-value="networkSyncComponent?.props.syncScale"
          :disabled="!componentEnabled"
          @update:modelValue="(value) => updateComponentProps({ syncScale: value === true })"
        />
        <v-text-field
          label="Lease (ms)"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.leaseMs"
          :disabled="!componentEnabled"
          @update:modelValue="handleLeaseMsChange"
        />
        <v-text-field
          label="Send Interval (ms)"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :placeholder="'inherit online sync interval'"
          :model-value="localValues.sendIntervalMs"
          :disabled="!componentEnabled"
          @update:modelValue="handleSendIntervalChange"
        />
        <v-text-field
          label="Teleport Threshold"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.teleportThreshold"
          :disabled="!componentEnabled"
          @update:modelValue="handleTeleportThresholdChange"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.network-sync-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.network-sync-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.network-sync-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.5rem;
}
</style>
