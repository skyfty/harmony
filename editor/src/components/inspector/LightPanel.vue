<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { LightNodeProperties, LightNodeType, LightShadowProperties } from '@schema/index'

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

  shadowMapSize: 1024,
  shadowBias: 0,
  shadowNormalBias: 0,
  shadowRadius: 1,
  shadowCameraNear: 0.1,
  shadowCameraFar: 200,
  shadowOrthoSize: 20,
})

const shadowMapSizeOptions = [256, 512, 1024, 2048, 4096]

const lightType = computed<LightNodeType | null>(() => selectedNode.value?.light?.type ?? null)
const nodeVisible = computed(() => selectedNode.value?.visible ?? true)
const supportsDistance = computed(() => lightType.value === 'Point' || lightType.value === 'Spot')
const supportsAngle = computed(() => lightType.value === 'Spot')
const supportsShadow = computed(() => lightType.value === 'Directional' || lightType.value === 'Point' || lightType.value === 'Spot')
const supportsTarget = computed(() => lightType.value === 'Directional' || lightType.value === 'Spot')
const supportsGroundColor = computed(() => lightType.value === 'Hemisphere')

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

function patchShadow(properties: Partial<LightShadowProperties>) {
  patchLight({ shadow: properties })
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
    const shadow = light.shadow ?? {}
    lightForm.color = light.color ?? '#ffffff'
    lightForm.groundColor = (light as any).groundColor ?? '#444444'
    lightForm.intensity = light.intensity ?? 1
    lightForm.distance = light.distance ?? 50
    lightForm.decay = light.decay ?? 1
    lightForm.width = (light as any).width ?? 10
    lightForm.height = (light as any).height ?? 10
    lightForm.castShadow = light.castShadow ?? false

    const defaultMapSize = light.type === 'Directional' ? 2048 : light.type === 'Spot' ? 1024 : 512
    lightForm.shadowMapSize = (shadow.mapSize ?? defaultMapSize) as number
    lightForm.shadowBias = (shadow.bias ?? (light.type === 'Directional' ? -0.0002 : 0)) as number
    lightForm.shadowNormalBias = (shadow.normalBias ?? 0) as number
    lightForm.shadowRadius = (shadow.radius ?? 1) as number
    lightForm.shadowCameraNear = (shadow.cameraNear ?? 0.1) as number
    lightForm.shadowCameraFar = (shadow.cameraFar ?? 200) as number
    lightForm.shadowOrthoSize = (shadow.orthoSize ?? 20) as number

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

function handleShadowMapSizeChange(value: number | string | null) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric <= 0) {
    return
  }
  const size = Math.max(1, Math.round(numeric))
  lightForm.shadowMapSize = size
  patchShadow({ mapSize: size })
}

function handleShadowBiasChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  lightForm.shadowBias = numeric
  patchShadow({ bias: numeric })
}

function handleShadowNormalBiasChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  const clamped = Math.max(0, numeric)
  lightForm.shadowNormalBias = clamped
  patchShadow({ normalBias: clamped })
}

function handleShadowRadiusChange(value: number | number[]) {
  const numeric = coerceNumber(value)
  if (numeric === null) return
  const clamped = Math.max(0, numeric)
  lightForm.shadowRadius = clamped
  patchShadow({ radius: clamped })
}

function handleShadowNearChange(value: string | number) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric)) return
  const clamped = Math.max(0.001, numeric)
  lightForm.shadowCameraNear = clamped
  patchShadow({ cameraNear: clamped })
}

function handleShadowFarChange(value: string | number) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric)) return
  const clamped = Math.max(0.01, numeric)
  lightForm.shadowCameraFar = clamped
  patchShadow({ cameraFar: clamped })
}

function handleShadowOrthoSizeChange(value: string | number) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric)) return
  const clamped = Math.max(0.01, numeric)
  lightForm.shadowOrthoSize = clamped
  patchShadow({ orthoSize: clamped })
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
          color="primary"
          :disabled="props.disabled"
          @update:model-value="handleCastShadowChange"
        />
      </div>

      <template v-if="supportsShadow">
        <div class="section-block material-row">
          <span class="row-label">Shadow Map</span>
          <div class="row-controls">
            <v-select
              :items="shadowMapSizeOptions"
              :model-value="lightForm.shadowMapSize"
              density="compact"
      variant="underlined"
              hide-details
              style="width: 110px"
              :disabled="props.disabled || !lightForm.castShadow"
              @update:model-value="handleShadowMapSizeChange"
            />
          </div>
        </div>
        <div class="section-block material-row">
          <span class="row-label">Bias</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.shadowBias"
              min="-0.005"
              max="0.005"
              step="0.00005"
              hide-details
              class="slider"
              size="small"
              :disabled="props.disabled || !lightForm.castShadow"
              @update:model-value="handleShadowBiasChange"
            />
            <div class="slider-value">{{ lightForm.shadowBias.toFixed(5) }}</div>
          </div>
        </div>
        <div class="section-block material-row">
          <span class="row-label">Normal Bias</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.shadowNormalBias"
              min="0"
              max="0.2"
              step="0.001"
              hide-details
              class="slider"
              size="small"
              :disabled="props.disabled || !lightForm.castShadow"
              @update:model-value="handleShadowNormalBiasChange"
            />
            <div class="slider-value">{{ lightForm.shadowNormalBias.toFixed(3) }}</div>
          </div>
        </div>
        <div class="section-block material-row">
          <span class="row-label">Radius</span>
          <div class="row-controls">
            <v-slider
              :model-value="lightForm.shadowRadius"
              min="0"
              max="10"
              step="0.1"
              hide-details
              class="slider"
              size="small"
              :disabled="props.disabled || !lightForm.castShadow"
              @update:model-value="handleShadowRadiusChange"
            />
            <div class="slider-value">{{ lightForm.shadowRadius.toFixed(1) }}</div>
          </div>
        </div>
        <div class="section-block material-row">
          <span class="row-label">Near/Far</span>
          <div class="row-controls">
            <v-text-field
              :model-value="lightForm.shadowCameraNear"
              type="number"
              density="compact"
              hide-details
              style="width: 90px"
      variant="underlined"
              :disabled="props.disabled || !lightForm.castShadow"
              @update:model-value="handleShadowNearChange"
            />
            <v-text-field
              :model-value="lightForm.shadowCameraFar"
              type="number"
              density="compact"
      variant="underlined"
              hide-details
              style="width: 90px"
              :disabled="props.disabled || !lightForm.castShadow"
              @update:model-value="handleShadowFarChange"
            />
          </div>
        </div>
        <div v-if="lightType === 'Directional'" class="section-block material-row">
          <span class="row-label">Ortho Size</span>
          <div class="row-controls">
            <v-text-field
              :model-value="lightForm.shadowOrthoSize"
              type="number"
              density="compact"
              hide-details
      variant="underlined"
              style="width: 110px"
              :disabled="props.disabled || !lightForm.castShadow"
              @update:model-value="handleShadowOrthoSizeChange"
            />
          </div>
        </div>
      </template>
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
