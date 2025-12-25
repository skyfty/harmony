<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { RoadDynamicMesh } from '@harmony/schema'
import type { SceneNodeComponentState } from '@harmony/schema'
import { ROAD_COMPONENT_TYPE, ROAD_DEFAULT_JUNCTION_SMOOTHING } from '@schema/components'
import type { RoadComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const roadDynamicMesh = computed(() => {
  const mesh = selectedNode.value?.dynamicMesh
  if (!mesh || mesh.type !== 'Road') {
    return null
  }
  return mesh as RoadDynamicMesh
})

const roadComponent = computed(() => {
  const component = selectedNode.value?.components?.[ROAD_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<RoadComponentProps>
})

const localWidth = ref<number>(2)
const localJunctionSmoothing = ref<number>(ROAD_DEFAULT_JUNCTION_SMOOTHING)
const localLaneLines = ref<boolean>(false)
const localShoulders = ref<boolean>(false)
const isSyncingFromScene = ref(false)

watch(
  () => roadDynamicMesh.value,
  (mesh) => {
    isSyncingFromScene.value = true
    if (!mesh) {
      localWidth.value = 2
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    const width = Number((mesh as RoadDynamicMesh).width)
    localWidth.value = Number.isFinite(width) ? Math.max(0.2, width) : 2
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true, deep: false },
)

watch(
  roadComponent,
  (component) => {
    isSyncingFromScene.value = true
    if (!component) {
      localJunctionSmoothing.value = ROAD_DEFAULT_JUNCTION_SMOOTHING
      localLaneLines.value = false
      localShoulders.value = false
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    const raw = component.props?.junctionSmoothing
    const value = typeof raw === 'number' ? raw : Number(raw)
    localJunctionSmoothing.value = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : ROAD_DEFAULT_JUNCTION_SMOOTHING
    localLaneLines.value = Boolean(component.props?.laneLines)
    localShoulders.value = Boolean(component.props?.shoulders)

    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true },
)

function applyLaneLinesUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextState = Boolean(rawValue)
  if (component.props.laneLines === nextState) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { laneLines: nextState })
}

function applyShouldersUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextState = Boolean(rawValue)
  if (component.props.shoulders === nextState) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { shoulders: nextState })
}

const junctionSmoothingDisplay = computed(() => `${Math.round(localJunctionSmoothing.value * 100)}%`)

function applyJunctionSmoothingUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(1, Math.max(0, value))
  const current = typeof component.props?.junctionSmoothing === 'number'
    ? component.props.junctionSmoothing
    : ROAD_DEFAULT_JUNCTION_SMOOTHING
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { junctionSmoothing: clamped })
}

function applyWidthUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const mesh = roadDynamicMesh.value
  if (!nodeId || !mesh) {
    return
  }

  const nextWidth = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(nextWidth)) {
    return
  }

  const clamped = Math.max(0.2, nextWidth)
  const currentWidth = Number(mesh.width)
  if (Number.isFinite(currentWidth) && Math.abs(currentWidth - clamped) < 1e-6) {
    return
  }

  const nextMesh = JSON.parse(JSON.stringify(mesh)) as RoadDynamicMesh
  nextMesh.width = clamped
  sceneStore.updateNodeDynamicMesh(nodeId, nextMesh)
}

</script>

<template>
  <v-expansion-panel value="road">
    <v-expansion-panel-title>
      <div class="road-panel-header">
        <span class="road-panel-title">Road</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="road-field-grid">
        <div class="road-field-labels">
          <span>Junction Smoothness</span>
          <span>{{ junctionSmoothingDisplay }}</span>
        </div>
        <v-slider
          :model-value="localJunctionSmoothing"
          :min="0"
          :max="1"
          :step="0.01"
          density="compact"
          track-color="rgba(77, 208, 225, 0.4)"
          color="primary"
          @update:modelValue="(value) => { localJunctionSmoothing = Number(value); applyJunctionSmoothingUpdate(value) }"
        />

        <v-text-field
          :model-value="localWidth"
          type="number"
          label="Width (m)"
          density="compact"
          variant="underlined"
          min="0.2"
          step="0.1"
          @update:modelValue="(v) => { localWidth = Number(v); applyWidthUpdate(v) }"
        />
        <v-switch
          :model-value="localLaneLines"
          density="compact"
          label="Show Lane Lines"
          @update:modelValue="(value) => { const next = Boolean(value); localLaneLines = next; applyLaneLinesUpdate(next) }"
        />
        <v-switch
          :model-value="localShoulders"
          density="compact"
          label="Show Shoulders"
          @update:modelValue="(value) => { const next = Boolean(value); localShoulders = next; applyShouldersUpdate(next) }"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.road-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.road-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.road-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
}

.road-panel-empty {
  opacity: 0.8;
  font-size: 0.85rem;
}

.road-field-grid {
  display: grid;
  gap: 0.4rem;
}

.road-field-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  opacity: 0.9;
}
</style>
