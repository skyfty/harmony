<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@harmony/schema'
import {
  FLOOR_COMPONENT_TYPE,
  FLOOR_DEFAULT_SMOOTH,
  FLOOR_DEFAULT_THICKNESS,
  FLOOR_MAX_THICKNESS,
  FLOOR_MIN_THICKNESS,
  FLOOR_DEFAULT_SIDE_UV_SCALE,
} from '@schema/components'
import type { FloorComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const floorComponent = computed(() => {
  const component = selectedNode.value?.components?.[FLOOR_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<FloorComponentProps>
})

const localSmooth = ref(FLOOR_DEFAULT_SMOOTH)
const localThickness = ref(FLOOR_DEFAULT_THICKNESS)
const localSideUvU = ref(FLOOR_DEFAULT_SIDE_UV_SCALE.x)
const localSideUvV = ref(FLOOR_DEFAULT_SIDE_UV_SCALE.y)
const isSyncingFromScene = ref(false)

watch(
  floorComponent,
  (component) => {
    isSyncingFromScene.value = true
    if (!component) {
      localSmooth.value = FLOOR_DEFAULT_SMOOTH
      localThickness.value = FLOOR_DEFAULT_THICKNESS
      localSideUvU.value = FLOOR_DEFAULT_SIDE_UV_SCALE.x
      localSideUvV.value = FLOOR_DEFAULT_SIDE_UV_SCALE.y
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }

    const smooth = Number.isFinite(component.props.smooth) ? component.props.smooth : FLOOR_DEFAULT_SMOOTH
    localSmooth.value = smooth

    const thickness = Number.isFinite(component.props.thickness) ? component.props.thickness : FLOOR_DEFAULT_THICKNESS
    localThickness.value = thickness

    const sideU = Number.isFinite(component.props.sideUvScale?.x)
      ? Number(component.props.sideUvScale.x)
      : FLOOR_DEFAULT_SIDE_UV_SCALE.x
    const sideV = Number.isFinite(component.props.sideUvScale?.y)
      ? Number(component.props.sideUvScale.y)
      : FLOOR_DEFAULT_SIDE_UV_SCALE.y
    localSideUvU.value = sideU
    localSideUvV.value = sideV
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true }
)

const smoothDisplay = computed(() => `${Math.round(localSmooth.value * 100)}%`)

function applySmoothUpdate(rawValue: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = floorComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(1, Math.max(0, value))
  const currentSmooth = Number.isFinite(component.props.smooth)
    ? component.props.smooth
    : FLOOR_DEFAULT_SMOOTH
  if (Math.abs(currentSmooth - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { smooth: clamped })
}

function applyThicknessUpdate() {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = floorComponent.value
  if (!nodeId || !component) {
    return
  }
  const value = Number(localThickness.value)
  if (!Number.isFinite(value)) {
    return
  }
  const clamped = Math.min(FLOOR_MAX_THICKNESS, Math.max(FLOOR_MIN_THICKNESS, value))
  if (localThickness.value !== clamped) {
    localThickness.value = clamped
  }
  const current = Number.isFinite(component.props.thickness) ? component.props.thickness : FLOOR_DEFAULT_THICKNESS
  if (Math.abs(current - clamped) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { thickness: clamped })
}

function applySideUvUpdate() {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = floorComponent.value
  if (!nodeId || !component) {
    return
  }
  const u = Number(localSideUvU.value)
  const v = Number(localSideUvV.value)
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    return
  }
  const nextU = Math.max(0, u)
  const nextV = Math.max(0, v)
  if (localSideUvU.value !== nextU) {
    localSideUvU.value = nextU
  }
  if (localSideUvV.value !== nextV) {
    localSideUvV.value = nextV
  }

  const currentU = Number.isFinite(component.props.sideUvScale?.x)
    ? Number(component.props.sideUvScale.x)
    : FLOOR_DEFAULT_SIDE_UV_SCALE.x
  const currentV = Number.isFinite(component.props.sideUvScale?.y)
    ? Number(component.props.sideUvScale.y)
    : FLOOR_DEFAULT_SIDE_UV_SCALE.y

  if (Math.abs(currentU - nextU) <= 1e-6 && Math.abs(currentV - nextV) <= 1e-6) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, { sideUvScale: { x: nextU, y: nextV } })
}
</script>

<template>
  <v-expansion-panel value="floor">
    <v-expansion-panel-title>
      <div class="floor-panel-header">
        <span class="floor-panel-title">Floor</span>
        <v-spacer />
        <span class="floor-panel-subtitle">{{ smoothDisplay }}</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="floor-field-grid">
        <div class="floor-field-labels">
          <span>Corner Smoothness</span>
          <span>{{ smoothDisplay }}</span>
        </div>
        <v-slider
          :model-value="localSmooth"
          :min="0"
          :max="1"
          :step="0.01"
          density="compact"
          track-color="rgba(77, 208, 225, 0.4)"
          color="primary"
          @update:modelValue="(value) => { localSmooth = Number(value); applySmoothUpdate(value) }"
        />

        <v-text-field
          v-model.number="localThickness"
          label="Thickness (m)"
          type="number"
          density="compact"
          variant="underlined"
          class="slider-input"
          inputmode="decimal"
          :min="FLOOR_MIN_THICKNESS"
          :max="FLOOR_MAX_THICKNESS"
          step="0.05"
          @update:modelValue="(value) => { localThickness = Number(value); applyThicknessUpdate() }"
          @blur="applyThicknessUpdate"
          @keydown.enter.prevent="applyThicknessUpdate"
        />

        <div class="floor-uv-grid">
          <v-text-field
            v-model.number="localSideUvU"
            label="Side UV Repeat U (/m)"
            type="number"
            density="compact"
            variant="underlined"
            class="slider-input"
            inputmode="decimal"
            min="0"
            step="0.1"
            @blur="applySideUvUpdate"
            @keydown.enter.prevent="applySideUvUpdate"
          />
          <v-text-field
            v-model.number="localSideUvV"
            label="Side UV Repeat V (/m)"
            type="number"
            density="compact"
            variant="underlined"
            class="slider-input"
            inputmode="decimal"
            min="0"
            step="0.1"
            @blur="applySideUvUpdate"
            @keydown.enter.prevent="applySideUvUpdate"
          />
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.floor-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.floor-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.floor-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
}

.floor-field-grid {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.floor-uv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.floor-field-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  opacity: 0.75;
}
</style>
