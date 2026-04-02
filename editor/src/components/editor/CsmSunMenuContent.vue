<template>
  <div class="popup-menu-card__content csm-sun-menu__content">
    <v-switch
      :model-value="csmEnabled"
      density="compact"
      hide-details
      color="primary"
      label="Enable CSM"
      @update:model-value="(value) => emit('update:csm-enabled', Boolean(value))"
    />
    <v-switch
      :model-value="csmShadowEnabled"
      density="compact"
      hide-details
      color="primary"
      label="启用阴影"
      @update:model-value="(value) => emit('update:csm-shadow-enabled', Boolean(value))"
    />
    <div class="csm-sun-grid">
      <v-text-field
        v-model="csmLightColorInput"
        label="Light Color"
        density="compact"
        variant="underlined"
        hide-details
        @blur="commitCsmLightColorInput"
        @keydown.enter.prevent="commitCsmLightColorInput"
      />
      <v-text-field
        v-model="csmLightIntensityInput"
        type="number"
        min="0"
        max="16"
        step="0.05"
        label="Intensity"
        density="compact"
        variant="underlined"
        hide-details
        @blur="commitCsmLightIntensityInput"
        @keydown.enter.prevent="commitCsmLightIntensityInput"
      />
      <v-text-field
        v-model="csmSunAzimuthDegInput"
        type="number"
        min="-180"
        max="180"
        step="1"
        label="Azimuth (deg)"
        density="compact"
        variant="underlined"
        hide-details
        @blur="commitCsmSunAzimuthDegInput"
        @keydown.enter.prevent="commitCsmSunAzimuthDegInput"
      />
      <v-text-field
        v-model="csmSunElevationDegInput"
        type="number"
        min="-10"
        max="89"
        step="1"
        label="Elevation (deg)"
        density="compact"
        variant="underlined"
        hide-details
        @blur="commitCsmSunElevationDegInput"
        @keydown.enter.prevent="commitCsmSunElevationDegInput"
      />
      <v-select
        v-model="csmCascadesInput"
        :items="csmCascadeOptions"
        item-title="label"
        item-value="value"
        label="Cascades"
        density="compact"
        variant="underlined"
        hide-details
        @update:model-value="commitCsmCascadesInput"
      />
      <v-text-field
        v-model="csmMaxFarInput"
        type="number"
        min="1"
        max="10000"
        step="10"
        label="Max Far"
        density="compact"
        variant="underlined"
        hide-details
        @blur="commitCsmMaxFarInput"
        @keydown.enter.prevent="commitCsmMaxFarInput"
      />
      <v-select
        v-model="csmShadowMapSizeInput"
        :items="csmShadowMapSizeOptions"
        item-title="label"
        item-value="value"
        label="Shadow Map"
        density="compact"
        variant="underlined"
        hide-details
        @update:model-value="commitCsmShadowMapSizeInput"
      />
      <v-text-field
        v-model="csmShadowBiasInput"
        type="number"
        min="-0.01"
        max="0.01"
        step="0.00005"
        label="Shadow Bias"
        density="compact"
        variant="underlined"
        hide-details
        @blur="commitCsmShadowBiasInput"
        @keydown.enter.prevent="commitCsmShadowBiasInput"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  csmEnabled: boolean
  csmShadowEnabled: boolean
  csmLightColor: string
  csmLightIntensity: number
  csmSunAzimuthDeg: number
  csmSunElevationDeg: number
  csmCascades: number
  csmMaxFar: number
  csmShadowMapSize: number
  csmShadowBias: number
}>()

const emit = defineEmits<{
  (event: 'update:csm-enabled', value: boolean): void
  (event: 'update:csm-shadow-enabled', value: boolean): void
  (event: 'update:csm-light-color', value: string): void
  (event: 'update:csm-light-intensity', value: number): void
  (event: 'update:csm-sun-azimuth-deg', value: number): void
  (event: 'update:csm-sun-elevation-deg', value: number): void
  (event: 'update:csm-cascades', value: number): void
  (event: 'update:csm-max-far', value: number): void
  (event: 'update:csm-shadow-map-size', value: number): void
  (event: 'update:csm-shadow-bias', value: number): void
}>()

