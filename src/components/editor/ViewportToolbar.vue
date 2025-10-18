<template>
  <div class="viewport-toolbar">
    <v-card class="toolbar-card" elevation="6">
      <v-btn
        icon="mdi-camera-outline"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Capture Screenshot"
        @click="emit('capture-screenshot')"
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-arrow-collapse-down"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Drop to Ground"
        :disabled="!canDropSelection"
        @click="emit('drop-to-ground')"
      />
      <v-btn
        v-for="button in alignButtons"
        :key="button.mode"
        :icon="button.icon"
        density="compact"
        size="small"
        class="toolbar-button"
        :disabled="!canAlignSelection"
        :title="button.title"
        @click="emitAlign(button.mode)"
      />
      <v-divider vertical />
      <v-btn
        :icon="showGrid ? 'mdi-grid' : 'mdi-grid-off'"
        :color="showGrid ? 'primary' : undefined"
        :variant="showGrid ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Toggle Grid"
        @click="toggleGridVisibility"
      />
      <v-btn
        :icon="showAxes ? 'mdi-axis-arrow-info' : 'mdi-axis-arrow'"
        :color="showAxes ? 'primary' : undefined"
        :variant="showAxes ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Toggle Axes"
        @click="toggleAxesVisibility"
      />
      <v-menu
        v-model="skyboxMenuOpen"
        location="bottom"
        origin="top right"
        offset="8"
        :close-on-content-click="false"
      >
        <template #activator="{ props: menuActivatorProps }">
          <v-btn
            v-bind="menuActivatorProps"
            icon="mdi-weather-partly-cloudy"
            density="compact"
            size="small"
            class="toolbar-button"
            :color="skyboxMenuOpen ? 'primary' : undefined"
            :variant="skyboxMenuOpen ? 'flat' : 'text'"
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
                variant="outlined"
                class="skybox-select"
                @update:modelValue="handlePresetSelect"
              />
            </div>
            <div class="skybox-section">
              <div class="skybox-section-header">Parameter Adjustments</div>
              <div
                v-for="control in skyboxParameterDefinitions"
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
      <v-divider vertical />
      <v-btn
        density="compact"
        size="small"
        class="toolbar-button camera-control-button"
        :title="cameraControlMode === 'orbit' ? '切换到建筑模式控制' : '切换到轨道模式控制'"
        @click="sceneStore.toggleViewportCameraControl()"
      >
        <div class="camera-control-button-icons">
          <v-icon
            size="16"
            :class="['camera-control-icon', { 'is-active': cameraControlMode === 'orbit' }]"
          >
            mdi-orbit-variant
          </v-icon>
          <v-icon
            size="16"
            :class="['camera-control-icon', { 'is-active': cameraControlMode === 'building' }]"
          >
            mdi-city-variant-outline
          </v-icon>
        </div>
      </v-btn>
      <v-btn
        icon="mdi-rotate-left"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Orbit Left"
        @mousedown="handleOrbitLeftStart"
        @mouseup="handleOrbitStop"
        @mouseleave="handleOrbitStop"
        @touchstart="handleOrbitLeftStart"
        @touchend="handleOrbitStop"
        @click.prevent
      />
      <v-btn
        icon="mdi-rotate-right"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Orbit Right"
        @mousedown="handleOrbitRightStart"
        @mouseup="handleOrbitStop"
        @mouseleave="handleOrbitStop"
        @touchstart="handleOrbitRightStart"
        @touchend="handleOrbitStop"
        @click.prevent
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-camera"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Reset to Default View"
        @click="emit('reset-camera')"
      />
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import type { CameraControlMode, SceneSkyboxSettings } from '@/types/scene-viewport-settings'
import type { SkyboxParameterKey, SkyboxPresetDefinition } from '@/types/skybox'
import type { AlignMode } from '@/types/scene-viewport-align-mode'
import { CUSTOM_SKYBOX_PRESET_ID, cloneSkyboxSettings } from '@/stores/skyboxPresets'
import { useSceneStore } from '@/stores/sceneStore'

const props = defineProps<{
  showGrid: boolean
  showAxes: boolean
  cameraMode: 'perspective' | 'orthographic'
  cameraControlMode: CameraControlMode
  canDropSelection: boolean
  canAlignSelection: boolean
  skyboxSettings: SceneSkyboxSettings
  skyboxPresets: SkyboxPresetDefinition[]
}>()

const emit = defineEmits<{
  (event: 'reset-camera'): void
  (event: 'drop-to-ground'): void
  (event: 'select-skybox-preset', presetId: string): void
  (event: 'change-skybox-parameter', payload: { key: SkyboxParameterKey; value: number }): void
  (event: 'align-selection', mode: AlignMode): void
  (event: 'capture-screenshot'): void
  (event: 'orbit-left'): void
  (event: 'orbit-right'): void
}>()

