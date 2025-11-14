<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneSkyboxSettings } from '@harmony/schema'
import type { SkyboxParameterKey } from '@/types/skybox'
import { SKYBOX_PRESETS, CUSTOM_SKYBOX_PRESET_ID, cloneSkyboxSettings } from '@/stores/skyboxPresets'
import { useSceneStore } from '@/stores/sceneStore'

const parameterDefinitions = [
  { key: 'presetId', label: 'Preset' },
  { key: 'exposure', label: 'Exposure', min: 0.05, max: 2, step: 0.01 },
  { key: 'turbidity', label: 'Turbidity', min: 1, max: 20, step: 0.1 },
  { key: 'rayleigh', label: 'Rayleigh Scattering', min: 0, max: 5, step: 0.05 },
  { key: 'mieCoefficient', label: 'Mie Coefficient', min: 0, max: 0.05, step: 0.0005 },
  { key: 'mieDirectionalG', label: 'Mie Directionality', min: 0, max: 1, step: 0.01 },
  { key: 'elevation', label: 'Sun Elevation', min: -10, max: 90, step: 1 },
  { key: 'azimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1 },
] as const

type SliderDefinition = Extract<typeof parameterDefinitions[number], { key: SkyboxParameterKey }>

const sliderDefinitions: SliderDefinition[] = parameterDefinitions.filter(
  (entry): entry is SliderDefinition => entry.key !== 'presetId',
)

const sceneStore = useSceneStore()
const { viewportSettings } = storeToRefs(sceneStore)

const skyboxSettings = computed(() => viewportSettings.value.skybox)
const shadowsEnabled = computed(() => viewportSettings.value.shadowsEnabled)

const localSkyboxSettings = ref<SceneSkyboxSettings>(cloneSkyboxSettings(skyboxSettings.value))

watch(
  skyboxSettings,
  (next) => {
    localSkyboxSettings.value = cloneSkyboxSettings(next)
  },
  { immediate: true },
)

const presetOptions = computed(() => [
  ...SKYBOX_PRESETS.map((preset) => ({ title: preset.name, value: preset.id })),
  { title: 'Custom', value: CUSTOM_SKYBOX_PRESET_ID },
])

function handlePresetSelect(presetId: string | null) {
  if (!presetId || presetId === CUSTOM_SKYBOX_PRESET_ID) {
    return
  }
  sceneStore.applySkyboxPreset(presetId)
}

function handleSliderInput(key: SkyboxParameterKey, value: number) {
  if (Number.isNaN(value)) {
    return
  }
  const config = sliderDefinitions.find((entry) => entry.key === key)
  if (!config) {
    return
  }
  const clamped = Math.min(config.max, Math.max(config.min, value))
  if (Math.abs(clamped - localSkyboxSettings.value[key]) < 1e-6) {
    return
  }
  localSkyboxSettings.value = {
    ...localSkyboxSettings.value,
    [key]: clamped,
  }
  sceneStore.setSkyboxSettings({ [key]: clamped } as Partial<SceneSkyboxSettings>, { markCustom: true })
}

function handleShadowToggle(value: boolean | null) {
  sceneStore.setViewportShadowsEnabled(Boolean(value))
}

function formatSkyboxValue(key: SkyboxParameterKey, value: number): string {
  if (key === 'azimuth' || key === 'elevation') {
    return `${Math.round(value)}°`
  }
  if (key === 'mieCoefficient') {
    return value.toFixed(4)
  }
  if (key === 'mieDirectionalG' || key === 'exposure') {
    return value.toFixed(2)
  }
  return value.toFixed(2)
}
</script>

<template>
  <v-expansion-panel value="sky">
    <v-expansion-panel-title>
      Sky Settings
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="sky-panel">
        <div class="sky-section">
          <div class="section-label">Skybox Preset</div>
          <v-select
            :items="presetOptions"
            :model-value="localSkyboxSettings.presetId"
            density="compact"
            hide-details
            variant="underlined"
            class="sky-select"
            @update:model-value="handlePresetSelect"
          />
        </div>
        <v-checkbox
          class="sky-switch"
          inset
          density="compact"
          hide-details
          color="primary"
          size="small"
          :model-value="shadowsEnabled"
          label="Enable Shadows"
          @update:model-value="handleShadowToggle"
        />
        <div
          v-for="control in sliderDefinitions"
          :key="control.key"
          class="sky-slider"
        >
          <div class="slider-label">
            <span>{{ control.label }}</span>
            <span class="slider-value">{{ formatSkyboxValue(control.key, localSkyboxSettings[control.key]) }}</span>
          </div>
          <v-slider
            :model-value="localSkyboxSettings[control.key]"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="(value) => handleSliderInput(control.key, value as number)"
          />
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.sky-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sky-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #9fb5c7;
}

.sky-select {
  max-width: 240px;
}

.sky-switch {
  margin-top: -4px;
}

.sky-slider {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #cfd8e3;
}

.slider-value {
  color: #4dd0e1;
  font-variant-numeric: tabular-nums;
}
</style>
