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
</script>

<template>
  <v-expansion-panel value="autoTour">
    <v-expansion-panel-title>
      <div class="auto-tour-panel-header">
        <span class="auto-tour-panel-title">Auto Tour</span>
        <v-spacer />
      </div>
    </v-expansion-panel-title>

    <v-expansion-panel-text>
      <div class="auto-tour-panel-body">
        <NodePicker
          :model-value="localRouteNodeId"
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
          @update:modelValue="handleSpeedInput"
        />

        <v-switch
          label="Loop"
          density="compact"
          inset
          hide-details
          :model-value="localLoop"
          @update:model-value="handleLoopChange"
        />

        <v-switch
          label="Align To Path"
          density="compact"
          inset
          hide-details
          :model-value="localAlignToPath"
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
</style>
