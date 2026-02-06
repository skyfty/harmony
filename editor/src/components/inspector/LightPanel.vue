<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { LightNodeProperties, LightNodeType } from '@schema/index'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const props = defineProps<{ disabled?: boolean }>()

const lightForm = reactive({
  color: '#ffffff',
  groundColor: '#444444',
  intensity: 1,
  distance: 50,
  decay: 1,
  angle: 30,
  penumbra: 0.3,
  width: 10,
  height: 10,
  targetX: 0,
  targetY: 0,
  targetZ: 0,
  castShadow: false,
})

const lightType = computed<LightNodeType | null>(() => selectedNode.value?.light?.type ?? null)
const nodeVisible = computed(() => selectedNode.value?.visible ?? true)
const supportsDistance = computed(() => lightType.value === 'Point' || lightType.value === 'Spot')
const supportsAngle = computed(() => lightType.value === 'Spot')
const supportsShadow = computed(() => lightType.value === 'Directional' || lightType.value === 'Point' || lightType.value === 'Spot')
const supportsTarget = computed(() => lightType.value === 'Directional' || lightType.value === 'Spot')
const supportsGroundColor = computed(() => lightType.value === 'Hemisphere')
const supportsRectSize = computed(() => lightType.value === 'RectArea')

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

function coerceNumber(value: number | number[]): number | null {
  const numeric = Array.isArray(value) ? value[0] : value
  if (typeof numeric !== 'number' || Number.isNaN(numeric)) {
    return null
  }
  return numeric
}

function patchLight(properties: Partial<LightNodeProperties>) {
  const id = selectedNodeId.value
  if (!id || props.disabled || !selectedNode.value?.light) {
    return
  }
  sceneStore.updateLightProperties(id, properties)
}

function setEnabled(enabled: boolean) {
  const id = selectedNodeId.value
  if (!id || props.disabled) {
    return
  }
  sceneStore.setNodeVisibility(id, enabled)
}

watch(
  selectedNode,
  (node) => {
    if (!node?.light) {
      return
    }
    const light = node.light
    lightForm.color = light.color ?? '#ffffff'
    lightForm.groundColor = (light as any).groundColor ?? '#444444'
    lightForm.intensity = light.intensity ?? 1
    lightForm.distance = light.distance ?? 50
    lightForm.decay = light.decay ?? 1
    lightForm.width = (light as any).width ?? 10
    lightForm.height = (light as any).height ?? 10
    lightForm.castShadow = light.castShadow ?? false

    if ((light.type === 'Directional' || light.type === 'Spot') && light.target) {
      lightForm.targetX = light.target.x
      lightForm.targetY = light.target.y
      lightForm.targetZ = light.target.z
    } else {
      lightForm.targetX = 0
      lightForm.targetY = 0
      lightForm.targetZ = 0
    }

    if (light.type === 'Spot') {
      lightForm.angle = toDegrees(light.angle ?? Math.PI / 6)
      lightForm.penumbra = light.penumbra ?? 0.3
    } else {
      lightForm.angle = 30
      lightForm.penumbra = light.penumbra ?? 0.3
    }
  },
  { immediate: true },
)

function handleColorInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  lightForm.color = value
  patchLight({ color: value })
}

function handleGroundColorInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  lightForm.groundColor = value
  patchLight({ groundColor: value } as any)
}

function handleIntensityChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  lightForm.intensity = numeric
  patchLight({ intensity: numeric })
}

function handleDistanceChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  lightForm.distance = numeric
  patchLight({ distance: numeric })
}

function handleDecayChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  lightForm.decay = numeric
  patchLight({ decay: numeric })
}

function handleAngleChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  const clamped = Math.max(1, Math.min(90, numeric))
  lightForm.angle = clamped
  patchLight({ angle: toRadians(clamped) })
}

function handlePenumbraChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  const clamped = Math.max(0, Math.min(1, numeric))
  lightForm.penumbra = clamped
  patchLight({ penumbra: clamped })
}

function handleCastShadowChange(value: boolean | null) {
  const normalized = Boolean(value)
  lightForm.castShadow = normalized
  patchLight({ castShadow: normalized })
}

function handleRectWidthChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  const clamped = Math.max(0, numeric)
  lightForm.width = clamped
  patchLight({ width: clamped } as any)
}

function handleRectHeightChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  const clamped = Math.max(0, numeric)
  lightForm.height = clamped
  patchLight({ height: clamped } as any)
}

function patchTarget() {
  if (!supportsTarget.value) {
    return
  }
  patchLight({
    target: {
      x: Number(lightForm.targetX) || 0,
      y: Number(lightForm.targetY) || 0,
      z: Number(lightForm.targetZ) || 0,
    },
  })
}
</script>

