<template>
  <v-menu
    v-model="menuOpen"
    location="bottom"
    origin="top right"
    offset="8"
    transition="null"
    :close-on-content-click="false"
  >
    <template #activator="{ props: menuActivatorProps }">
      <v-btn
        v-bind="menuActivatorProps"
        icon="mdi-weather-partly-cloudy"
        density="compact"
        size="small"
        class="toolbar-button"
        :color="menuOpen ? 'primary' : undefined"
        :variant="menuOpen ? 'flat' : 'text'"
        title="Skybox Settings"
      />
    </template>
    <v-card class="skybox-card" elevation="8">
      <v-card-text class="skybox-card-content">
        <div class="skybox-section">
          <div class="skybox-section-header">Skybox Presets</div>
          <v-select
            :items="presetOptions"
            :model-value="skyboxSettings.presetId"
            density="compact"
            hide-details
            transition="null"
            variant="underlined"
            class="skybox-select"
            @update:modelValue="handlePresetSelect"
          />
          <v-checkbox
            class="skybox-switch"
            inset
            density="compact"
            hide-details
            color="primary"
            size="small"
            :model-value="shadowsEnabled"
            label="Enable Shadows"
            @update:modelValue="handleShadowToggle"
          />
        </div>
        <div class="skybox-section">
          <div class="skybox-section-header">Parameter Adjustments</div>
          <div
            v-for="control in parameterDefinitions"
            :key="control.key"
            class="skybox-slider"
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
              @update:modelValue="(value) => handleSliderInput(control.key, value as number)"
            />
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import type { SkyboxParameterKey, SkyboxPresetDefinition } from '@/types/skybox'
import { CUSTOM_SKYBOX_PRESET_ID, cloneSkyboxSettings } from '@/stores/skyboxPresets'
import  {type SceneSkyboxSettings } from '@harmony/scene-schema'

const parameterDefinitions = [
  { key: 'exposure', label: 'Exposure', min: 0.05, max: 2, step: 0.01 },
  { key: 'turbidity', label: 'Turbidity', min: 1, max: 20, step: 0.1 },
  { key: 'rayleigh', label: 'Rayleigh Scattering', min: 0, max: 5, step: 0.05 },
  { key: 'mieCoefficient', label: 'Mie Coefficient', min: 0, max: 0.05, step: 0.0005 },
  { key: 'mieDirectionalG', label: 'Mie Directionality', min: 0, max: 1, step: 0.01 },
  { key: 'elevation', label: 'Sun Elevation', min: -10, max: 90, step: 1 },
  { key: 'azimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1 },
] satisfies Array<{ key: SkyboxParameterKey; label: string; min: number; max: number; step: number }>

const props = defineProps<{
  skyboxSettings: SceneSkyboxSettings
  skyboxPresets: SkyboxPresetDefinition[]
  shadowsEnabled: boolean
}>()

const { skyboxSettings, skyboxPresets, shadowsEnabled } = toRefs(props)

const emit = defineEmits<{
  (event: 'select-skybox-preset', presetId: string): void
  (event: 'change-skybox-parameter', payload: { key: SkyboxParameterKey; value: number }): void
  (event: 'change-shadows-enabled', enabled: boolean): void
}>()

const menuOpen = ref(false)
const localSkyboxSettings = ref<SceneSkyboxSettings>(cloneSkyboxSettings(skyboxSettings.value))

watch(
  skyboxSettings,
  (next) => {
    localSkyboxSettings.value = cloneSkyboxSettings(next)
  },
)

const presetOptions = computed(() => [
  ...skyboxPresets.value.map((preset) => ({
    title: preset.name,
    value: preset.id,
  })),
  { title: 'Custom', value: CUSTOM_SKYBOX_PRESET_ID },
])

function handlePresetSelect(value: string) {
  if (!value || value === CUSTOM_SKYBOX_PRESET_ID) {
    return
  }
  emit('select-skybox-preset', value)
}

function handleSliderInput(key: SkyboxParameterKey, value: number) {
  if (Number.isNaN(value)) {
    return
  }
  const config = parameterDefinitions.find((entry) => entry.key === key)
  if (!config) {
    return
  }
  const clamped = Math.min(config.max, Math.max(config.min, value))
  localSkyboxSettings.value = {
    ...localSkyboxSettings.value,
    [key]: clamped,
  }
  emit('change-skybox-parameter', { key, value: clamped })
}

const handleShadowToggle = (value: boolean | null) => {
  emit('change-shadows-enabled', Boolean(value))
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

<style scoped>
.toolbar-button {
  border-radius: 3px;
  min-width: 22px;
  height: 22px;
}

.skybox-card {
  min-width: 280px;
  background-color: rgba(18, 21, 26, 0.94);
  border-radius: 12px;
  border: 1px solid rgba(77, 208, 225, 0.25);
}

.skybox-card-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
}

.skybox-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skybox-section-header {
  font-size: 12px;
  font-weight: 600;
  color: #9fb5c7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.skybox-select {
  width: 100%;
}

.skybox-switch {
  margin-top: -4px;
}

.skybox-slider {
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
