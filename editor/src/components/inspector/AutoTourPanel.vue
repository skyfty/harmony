<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import NodePicker from '@/components/common/NodePicker.vue'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  type AutoTourComponentProps,
  clampAutoTourComponentProps,
  DEFAULT_AUTO_TOUR_SPEED_MPS,
  MIN_AUTO_TOUR_SPEED_MPS,
  MAX_AUTO_TOUR_SPEED_MPS,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const autoTourComponent = computed(() =>
  selectedNode.value?.components?.[AUTO_TOUR_COMPONENT_TYPE] as
    | SceneNodeComponentState<AutoTourComponentProps>
    | undefined,
)

const componentEnabled = computed(() => autoTourComponent.value?.enabled !== false)

const normalizedProps = computed(() => {
  const props = autoTourComponent.value?.props as Partial<AutoTourComponentProps> | undefined
  return clampAutoTourComponentProps(props ?? null)
})

const localRouteNodeId = ref<string | null>(null)
const localSpeedMps = ref(DEFAULT_AUTO_TOUR_SPEED_MPS)
const localLoop = ref(false)
const localAlignToPath = ref(true)

watch(
  () => normalizedProps.value,
  (props) => {
    localRouteNodeId.value = props.routeNodeId
    localSpeedMps.value = props.speedMps
    localLoop.value = props.loop
    localAlignToPath.value = props.alignToPath
  },
  { immediate: true, deep: true },
)

function updateComponent(patch: Partial<AutoTourComponentProps>): void {
  const component = autoTourComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch)
}

function handleRouteNodeChange(value: string | null) {
  localRouteNodeId.value = value
  if (value === normalizedProps.value.routeNodeId) {
    return
  }
  updateComponent({ routeNodeId: value })
}

function handleSpeedInput(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = clampAutoTourComponentProps({ speedMps: numeric }).speedMps
  localSpeedMps.value = clamped
  if (Math.abs(clamped - normalizedProps.value.speedMps) <= 1e-4) {
    return
  }
  updateComponent({ speedMps: clamped })
}

function handleLoopChange(value: boolean | null) {
  if (value === null) {
    return
  }
  localLoop.value = value
  if (value === normalizedProps.value.loop) {
    return
  }
  updateComponent({ loop: value })
}

function handleAlignToPathChange(value: boolean | null) {
  if (value === null) {
    return
  }
  localAlignToPath.value = value
  if (value === normalizedProps.value.alignToPath) {
    return
  }
  updateComponent({ alignToPath: value })
}

function handleToggleComponent() {
  const component = autoTourComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = autoTourComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}
</script>

<template>
  <v-expansion-panel value="autoTour">
    <v-expansion-panel-title>
      <div class="auto-tour-panel-header">
        <span class="auto-tour-panel-title">Auto Tour</span>
        <v-spacer />
        <v-menu
          v-if="autoTourComponent"
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
      <div class="auto-tour-panel-body" :class="{ 'is-disabled': !componentEnabled }">
        <NodePicker
          :model-value="localRouteNodeId"
          :disabled="!componentEnabled"
          owner="behavior-target"
          pick-hint="选择导览线路节点 (GuideRoute)"
          placeholder="未选择导览线路"
          @update:model-value="handleRouteNodeChange"
        />

        <v-text-field
          label="Speed (m/s)"
          type="number"
          density="compact"
          variant="solo"
          hide-details
          :min="MIN_AUTO_TOUR_SPEED_MPS"
          :max="MAX_AUTO_TOUR_SPEED_MPS"
          :model-value="localSpeedMps"
          :disabled="!componentEnabled"
          @update:modelValue="handleSpeedInput"
        />

        <v-switch
          label="Loop"
          density="compact"
          hide-details
          :model-value="localLoop"
          :disabled="!componentEnabled"
          @update:model-value="handleLoopChange"
        />

        <v-switch
          label="Align To Path"
          density="compact"
          hide-details
          :model-value="localAlignToPath"
          :disabled="!componentEnabled"
          @update:model-value="handleAlignToPathChange"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.auto-tour-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.auto-tour-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.auto-tour-panel-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.auto-tour-panel-body.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
