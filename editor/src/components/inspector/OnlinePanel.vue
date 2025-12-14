<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { ONLINE_COMPONENT_TYPE, type OnlineComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const onlineComponent = computed(
  () => selectedNode.value?.components?.[ONLINE_COMPONENT_TYPE] as
    | SceneNodeComponentState<OnlineComponentProps>
    | undefined,
)

const componentEnabled = computed(() => onlineComponent.value?.enabled !== false)

const localValues = reactive({
  server: '',
  port: '',
  maxUsers: '',
  syncInterval: '',
})

watch(
  () => onlineComponent.value?.props,
  (props) => {
    localValues.server = props?.server ?? ''
    localValues.port = props?.port?.toString() ?? ''
    localValues.maxUsers = props?.maxUsers?.toString() ?? ''
    localValues.syncInterval = props?.syncInterval?.toString() ?? ''
  },
  { immediate: true, deep: true },
)

function updateComponentProps(next: Partial<OnlineComponentProps>) {
  const component = onlineComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, next)
}

function handleToggleComponent() {
  const component = onlineComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = onlineComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function parseInteger(value: string | number): number | null {
  const candidate = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(candidate)) {
    return null
  }
  return Math.round(candidate)
}

function handleServerChange(value: string) {
  localValues.server = value
  updateComponentProps({ server: value.trim() })
}

function handlePortChange(value: string) {
  localValues.port = value
  const parsed = parseInteger(value)
  if (parsed !== null) {
    updateComponentProps({ port: parsed })
  }
}

function handleMaxUsersChange(value: string) {
  localValues.maxUsers = value
  const parsed = parseInteger(value)
  if (parsed !== null) {
    updateComponentProps({ maxUsers: parsed })
  }
}

function handleSyncIntervalChange(value: string) {
  localValues.syncInterval = value
  const parsed = parseInteger(value)
  if (parsed !== null) {
    updateComponentProps({ syncInterval: parsed })
  }
}
</script>

<template>
  <v-expansion-panel value="online">
    <v-expansion-panel-title>
      <div class="online-panel__header">
        <span class="online-panel__title">Multiuser</span>
        <v-spacer />
        <v-menu
          v-if="onlineComponent"
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
      <div class="online-settings">
        <v-text-field
          label="Server"
          density="compact"
          variant="underlined"
          hide-details
          :model-value="localValues.server"
          :disabled="!componentEnabled"
          @update:modelValue="handleServerChange"
        />
        <v-text-field
          label="Port"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.port"
          :disabled="!componentEnabled"
          @update:modelValue="handlePortChange"
        />
        <v-text-field
          label="Max Users"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.maxUsers"
          :disabled="!componentEnabled"
          @update:modelValue="handleMaxUsersChange"
        />
        <v-text-field
          label="Sync Interval (ms)"
          density="compact"
          variant="underlined"
          hide-details
          type="number"
          :model-value="localValues.syncInterval"
          :disabled="!componentEnabled"
          @update:modelValue="handleSyncIntervalChange"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.online-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.online-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.online-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.5rem;
}
</style>