<template>
  <v-expansion-panel value="light">
    <v-expansion-panel-title>Light</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="section-block material-row">
        <span class="row-label">Enabled</span>
        <v-switch
          :model-value="nodeVisible"
          density="compact"
          hide-details
          size="small"
          color="primary"
          :disabled="props.disabled || !selectedNodeId"
          @update:model-value="setEnabled(Boolean($event))"
        />
      </div>
      <div class="section-block material-row">
        <span class="row-label">Color</span>
        <input
          class="color-input"
          type="color"
          :value="lightForm.color"
          :disabled="props.disabled"
          @input="handleColorInput"
        />
      </div>
      <div v-if="supportsGroundColor" class="section-block material-row">
        <span class="row-label">Ground</span>
        <input
          class="color-input"
          type="color"
          :value="lightForm.groundColor"
          :disabled="props.disabled"
          @input="handleGroundColorInput"
        />
      </div>
      <div class="section-block material-row">
        <span class="row-label">Intensity</span>
        <div class="row-controls">
          <v-slider
            :model-value="lightForm.intensity"
            min="0"
            max="10"
            step="0.05"
            hide-details
            class="slider"
            size="small"
            :disabled="props.disabled"
            @update:model-value="handleIntensityChange"
          />
          <div class="slider-value">{{ lightForm.intensity.toFixed(2) }}</div>
        </div>
      </div>
      <template v-if="supportsRectSize">
        <div class="section-block material-row">
          <span class="row-label">Width</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.width"
              min="0"
              max="50"
              step="0.5"
              hide-details
              class="slider"
              size="small"
              :disabled="props.disabled"
              @update:model-value="handleRectWidthChange"
            />
            <div class="slider-value">{{ lightForm.width.toFixed(1) }}</div>
          </div>
        </div>
        <div class="section-block material-row">
          <span class="row-label">Height</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.height"
              min="0"
              max="50"
              step="0.5"
              hide-details
              class="slider"
              size="small"
              :disabled="props.disabled"
              @update:model-value="handleRectHeightChange"
            />
            <div class="slider-value">{{ lightForm.height.toFixed(1) }}</div>
          </div>
        </div>
      </template>
      <template v-if="supportsDistance">
        <div class="section-block material-row">
          <span class="row-label">Distance</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.distance"
              min="0"
              max="200"
              step="1"
              hide-details
              class="slider"
              size="small"
              :disabled="props.disabled"
              @update:model-value="handleDistanceChange"
            />
            <div class="slider-value">{{ Math.round(lightForm.distance) }}</div>
          </div>
        </div>
        <div class="section-block material-row">
          <span class="row-label">Decay</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.decay"
              min="0"
              max="4"
              step="0.1"
              hide-details
              class="slider"
              size="small"
              :disabled="props.disabled"
              @update:model-value="handleDecayChange"
            />
            <div class="slider-value">{{ lightForm.decay.toFixed(1) }}</div>
          </div>
        </div>
      </template>
      <template v-if="supportsTarget">
        <div class="section-block material-row">
          <span class="row-label">Target</span>
          <div class="row-controls">
            <v-text-field
              :model-value="lightForm.targetX"
              type="number"
              density="compact"
              hide-details
              style="width: 70px"
              :disabled="props.disabled"
              @update:model-value="(v) => { lightForm.targetX = Number(v) || 0; patchTarget() }"
            />
            <v-text-field
              :model-value="lightForm.targetY"
              type="number"
              density="compact"
              hide-details
              style="width: 70px"
              :disabled="props.disabled"
              @update:model-value="(v) => { lightForm.targetY = Number(v) || 0; patchTarget() }"
            />
            <v-text-field
              :model-value="lightForm.targetZ"
              type="number"
              density="compact"
              hide-details
              style="width: 70px"
              :disabled="props.disabled"
              @update:model-value="(v) => { lightForm.targetZ = Number(v) || 0; patchTarget() }"
            />
          </div>
        </div>
      </template>
      <template v-if="supportsAngle">
        <div class="section-block material-row">
          <span class="row-label">Angle</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.angle"
              min="1"
              max="90"
              step="1"
              hide-details
              size="small"
              class="slider"
              :disabled="props.disabled"
              @update:model-value="handleAngleChange"
            />
            <div class="slider-value">{{ Math.round(lightForm.angle) }}°</div>
          </div>
        </div>
        <div class="section-block material-row">
          <span class="row-label">Penumbra</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.penumbra"
              min="0"
              max="1"
              step="0.05"
              hide-details
              size="small"
              class="slider"
              :disabled="props.disabled"
              @update:model-value="handlePenumbraChange"
            />
            <div class="slider-value">{{ lightForm.penumbra.toFixed(2) }}</div>
          </div>
        </div>
      </template>
      <div v-if="supportsShadow" class="section-block material-row">
        <span class="row-label">Cast Shadow</span>
        <v-switch
          :model-value="lightForm.castShadow"
          density="compact"
          hide-details
          size="small"
          color="primary"
          :disabled="props.disabled"
          @update:model-value="handleCastShadowChange"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.section-block {
  margin-bottom: 0.4rem;
}

.section-block:last-of-type {
  margin-bottom: 0;
}

.material-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.row-label {
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  color: rgba(233, 236, 241, 0.86);
}

.row-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.color-input {
  width: 48px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.color-input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.slider {
  width: 140px;
}

.slider-value {
  width: 48px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgba(233, 236, 241, 0.72);
}
</style>
