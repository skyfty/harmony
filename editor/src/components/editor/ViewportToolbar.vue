<template>
  <div class="viewport-toolbar">
    <v-card class="toolbar-card" elevation="6">

      <v-btn
        v-for="tool in buildToolButtons"
        :key="tool.id"
        :icon="tool.icon"
        density="compact"
        size="small"
        class="toolbar-button"
        :color="activeBuildTool === tool.id ? 'primary' : undefined"
        :variant="activeBuildTool === tool.id ? 'flat' : 'text'"
        :title="tool.label"
        @click="handleBuildToolToggle(tool.id)"
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-camera-outline"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Capture Screenshot"
        @click="emit('capture-screenshot')"
      />
      <v-btn
        icon="mdi-group"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="分组选中"
        :disabled="selectionCount < 2"
        @click="handleGroupSelection"
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-arrow-collapse-down"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
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
        color="undefined"
        variant="text"
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

      <SkyboxPresetSelector
        :skybox-settings="skyboxSettings"
        :skybox-presets="skyboxPresets"
        :shadows-enabled="shadowsEnabled"
        @select-skybox-preset="emit('select-skybox-preset', $event)"
        @change-skybox-parameter="emit('change-skybox-parameter', $event)"
        @change-shadows-enabled="emit('change-shadows-enabled', $event)"
      />
      <v-divider vertical />

      <v-btn
        icon="mdi-rotate-left"
        density="compact"
        color="undefined"
        variant="text"
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
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Orbit Right"
        @mousedown="handleOrbitRightStart"
        @mouseup="handleOrbitStop"
        @mouseleave="handleOrbitStop"
        @touchstart="handleOrbitRightStart"
        @touchend="handleOrbitStop"
        @click.prevent
      />
      <v-btn
        :icon="cameraControlModeIcon"
 
        color="undefined"
        variant="text"
        density="compact"
        size="small"
        class="toolbar-button"
        :title="cameraModeTitle"
        @click="emit('toggle-camera-control')"
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-camera"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Reset to Default View"
        @click="emit('reset-camera')"
      />
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue'
import type { SceneSkyboxSettings } from '@harmony/schema'
import type { SkyboxParameterKey, SkyboxPresetDefinition } from '@/types/skybox'
import type { AlignMode } from '@/types/scene-viewport-align-mode'
import { useSceneStore } from '@/stores/sceneStore'
import type { BuildTool } from '@/types/build-tool'
import SkyboxPresetSelector from '@/components/common/SkyboxPresetSelector.vue'

const props = defineProps<{
  showGrid: boolean
  showAxes: boolean
  cameraMode: 'perspective' | 'orthographic'
  canDropSelection: boolean
  canAlignSelection: boolean
  skyboxSettings: SceneSkyboxSettings
  cameraControlMode: 'orbit' | 'map'
  skyboxPresets: SkyboxPresetDefinition[]
  activeBuildTool: BuildTool | null
  shadowsEnabled: boolean
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
  (event: 'toggle-camera-control'): void
  (event: 'change-build-tool', tool: BuildTool | null): void
  (event: 'change-shadows-enabled', enabled: boolean): void
}>()

const {
  showGrid,
  showAxes,
  canDropSelection,
  canAlignSelection,
  skyboxSettings,
  skyboxPresets,
  cameraControlMode,
  activeBuildTool,
  shadowsEnabled,
} = toRefs(props)
const sceneStore = useSceneStore()

const selectionCount = computed(() => (sceneStore.selectedNodeIds ? sceneStore.selectedNodeIds.length : 0))

function handleGroupSelection() {
  if ((selectionCount.value ?? 0) < 2) return
  // call the store action to group selected nodes
  const result = sceneStore.groupSelection()
  if (!result) {
    // grouping failed or invalid selection
    return
  }
}

let orbitIntervalId: number | null = null
const ORBIT_INTERVAL_MS = 50
const ORBIT_INITIAL_DELAY_MS = 300

const alignButtons = [
  { mode: 'axis-x', icon: 'mdi-axis-x-arrow', title: 'Align X Axis' },
  { mode: 'axis-y', icon: 'mdi-axis-y-arrow', title: 'Align Y Axis' },
  { mode: 'axis-z', icon: 'mdi-axis-z-arrow', title: 'Align Z Axis' },
] satisfies Array<{ mode: AlignMode; icon: string; title: string }>
const buildToolButtons = [
  { id: 'ground', icon: 'mdi-terrain', label: 'Ground Tool' },
  { id: 'wall', icon: 'mdi-wall', label: 'Wall Tool' },
  { id: 'platform', icon: 'mdi-layers-triple', label: 'Platform Tool' },
] satisfies Array<{ id: BuildTool; icon: string; label: string }>

const cameraModeTitle = computed(() =>
  cameraControlMode.value === 'orbit'
    ? 'Switch to Map Camera Controls'
    : 'Switch to Orbit Camera Controls',
)

const cameraControlModeIcon = computed(() =>
  cameraControlMode.value === 'orbit' ? 'mdi-orbit' : 'mdi-map',
)

function emitAlign(mode: AlignMode) {
  emit('align-selection', mode)
}

function handleBuildToolToggle(tool: BuildTool) {
  const next = activeBuildTool.value === tool ? null : tool
  emit('change-build-tool', next)
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
  position: relative;
}

.toolbar-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  background-color: rgba(18, 21, 26, 0.64);
  border-radius: 12px;
  padding: 6px 8px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(77, 208, 225, 0.25);
}

.toolbar-button {
  border-radius: 3px;
  min-width: 22px;
  height: 22px;
}

</style>
