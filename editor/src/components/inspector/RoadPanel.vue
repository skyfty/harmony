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
const localSamplingDensityFactor = ref<number>(1.0)
const localSmoothingStrengthFactor = ref<number>(1.0)
const localMinClearance = ref<number>(0.01)
const localLaneLineWidth = ref<number | undefined>(undefined)
const localShoulderWidth = ref<number | undefined>(undefined)
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
      localSamplingDensityFactor.value = 1.0
      localSmoothingStrengthFactor.value = 1.0
      localMinClearance.value = 0.01
      localLaneLineWidth.value = undefined
      localShoulderWidth.value = undefined
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

    const samplingDensityRaw = component.props?.samplingDensityFactor
    const samplingDensity = typeof samplingDensityRaw === 'number' ? samplingDensityRaw : Number(samplingDensityRaw)
    localSamplingDensityFactor.value = Number.isFinite(samplingDensity) ? Math.max(0.1, Math.min(5, samplingDensity)) : 1.0

    const smoothingStrengthRaw = component.props?.smoothingStrengthFactor
    const smoothingStrength = typeof smoothingStrengthRaw === 'number' ? smoothingStrengthRaw : Number(smoothingStrengthRaw)
    localSmoothingStrengthFactor.value = Number.isFinite(smoothingStrength) ? Math.max(0.1, Math.min(5, smoothingStrength)) : 1.0

    const minClearanceRaw = component.props?.minClearance
    const minClearance = typeof minClearanceRaw === 'number' ? minClearanceRaw : Number(minClearanceRaw)
    localMinClearance.value = Number.isFinite(minClearance) ? Math.max(0, Math.min(2, minClearance)) : 0.01

    const laneLineWidthRaw = component.props?.laneLineWidth
    const laneLineWidth = typeof laneLineWidthRaw === 'number' ? laneLineWidthRaw : Number(laneLineWidthRaw)
    localLaneLineWidth.value = Number.isFinite(laneLineWidth) && laneLineWidth > 0.01 ? laneLineWidth : undefined

    const shoulderWidthRaw = component.props?.shoulderWidth
    const shoulderWidth = typeof shoulderWidthRaw === 'number' ? shoulderWidthRaw : Number(shoulderWidthRaw)
    localShoulderWidth.value = Number.isFinite(shoulderWidth) && shoulderWidth > 0.01 ? shoulderWidth : undefined

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
const samplingDensityDisplay = computed(() => localSamplingDensityFactor.value.toFixed(2))
const smoothingStrengthDisplay = computed(() => localSmoothingStrengthFactor.value.toFixed(2))
const minClearanceDisplay = computed(() => `${(localMinClearance.value * 100).toFixed(1)} cm`)

function onJunctionSmoothingModelUpdate(value: unknown) {
  localJunctionSmoothing.value = Number(value)
  applyJunctionSmoothingUpdate(value)
}

function onWidthModelUpdate(v: unknown) {
  localWidth.value = Number(v)
  applyWidthUpdate(v)
}

function onLaneLinesModelUpdate(value: unknown) {
  const next = Boolean(value)
  localLaneLines.value = next
  applyLaneLinesUpdate(next)
}

function onShouldersModelUpdate(value: unknown) {
  const next = Boolean(value)
  localShoulders.value = next
  applyShouldersUpdate(next)
}

function onSamplingDensityModelUpdate(value: unknown) {
  localSamplingDensityFactor.value = Number(value)
  applySamplingDensityUpdate(value)
}

function onSmoothingStrengthModelUpdate(value: unknown) {
  localSmoothingStrengthFactor.value = Number(value)
  applySmoothingStrengthUpdate(value)
}

function onMinClearanceModelUpdate(value: unknown) {
  localMinClearance.value = Number(value)
  applyMinClearanceUpdate(value)
}

function onLaneLineWidthModelUpdate(v: unknown) {
  localLaneLineWidth.value = v ? Number(v) : undefined
  applyLaneLineWidthUpdate(v)
}

function onShoulderWidthModelUpdate(v: unknown) {
  localShoulderWidth.value = v ? Number(v) : undefined
  applyShoulderWidthUpdate(v)
}

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

  sceneStore.updateNodeDynamicMesh(nodeId, { width: clamped })
}

function applySamplingDensityUpdate(rawValue: unknown) {
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
  const clamped = Math.max(0.1, Math.min(5, value))
  const current = component.props?.samplingDensityFactor ?? 1.0
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { samplingDensityFactor: clamped })
}

