<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  EnvironmentBackgroundMode,
  EnvironmentMapMode,
  EnvironmentFogMode,
} from '@/types/environment'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'

const ASSET_DRAG_MIME = 'application/x-harmony-asset'

const sceneStore = useSceneStore()
const { environmentSettings: storeEnvironmentSettings } = storeToRefs(sceneStore)

const environmentSettings = computed(() => storeEnvironmentSettings.value)

const backgroundModeOptions: Array<{ title: string; value: EnvironmentBackgroundMode }> = [
  { title: 'Solid Color', value: 'solidColor' },
  { title: 'HDRI', value: 'hdri' },
]

const environmentMapModeOptions: Array<{ title: string; value: EnvironmentMapMode }> = [
  { title: 'Use Skybox', value: 'skybox' },
  { title: 'Custom HDRI', value: 'custom' },
]

const isBackgroundDropActive = ref(false)
const isEnvironmentDropActive = ref(false)

const isFogEnabled = computed(() => environmentSettings.value.fogMode === 'exp')

const backgroundAsset = computed(() => {
  const assetId = environmentSettings.value.background.hdriAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const environmentMapAsset = computed(() => {
  const assetId = environmentSettings.value.environmentMap.hdriAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const backgroundAssetLabel = computed(() => {
  const asset = backgroundAsset.value
  if (!asset) {
    return 'Drag HDRI asset here'
  }
  return asset.name?.trim().length ? asset.name : asset.id
})

const backgroundAssetHint = computed(() => {
  const asset = backgroundAsset.value
  if (!asset) {
    return 'Supports HDR (.hdr, .exr) or image textures'
  }
  return asset.id
})

const environmentAssetLabel = computed(() => {
  const asset = environmentMapAsset.value
  if (!asset) {
    return 'Drag HDRI asset here'
  }
  return asset.name?.trim().length ? asset.name : asset.id
})

const environmentAssetHint = computed(() => {
  const asset = environmentMapAsset.value
  if (!asset) {
    return 'Overrides skybox reflections when set'
  }
  return asset.id
})

function updateBackgroundMode(mode: EnvironmentBackgroundMode | null) {
  if (!mode || mode === environmentSettings.value.background.mode) {
    return
  }
  sceneStore.patchEnvironmentSettings({ background: { mode } })
}

function handleBackgroundColorInput(value: string) {
  if (!value || value === environmentSettings.value.background.solidColor) {
    return
  }
  sceneStore.patchEnvironmentSettings({ background: { solidColor: value } })
}

function clearBackgroundAsset() {
  if (!environmentSettings.value.background.hdriAssetId && environmentSettings.value.background.mode === 'solidColor') {
    return
  }
  sceneStore.patchEnvironmentSettings({ background: { mode: 'solidColor', hdriAssetId: null } })
}

function updateEnvironmentMapMode(mode: EnvironmentMapMode | null) {
  if (!mode || mode === environmentSettings.value.environmentMap.mode) {
    return
  }
  sceneStore.patchEnvironmentSettings({ environmentMap: { mode } })
}

function clearEnvironmentAsset() {
  if (environmentSettings.value.environmentMap.mode === 'skybox' && !environmentSettings.value.environmentMap.hdriAssetId) {
    return
  }
  sceneStore.patchEnvironmentSettings({ environmentMap: { mode: 'skybox', hdriAssetId: null } })
}

function handleAmbientColorInput(value: string) {
  if (!value || value === environmentSettings.value.ambientLightColor) {
    return
  }
  sceneStore.patchEnvironmentSettings({ ambientLightColor: value })
}

function handleAmbientIntensityChange(value: number | number[]) {
  const numeric = Array.isArray(value) ? value[0] : value
  if (typeof numeric !== 'number' || Number.isNaN(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(10, numeric))
  if (Math.abs(clamped - environmentSettings.value.ambientLightIntensity) < 1e-3) {
    return
  }
  sceneStore.patchEnvironmentSettings({ ambientLightIntensity: clamped })
}

function handleFogToggle(enabled: boolean | null) {
  const nextMode: EnvironmentFogMode = enabled ? 'exp' : 'none'
  if (nextMode === environmentSettings.value.fogMode) {
    return
  }
  sceneStore.patchEnvironmentSettings({ fogMode: nextMode })
}

function handleFogColorInput(value: string) {
  if (!value || value === environmentSettings.value.fogColor) {
    return
  }
  sceneStore.patchEnvironmentSettings({ fogColor: value })
}

function handleFogDensityChange(value: number | number[]) {
  const numeric = Array.isArray(value) ? value[0] : value
  if (typeof numeric !== 'number' || Number.isNaN(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(5, numeric))
  if (Math.abs(clamped - environmentSettings.value.fogDensity) < 1e-4) {
    return
  }
  sceneStore.patchEnvironmentSettings({ fogDensity: clamped })
}

function parseAssetDragPayload(event: DragEvent): { assetId: string } | null {
  if (event.dataTransfer) {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.assetId && typeof parsed.assetId === 'string') {
          return { assetId: parsed.assetId }
        }
      } catch (error) {
        console.warn('Failed to parse asset drag payload', error)
      }
    }
  }
  if (sceneStore.draggingAssetId) {
    return { assetId: sceneStore.draggingAssetId }
  }
  return null
}

function resolveDraggedAsset(event: DragEvent): ProjectAsset | null {
  const payload = parseAssetDragPayload(event)
  if (!payload) {
    return null
  }
  return sceneStore.getAsset(payload.assetId)
}

function inferAssetExtension(asset: ProjectAsset | null): string | null {
  if (!asset) {
    return null
  }
  const source = asset.name || asset.downloadUrl || asset.id
  const match = source?.match(/\.([a-z0-9]+)(?:$|[?#])/i)
  return match ? match[1]?.toLowerCase() ?? null : null
}

function isHdrExtension(extension: string | null): boolean {
  if (!extension) {
    return false
  }
  return extension === 'hdr' || extension === 'hdri' || extension === 'exr'
}

function isEnvironmentAsset(asset: ProjectAsset | null): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  if (asset.type === 'image' || asset.type === 'texture') {
    return true
  }
  if (asset.type === 'file') {
    return isHdrExtension(inferAssetExtension(asset))
  }
  return false
}

function handleBackgroundDragEnter(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isEnvironmentAsset(asset)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isBackgroundDropActive.value = true
}

function handleBackgroundDragOver(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isEnvironmentAsset(asset)) {
    if (isBackgroundDropActive.value) {
      isBackgroundDropActive.value = false
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isBackgroundDropActive.value = true
}

function handleBackgroundDragLeave(event: DragEvent) {
  if (!isBackgroundDropActive.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  isBackgroundDropActive.value = false
}

function handleEnvironmentDragEnter(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isEnvironmentAsset(asset)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isEnvironmentDropActive.value = true
}

function handleEnvironmentDragOver(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isEnvironmentAsset(asset)) {
    if (isEnvironmentDropActive.value) {
      isEnvironmentDropActive.value = false
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isEnvironmentDropActive.value = true
}

function handleEnvironmentDragLeave(event: DragEvent) {
  if (!isEnvironmentDropActive.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  isEnvironmentDropActive.value = false
}

function handleBackgroundDrop(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  isBackgroundDropActive.value = false
  if (!isEnvironmentAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  sceneStore.patchEnvironmentSettings({ background: { mode: 'hdri', hdriAssetId: asset.id } })
}

function handleEnvironmentDrop(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  isEnvironmentDropActive.value = false
  if (!isEnvironmentAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  sceneStore.patchEnvironmentSettings({ environmentMap: { mode: 'custom', hdriAssetId: asset.id } })
}
</script>

<template>
  <v-expansion-panel value="environment">
    <v-expansion-panel-title>
      Environment
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="environment-panel">
        <section class="environment-section">
          <div class="section-title">Background</div>
          <v-select
            :items="backgroundModeOptions"
            :model-value="environmentSettings.background.mode"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            @update:model-value="(mode) => updateBackgroundMode(mode as EnvironmentBackgroundMode | null)"
          />
          <div class="color-row">
            <span class="color-label">Solid Color</span>
            <div class="color-controls">
              <input
                class="color-input"
                type="color"
                :value="environmentSettings.background.solidColor"
                @input="(event) => handleBackgroundColorInput((event.target as HTMLInputElement).value)"
              >
              <span class="color-value">{{ environmentSettings.background.solidColor }}</span>
            </div>
          </div>
          <div
            class="asset-drop"
            :class="{
              'is-active': isBackgroundDropActive,
              'is-inactive': environmentSettings.background.mode !== 'hdri',
            }"
            @dragenter="handleBackgroundDragEnter"
            @dragover="handleBackgroundDragOver"
            @dragleave="handleBackgroundDragLeave"
            @drop="handleBackgroundDrop"
          >
            <div class="asset-drop__info">
              <div class="asset-drop__label">{{ backgroundAssetLabel }}</div>
              <div class="asset-drop__hint">{{ backgroundAssetHint }}</div>
            </div>
            <v-btn
              variant="text"
              size="small"
              class="asset-drop__action"
              :disabled="!backgroundAsset"
              @click.stop="clearBackgroundAsset"
            >
              Clear
            </v-btn>
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Ambient Light</div>
          <div class="color-row">
            <span class="color-label">Color</span>
            <div class="color-controls">
              <input
                class="color-input"
                type="color"
                :value="environmentSettings.ambientLightColor"
                @input="(event) => handleAmbientColorInput((event.target as HTMLInputElement).value)"
              >
              <span class="color-value">{{ environmentSettings.ambientLightColor }}</span>
            </div>
          </div>
          <div class="slider-row">
            <span class="slider-label">Intensity</span>
            <div class="slider-controls">
              <v-slider
                :model-value="environmentSettings.ambientLightIntensity"
                min="0"
                max="10"
                step="0.05"
                hide-details
                class="slider"
                size="small"
                @update:model-value="handleAmbientIntensityChange"
              />
              <span class="slider-value">{{ environmentSettings.ambientLightIntensity.toFixed(2) }}</span>
            </div>
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Fog</div>
          <div class="toggle-row">
            <span class="toggle-label">Enable Exponential Fog</span>
            <v-switch
              :model-value="isFogEnabled"
              density="compact"
              hide-details
              inset
              color="primary"
              size="small"
              @update:model-value="handleFogToggle"
            />
          </div>
          <div class="color-row" :class="{ 'is-disabled': !isFogEnabled }">
            <span class="color-label">Color</span>
            <div class="color-controls">
              <input
                class="color-input"
                type="color"
                :disabled="!isFogEnabled"
                :value="environmentSettings.fogColor"
                @input="(event) => handleFogColorInput((event.target as HTMLInputElement).value)"
              >
              <span class="color-value">{{ environmentSettings.fogColor }}</span>
            </div>
          </div>
          <div class="slider-row" :class="{ 'is-disabled': !isFogEnabled }">
            <span class="slider-label">Density</span>
            <div class="slider-controls">
              <v-slider
                :model-value="environmentSettings.fogDensity"
                min="0"
                max="1"
                step="0.005"
                hide-details
                class="slider"
                size="small"
                :disabled="!isFogEnabled"
                @update:model-value="handleFogDensityChange"
              />
              <span class="slider-value">{{ environmentSettings.fogDensity.toFixed(3) }}</span>
            </div>
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Environment Map</div>
          <v-select
            :items="environmentMapModeOptions"
            :model-value="environmentSettings.environmentMap.mode"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            @update:model-value="(mode) => updateEnvironmentMapMode(mode as EnvironmentMapMode | null)"
          />
          <div
            class="asset-drop"
            :class="{
              'is-active': isEnvironmentDropActive,
              'is-inactive': environmentSettings.environmentMap.mode !== 'custom',
            }"
            @dragenter="handleEnvironmentDragEnter"
            @dragover="handleEnvironmentDragOver"
            @dragleave="handleEnvironmentDragLeave"
            @drop="handleEnvironmentDrop"
          >
            <div class="asset-drop__info">
              <div class="asset-drop__label">{{ environmentAssetLabel }}</div>
              <div class="asset-drop__hint">{{ environmentAssetHint }}</div>
            </div>
            <v-btn
              variant="text"
              size="small"
              class="asset-drop__action"
              :disabled="environmentSettings.environmentMap.mode === 'skybox' && !environmentMapAsset"
              @click.stop="clearEnvironmentAsset"
            >
              Clear
            </v-btn>
          </div>
        </section>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.environment-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.environment-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(159, 181, 199, 0.9);
}

.section-select :deep(.v-field__input) {
  font-size: 0.82rem;
}

.color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.color-row.is-disabled {
  opacity: 0.5;
}

.color-label {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.82);
}

.color-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.color-input {
  width: 40px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.color-input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.color-value {
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: rgba(233, 236, 241, 0.7);
}

.slider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.slider-row.is-disabled {
  opacity: 0.5;
}

.slider-label {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.82);
}

.slider-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.slider {
  width: 160px;
}

.slider-value {
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: rgba(233, 236, 241, 0.7);
  min-width: 56px;
  text-align: right;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.toggle-label {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.82);
}

.asset-drop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 10px 12px;
  border: 1px dashed rgba(109, 132, 155, 0.6);
  border-radius: 8px;
  background: rgba(19, 32, 44, 0.45);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.asset-drop.is-active {
  border-color: #4dd0e1;
  background: rgba(77, 208, 225, 0.12);
}

.asset-drop.is-inactive {
  opacity: 0.7;
}

.asset-drop__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.asset-drop__label {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.86);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-drop__hint {
  font-size: 0.74rem;
  color: rgba(159, 181, 199, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-drop__action {
  flex-shrink: 0;
  color: rgba(178, 193, 209, 0.9);
}

.asset-drop__action:disabled {
  opacity: 0.5;
}
</style>
