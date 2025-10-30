<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { LightNodeProperties, LightNodeType } from '@harmony/scene-schema'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const props = defineProps<{ disabled?: boolean }>()

const lightForm = reactive({
  color: '#ffffff',
  intensity: 1,
  distance: 50,
  decay: 1,
  angle: 30,
  penumbra: 0.3,
  castShadow: false,
})

const lightType = computed<LightNodeType | null>(() => selectedNode.value?.light?.type ?? null)
const supportsDistance = computed(() => lightType.value === 'Point' || lightType.value === 'Spot')
const supportsAngle = computed(() => lightType.value === 'Spot')
const supportsShadow = computed(() => lightType.value !== 'Ambient')

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
  if (!id || props.disabled) {
    return
  }
  sceneStore.updateLightProperties(id, properties)
}

watch(
  selectedNode,
  (node) => {
    if (!node?.light) {
      return
    }
    const light = node.light
    lightForm.color = light.color ?? '#ffffff'
    lightForm.intensity = light.intensity ?? 1
    lightForm.distance = light.distance ?? 50
    lightForm.decay = light.decay ?? 1
    lightForm.castShadow = light.castShadow ?? false

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
</script>

<template>
  <v-expansion-panel value="light">
    <v-expansion-panel-title>Light</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="section-block material-row">
        <span class="row-label">Color</span>
  <input class="color-input" type="color" :value="lightForm.color" :disabled="props.disabled" @input="handleColorInput" />
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
          inset
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