function applySmoothingStrengthUpdate(rawValue: unknown) {
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
  const clamped = Math.max(0.1, Math.min(5, value))
  const current = component.props?.smoothingStrengthFactor ?? 1.0
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { smoothingStrengthFactor: clamped })
}

function applyMinClearanceUpdate(rawValue: unknown) {
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
  const clamped = Math.max(0, Math.min(2, value))
  const current = component.props?.minClearance ?? 0.01
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { minClearance: clamped })
}

function applyLaneLineWidthUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  const nextValue = Number.isFinite(value) && value > 0.01 ? Math.max(0.01, Math.min(1, value)) : undefined
  const currentRaw = component.props?.laneLineWidth
  const current = typeof currentRaw === 'number' ? currentRaw : Number(currentRaw)
  if (
    (nextValue === undefined && !Number.isFinite(current))
    || (nextValue !== undefined && Number.isFinite(current) && Math.abs(current - nextValue) <= 1e-6)
  ) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { laneLineWidth: nextValue })
}

function applyShoulderWidthUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = roadComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  const nextValue = Number.isFinite(value) && value > 0.01 ? Math.max(0.01, Math.min(2, value)) : undefined
  const currentRaw = component.props?.shoulderWidth
  const current = typeof currentRaw === 'number' ? currentRaw : Number(currentRaw)
  if (
    (nextValue === undefined && !Number.isFinite(current))
    || (nextValue !== undefined && Number.isFinite(current) && Math.abs(current - nextValue) <= 1e-6)
  ) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { shoulderWidth: nextValue })
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
          @update:modelValue="onJunctionSmoothingModelUpdate"
        />

        <v-text-field
          :model-value="localWidth"
          type="number"
          label="Width (m)"
          density="compact"
          variant="underlined"
          min="0.2"
          step="0.1"
          @update:modelValue="onWidthModelUpdate"
        />

        <v-switch
          :model-value="localLaneLines"
          density="compact"
          label="Show Lane Lines"
          @update:modelValue="onLaneLinesModelUpdate"
        />

        <v-switch
          :model-value="localShoulders"
          density="compact"
          label="Show Shoulders"
          @update:modelValue="onShouldersModelUpdate"
        />

        <v-divider class="my-2" />

        <div class="road-section-header">Terrain Adaptation</div>

        <div class="road-field-labels">
          <span>Sampling Density</span>
          <span>{{ samplingDensityDisplay }}</span>
        </div>
        <v-slider
          :model-value="localSamplingDensityFactor"
          :min="0.1"
          :max="5"
          :step="0.1"
          density="compact"
          track-color="rgba(77, 208, 225, 0.4)"
          color="primary"
          @update:modelValue="onSamplingDensityModelUpdate"
        />

        <div class="road-field-labels">
          <span>Smoothing Strength</span>
          <span>{{ smoothingStrengthDisplay }}</span>
        </div>
        <v-slider
          :model-value="localSmoothingStrengthFactor"
          :min="0.1"
          :max="5"
          :step="0.1"
          density="compact"
          track-color="rgba(77, 208, 225, 0.4)"
          color="primary"
          @update:modelValue="onSmoothingStrengthModelUpdate"
        />

        <div class="road-field-labels">
          <span>Min Clearance</span>
          <span>{{ minClearanceDisplay }}</span>
        </div>
        <v-slider
          :model-value="localMinClearance"
          :min="0"
          :max="2"
          :step="0.01"
          density="compact"
          track-color="rgba(77, 208, 225, 0.4)"
          color="primary"
          @update:modelValue="onMinClearanceModelUpdate"
        />

        <v-divider class="my-2" />

        <div class="road-section-header">Overlay Dimensions</div>

        <v-text-field
          :model-value="localLaneLineWidth"
          type="number"
          label="Lane Line Width (m)"
          density="compact"
          variant="underlined"
          min="0.01"
          max="1"
          step="0.01"
          placeholder="Auto"
          clearable
          @update:modelValue="onLaneLineWidthModelUpdate"
        />

        <v-text-field
          :model-value="localShoulderWidth"
          type="number"
          label="Shoulder Width (m)"
          density="compact"
          variant="underlined"
          min="0.01"
          max="2"
          step="0.01"
          placeholder="Auto"
          clearable
          @update:modelValue="onShoulderWidthModelUpdate"
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

.road-section-header {
  font-size: 0.9rem;
  font-weight: 600;
  opacity: 0.85;
  margin-top: 0.4rem;
  margin-bottom: 0.2rem;
}
</style>