const { showGrid, showAxes, canDropSelection, canAlignSelection, skyboxSettings, skyboxPresets, cameraControlMode } = toRefs(props)
const sceneStore = useSceneStore()

const skyboxMenuOpen = ref(false)
const localSkyboxSettings = ref<SceneSkyboxSettings>(cloneSkyboxSettings(skyboxSettings.value))

let orbitIntervalId: number | null = null
const ORBIT_INTERVAL_MS = 50
const ORBIT_INITIAL_DELAY_MS = 300

watch(skyboxSettings, (next) => {
  localSkyboxSettings.value = cloneSkyboxSettings(next)
})

const presetOptions = computed(() => [
  ...skyboxPresets.value.map((preset) => ({
    title: preset.name,
    value: preset.id,
  })),
  { title: 'Custom', value: CUSTOM_SKYBOX_PRESET_ID },
])

const alignButtons = [
  { mode: 'axis-x', icon: 'mdi-axis-x-arrow', title: 'Align X Axis' },
  { mode: 'axis-y', icon: 'mdi-axis-y-arrow', title: 'Align Y Axis' },
  { mode: 'axis-z', icon: 'mdi-axis-z-arrow', title: 'Align Z Axis' },
] satisfies Array<{ mode: AlignMode; icon: string; title: string }>
const skyboxParameterDefinitions = [
  { key: 'exposure', label: 'Exposure', min: 0.05, max: 2, step: 0.01 },
  { key: 'turbidity', label: 'Turbidity', min: 1, max: 20, step: 0.1 },
  { key: 'rayleigh', label: 'Rayleigh Scattering', min: 0, max: 5, step: 0.05 },
  { key: 'mieCoefficient', label: 'Mie Coefficient', min: 0, max: 0.05, step: 0.0005 },
  { key: 'mieDirectionalG', label: 'Mie Directionality', min: 0, max: 1, step: 0.01 },
  { key: 'elevation', label: 'Sun Elevation', min: -10, max: 90, step: 1 },
  { key: 'azimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1 },
] satisfies Array<{ key: SkyboxParameterKey; label: string; min: number; max: number; step: number }>

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
  const config = skyboxParameterDefinitions.find((entry) => entry.key === key)
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

function emitAlign(mode: AlignMode) {
  emit('align-selection', mode)
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

function toggleGridVisibility() {
  sceneStore.toggleViewportGridVisible()
}

function toggleAxesVisibility() {
  sceneStore.toggleViewportAxesVisible()
}

function handleOrbitLeftStart(event: MouseEvent | TouchEvent) {
  event.preventDefault()
  stopOrbitRotation()
  
  // Immediate single rotation
  emit('orbit-left')
  
  // Start continuous rotation after delay
  const timeoutId = window.setTimeout(() => {
    orbitIntervalId = window.setInterval(() => {
      emit('orbit-left')
    }, ORBIT_INTERVAL_MS)
  }, ORBIT_INITIAL_DELAY_MS)
  
  orbitIntervalId = timeoutId as unknown as number
}

function handleOrbitRightStart(event: MouseEvent | TouchEvent) {
  event.preventDefault()
  stopOrbitRotation()
  
  // Immediate single rotation
  emit('orbit-right')
  
  // Start continuous rotation after delay
  const timeoutId = window.setTimeout(() => {
    orbitIntervalId = window.setInterval(() => {
      emit('orbit-right')
    }, ORBIT_INTERVAL_MS)
  }, ORBIT_INITIAL_DELAY_MS)
  
  orbitIntervalId = timeoutId as unknown as number
}

function handleOrbitStop() {
  stopOrbitRotation()
}

function stopOrbitRotation() {
  if (orbitIntervalId !== null) {
    window.clearTimeout(orbitIntervalId)
    window.clearInterval(orbitIntervalId)
    orbitIntervalId = null
  }
}
</script>

<style scoped>
.viewport-toolbar {
  position: absolute;
  top: 3px;
  right: 3px;
  z-index: 5;
}

.toolbar-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  background-color: rgba(18, 21, 26, 0.48);
  border-radius: 12px;
  padding: 6px 8px;
  backdrop-filter: blur(6px);
  border: 1px solid rgba(77, 208, 225, 0.25);
}

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

.camera-control-button {
  padding: 0 2px;
}

.camera-control-button-icons {
  display: flex;
  align-items: center;
  gap: 2px;
}

.camera-control-icon {
  opacity: 0.45;
  color: rgba(255, 255, 255, 0.72);
  transition: opacity 120ms ease, color 120ms ease;
}

.camera-control-icon.is-active {
  opacity: 1;
  color: #4dd0e1;
}
</style>
