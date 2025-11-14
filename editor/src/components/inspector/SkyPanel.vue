<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneSkyboxSettings } from '@harmony/schema'
import type { SkyboxParameterKey } from '@/types/skybox'
import { SKYBOX_PRESETS, CUSTOM_SKYBOX_PRESET_ID, cloneSkyboxSettings } from '@/stores/skyboxPresets'
import { useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { skybox } = storeToRefs(sceneStore)

const skyboxSettings = computed(() => skybox.value)

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
function onChange(key: SkyboxParameterKey, event: Event) {
  const value = (event.target as HTMLInputElement).value as unknown as number
  if (Number.isNaN(value)) {
    return
  }
  if (Math.abs(value - localSkyboxSettings.value[key]) < 1e-6) {
    return
  }
  localSkyboxSettings.value = {
    ...localSkyboxSettings.value,
    [key]: value,
  }
  sceneStore.setSkyboxSettings({ [key]: value } as Partial<SceneSkyboxSettings>, { markCustom: true })
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
        <div class="sky-slider">
          <div class="slider-label">
            <span>Exposure</span>
          </div>
          <v-text-field
            :model-value="localSkyboxSettings.exposure"
            :min="0.05"
            :max="2.00"
            :step="0.01"
            type="number"
            inputmode="decimal"
            density="compact"
            variant="underlined"
            hide-details
            color="primary"
            @change="onChange('exposure', $event)"
          />
        </div>
        <div class="sky-slider">
          <div class="slider-label">
            <span>Turbidity</span>
          </div>
          <v-text-field
            :model-value="localSkyboxSettings.turbidity"
            :min="1.00"
            :max="20.00"
            :step="0.1"
            type="number"
            inputmode="decimal"
            density="compact"
            variant="underlined"
            hide-details
            color="primary"
            @change="onChange('turbidity', $event)"
          />
        </div>
        <div class="sky-slider">
          <div class="slider-label">
            <span>Rayleigh Scattering</span>
          </div>
          <v-text-field
            :model-value="localSkyboxSettings.rayleigh"
            :min="0.00"
            :max="5.00"
            :step="0.05"
            type="number"
            inputmode="decimal"
            density="compact"
            variant="underlined"
            hide-details
            color="primary"
            @change="onChange('rayleigh', $event)"
          />
        </div>
        <div class="sky-slider">
          <div class="slider-label">
            <span>Mie Coefficient</span>
          </div>
          <v-text-field
            :model-value="localSkyboxSettings.mieCoefficient"
            :min="0.00"
            :max="0.05"
            :step="0.0005"
            type="number"
            inputmode="decimal"
            density="compact"
            variant="underlined"
            hide-details
            color="primary"
            @change="onChange('mieCoefficient', $event)"
          />
        </div>
        <div class="sky-slider">
          <div class="slider-label">
            <span>Mie Directionality</span>
          </div>
          <v-text-field
            :model-value="localSkyboxSettings.mieDirectionalG"
            :min="0"
            :max="1"
            :step="0.01"
            type="number"
            inputmode="decimal"
            density="compact"
            variant="underlined"
            hide-details
            color="primary"
            @change="onChange('mieDirectionalG', $event)"
          />
        </div>
        <div class="sky-slider">
          <div class="slider-label">
            <span>Sun Elevation</span>
          </div>
          <v-text-field
            :model-value="localSkyboxSettings.elevation"
            :min="-10"
            :max="90"
            :step="1"
            type="number"
            inputmode="numeric"
            density="compact"
            variant="underlined"
            hide-details
            color="primary"
            @change="onChange('elevation', $event)"
          />
        </div>
        <div class="sky-slider">
          <div class="slider-label">
            <span>Sun Azimuth</span>
          </div>
          <v-text-field
            :model-value="localSkyboxSettings.azimuth"
            :min="0"
            :max="360"
            :step="1"
            type="number"
            inputmode="numeric"
            density="compact"
            variant="underlined"
            hide-details
            color="primary"
            @change="onChange('azimuth', $event)"
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