const csmCascadeOptions: Array<{ value: number; label: string }> = [
  { value: 1, label: '1 (fast)' },
  { value: 2, label: '2' },
  { value: 3, label: '3 (recommended)' },
  { value: 4, label: '4 (high quality)' },
  { value: 5, label: '5' },
  { value: 6, label: '6 (max)' },
]

const csmShadowMapSizeOptions: Array<{ value: number; label: string }> = [
  { value: 256, label: '256' },
  { value: 512, label: '512' },
  { value: 1024, label: '1024 (recommended)' },
  { value: 2048, label: '2048 (high quality)' },
  { value: 4096, label: '4096 (very high)' },
  { value: 8192, label: '8192 (extreme)' },
]

const csmLightColorInput = ref(props.csmLightColor)
const csmLightIntensityInput = ref(props.csmLightIntensity)
const csmSunAzimuthDegInput = ref(props.csmSunAzimuthDeg)
const csmSunElevationDegInput = ref(props.csmSunElevationDeg)
const csmCascadesInput = ref(props.csmCascades)
const csmMaxFarInput = ref(props.csmMaxFar)
const csmShadowMapSizeInput = ref(props.csmShadowMapSize)
const csmShadowBiasInput = ref(props.csmShadowBias)

watch(() => props.csmLightColor, (value) => {
  csmLightColorInput.value = value
})

watch(() => props.csmLightIntensity, (value) => {
  csmLightIntensityInput.value = value
})

watch(() => props.csmSunAzimuthDeg, (value) => {
  csmSunAzimuthDegInput.value = value
})

watch(() => props.csmSunElevationDeg, (value) => {
  csmSunElevationDegInput.value = value
})

watch(() => props.csmCascades, (value) => {
  csmCascadesInput.value = value
})

watch(() => props.csmMaxFar, (value) => {
  csmMaxFarInput.value = value
})

watch(() => props.csmShadowMapSize, (value) => {
  csmShadowMapSizeInput.value = value
})

watch(() => props.csmShadowBias, (value) => {
  csmShadowBiasInput.value = value
})

function commitCsmLightColorInput() {
  emit('update:csm-light-color', String(csmLightColorInput.value ?? ''))
  nextTick(() => {
    csmLightColorInput.value = props.csmLightColor
  })
}

function commitCsmLightIntensityInput() {
  emit('update:csm-light-intensity', Number(csmLightIntensityInput.value))
  nextTick(() => {
    csmLightIntensityInput.value = props.csmLightIntensity
  })
}

function commitCsmSunAzimuthDegInput() {
  emit('update:csm-sun-azimuth-deg', Number(csmSunAzimuthDegInput.value))
  nextTick(() => {
    csmSunAzimuthDegInput.value = props.csmSunAzimuthDeg
  })
}

function commitCsmSunElevationDegInput() {
  emit('update:csm-sun-elevation-deg', Number(csmSunElevationDegInput.value))
  nextTick(() => {
    csmSunElevationDegInput.value = props.csmSunElevationDeg
  })
}

function commitCsmCascadesInput() {
  emit('update:csm-cascades', Number(csmCascadesInput.value))
  nextTick(() => {
    csmCascadesInput.value = props.csmCascades
  })
}

function commitCsmMaxFarInput() {
  emit('update:csm-max-far', Number(csmMaxFarInput.value))
  nextTick(() => {
    csmMaxFarInput.value = props.csmMaxFar
  })
}

function commitCsmShadowMapSizeInput() {
  emit('update:csm-shadow-map-size', Number(csmShadowMapSizeInput.value))
  nextTick(() => {
    csmShadowMapSizeInput.value = props.csmShadowMapSize
  })
}

function commitCsmShadowBiasInput() {
  emit('update:csm-shadow-bias', Number(csmShadowBiasInput.value))
  nextTick(() => {
    csmShadowBiasInput.value = props.csmShadowBias
  })
}
</script>

<style scoped>
.popup-menu-card__content {
    margin: 5px;
}
.csm-sun-menu__content {
  padding: 8px 10px 10px;
}

.csm-sun-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
</style>