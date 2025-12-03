<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  EnvironmentBackgroundMode,
  EnvironmentMapMode,
  EnvironmentFogMode,
} from '@/types/environment'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import AssetDialog from '@/components/common/AssetDialog.vue'

const ASSET_DRAG_MIME = 'application/x-harmony-asset'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { environmentSettings: storeEnvironmentSettings, shadowsEnabled } = storeToRefs(sceneStore)

const environmentSettings = computed(() => storeEnvironmentSettings.value)

const backgroundModeOptions: Array<{ title: string; value: EnvironmentBackgroundMode }> = [
  { title: 'Skybox', value: 'skybox' },
  { title: 'Solid Color', value: 'solidColor' },
  { title: 'HDRI', value: 'hdri' },
]

const environmentMapModeOptions: Array<{ title: string; value: EnvironmentMapMode }> = [
  { title: 'Use Skybox', value: 'skybox' },
  { title: 'Custom HDRI', value: 'custom' },
]

const backgroundColorMenuOpen = ref(false)
const ambientColorMenuOpen = ref(false)
const fogColorMenuOpen = ref(false)

const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const assetDialogTarget = ref<'background' | 'environment' | null>(null)

const HDRI_ASSET_TYPE = 'hdri' as const

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

const backgroundPreviewStyle = computed(() => resolveAssetPreviewStyle(backgroundAsset.value))
const environmentPreviewStyle = computed(() => resolveAssetPreviewStyle(environmentMapAsset.value))

const assetDialogTitle = computed(() => {
  if (assetDialogTarget.value === 'background') {
    return '选择背景 HDRI'
  }
  if (assetDialogTarget.value === 'environment') {
    return '选择环境贴图'
  }
  return '选择资产'
})

watch(assetDialogVisible, (open) => {
  if (!open) {
    assetDialogTarget.value = null
    assetDialogAnchor.value = null
    assetDialogSelectedId.value = ''
  }
})

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(prefixed)
  if (!match) {
    return fallback
  }
  const hexValue = match[1] ?? ''
  if (hexValue.length === 3) {
    const [r, g, b] = hexValue.split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return `#${hexValue.toLowerCase()}`
}

function updateBackgroundMode(mode: EnvironmentBackgroundMode | null) {
  if (!mode || mode === environmentSettings.value.background.mode) {
    return
  }
  // Preserve previously chosen HDRI when toggling modes; don't clear hdriAssetId here
  sceneStore.patchEnvironmentSettings({
    background: {
      mode,
      solidColor: environmentSettings.value.background.solidColor,
      hdriAssetId: environmentSettings.value.background.hdriAssetId,
    },
  })
}

function handleHexColorChange(target: 'background' | 'ambient' | 'fog', value: string | null) {
  if (typeof value !== 'string') {
    return
  }
  if (target === 'background') {
    const current = environmentSettings.value.background.solidColor
    const normalized = normalizeHexColor(value, current)
    if (normalized === current) {
      return
    }
    sceneStore.patchEnvironmentSettings({
      background: {
        mode: environmentSettings.value.background.mode,
        solidColor: normalized,
        hdriAssetId: environmentSettings.value.background.hdriAssetId,
      },
    })
    return
  }
  if (target === 'ambient') {
    const current = environmentSettings.value.ambientLightColor
    const normalized = normalizeHexColor(value, current)
    if (normalized === current) {
      return
    }
    sceneStore.patchEnvironmentSettings({ ambientLightColor: normalized })
    return
  }
  const current = environmentSettings.value.fogColor
  const normalized = normalizeHexColor(value, current)
  if (normalized === current) {
    return
  }
  sceneStore.patchEnvironmentSettings({ fogColor: normalized })
}

function handleColorPickerInput(target: 'background' | 'ambient' | 'fog', value: string | null) {
  handleHexColorChange(target, value)
}

function clearBackgroundAsset() {
  if (environmentSettings.value.background.mode !== 'hdri') {
    return
  }
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: 'solidColor',
      solidColor: environmentSettings.value.background.solidColor,
      hdriAssetId: null,
    },
  })
}

function updateEnvironmentMapMode(mode: EnvironmentMapMode | null) {
  if (!mode || mode === environmentSettings.value.environmentMap.mode) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    environmentMap: {
      mode,
      hdriAssetId: environmentSettings.value.environmentMap.hdriAssetId,
    },
  })
}

function clearEnvironmentAsset() {
  if (environmentSettings.value.environmentMap.mode === 'skybox' && !environmentSettings.value.environmentMap.hdriAssetId) {
    return
  }
  sceneStore.patchEnvironmentSettings({ environmentMap: { mode: 'skybox', hdriAssetId: null } })
}

function handleAmbientIntensityInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(10, numeric))
  if (Math.abs(clamped - environmentSettings.value.ambientLightIntensity) < 1e-3) {
    return
  }
  sceneStore.patchEnvironmentSettings({ ambientLightIntensity: clamped })
}

function formatAmbientIntensity(): string {
  return environmentSettings.value.ambientLightIntensity.toFixed(2)
}

function handleShadowsToggle(enabled: boolean | null) {
  if (typeof enabled !== 'boolean') {
    return
  }
  if (enabled === shadowsEnabled.value) {
    return
  }
  sceneStore.setShadowsEnabled(enabled)
}

function handleFogToggle(enabled: boolean | null) {
  const nextMode: EnvironmentFogMode = enabled ? 'exp' : 'none'
  if (nextMode === environmentSettings.value.fogMode) {
    return
  }
  sceneStore.patchEnvironmentSettings({ fogMode: nextMode })
}

function handleFogDensityInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(1, numeric))
  if (Math.abs(clamped - environmentSettings.value.fogDensity) < 1e-4) {
    return
  }
  sceneStore.patchEnvironmentSettings({ fogDensity: clamped })
}

function formatFogDensity(): string {
  return environmentSettings.value.fogDensity.toFixed(3)
}

function handleGravityStrengthInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(100, numeric))
  if (Math.abs(clamped - environmentSettings.value.gravityStrength) < 1e-3) {
    return
  }
  sceneStore.patchEnvironmentSettings({ gravityStrength: clamped })
}

function formatGravityStrength(): string {
  return environmentSettings.value.gravityStrength.toFixed(2)
}

function handleRestitutionInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(1, numeric))
  if (Math.abs(clamped - environmentSettings.value.collisionRestitution) < 1e-3) {
    return
  }
  sceneStore.patchEnvironmentSettings({ collisionRestitution: clamped })
}

function formatRestitution(): string {
  return environmentSettings.value.collisionRestitution.toFixed(2)
}

function handleFrictionInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(1, numeric))
  if (Math.abs(clamped - environmentSettings.value.collisionFriction) < 1e-3) {
    return
  }
  sceneStore.patchEnvironmentSettings({ collisionFriction: clamped })
}

function formatFriction(): string {
  return environmentSettings.value.collisionFriction.toFixed(2)
}

function resolveAssetPreviewStyle(asset: ProjectAsset | null): Record<string, string> {
  const fallback = 'rgba(233, 236, 241, 0.08)'
  if (!asset) {
    return {
      backgroundColor: fallback,
    }
  }
  const thumbnailUrl = assetCacheStore.resolveAssetThumbnail({ asset, assetId: asset.id })
  if (thumbnailUrl) {
    const backgroundColor = asset.previewColor?.trim().length ? asset.previewColor : fallback
    return {
      backgroundImage: `url(${thumbnailUrl})`,
      backgroundColor,
    }
  }
  if (asset.previewColor?.trim().length) {
    return {
      backgroundColor: asset.previewColor,
    }
  }
  return {
    backgroundColor: fallback,
  }
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
  if (asset.type === 'image' || asset.type === 'texture' || asset.type === 'hdri') {
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

function applyEnvironmentAsset(target: 'background' | 'environment', asset: ProjectAsset) {
  if (target === 'background') {
    const shouldLinkEnvironment = !environmentSettings.value.environmentMap.hdriAssetId
    sceneStore.patchEnvironmentSettings({
      background: {
        mode: 'hdri',
        solidColor: environmentSettings.value.background.solidColor,
        hdriAssetId: asset.id,
      },
    })
    if (shouldLinkEnvironment) {
      sceneStore.patchEnvironmentSettings({ environmentMap: { mode: 'custom', hdriAssetId: asset.id } })
    }
    return
  }
  const shouldLinkBackground =
    environmentSettings.value.background.mode !== 'hdri' || !environmentSettings.value.background.hdriAssetId
  sceneStore.patchEnvironmentSettings({ environmentMap: { mode: 'custom', hdriAssetId: asset.id } })
  if (shouldLinkBackground) {
    sceneStore.patchEnvironmentSettings({
      background: {
        mode: 'hdri',
        solidColor: environmentSettings.value.background.solidColor,
        hdriAssetId: asset.id,
      },
    })
  }
}

function openAssetDialog(target: 'background' | 'environment', event?: MouseEvent) {
  if (event) {
    assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  } else {
    assetDialogAnchor.value = null
  }
  assetDialogTarget.value = target
  assetDialogSelectedId.value =
    target === 'background'
      ? environmentSettings.value.background.hdriAssetId ?? ''
      : environmentSettings.value.environmentMap.hdriAssetId ?? ''
  assetDialogVisible.value = true
}

function handleAssetDialogUpdate(asset: ProjectAsset | null) {
  if (!assetDialogTarget.value) {
    return
  }
  if (!asset) {
    assetDialogVisible.value = false
    return
  }
  if (!isEnvironmentAsset(asset)) {
    console.warn('Selected asset is not a supported environment asset')
    return
  }
  applyEnvironmentAsset(assetDialogTarget.value, asset)
  assetDialogVisible.value = false
}

function handleAssetDialogCancel() {
  assetDialogVisible.value = false
}

function handleBackgroundDrop(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  isBackgroundDropActive.value = false
  if (!isEnvironmentAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  applyEnvironmentAsset('background', asset)
}

function handleEnvironmentDrop(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  isEnvironmentDropActive.value = false
  if (!isEnvironmentAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  applyEnvironmentAsset('environment', asset)
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
          <div
            v-if="environmentSettings.background.mode === 'skybox'"
            class="environment-placeholder"
          >
            <v-icon size="30" color="rgba(233, 236, 241, 0.45)">mdi-weather-sunset</v-icon>
            <div class="placeholder-text">
              <div class="placeholder-title">Using Procedural Skybox</div>
              <div class="placeholder-hint">Customize it via Sky Settings</div>
            </div>
          </div>
          <div
            v-else-if="environmentSettings.background.mode === 'solidColor'"
            class="material-color drop-target"
          >
            <div class="color-input">
              <v-text-field
                label="Solid Color"
                class="slider-input"
                density="compact"
                variant="underlined"
                hide-details
                :model-value="environmentSettings.background.solidColor"
                @update:model-value="(value) => handleHexColorChange('background', value)"
              />
              <v-menu
                v-model="backgroundColorMenuOpen"
                :close-on-content-click="false"
                transition="scale-transition"
                location="bottom start"
              >
                <template #activator="{ props: menuProps }">
                  <button
                    class="color-swatch"
                    type="button"
                    v-bind="menuProps"
                    :style="{ backgroundColor: environmentSettings.background.solidColor }"
                    title="Select solid color"
                  >
                    <span class="sr-only">Select solid color</span>
                  </button>
                </template>
                <div class="color-picker">
                  <v-color-picker
                    :model-value="environmentSettings.background.solidColor"
                    mode="hex"
                    :modes="['hex']"
                    hide-inputs
                    @update:model-value="(value) => handleColorPickerInput('background', value)"
                  />
                </div>
              </v-menu>
            </div>
          </div>
          <div
            v-else
            class="asset-tile"
            :class="{
              'is-active-drop': isBackgroundDropActive,
              'is-inactive': environmentSettings.background.mode !== 'hdri',
            }"
            @dragenter="handleBackgroundDragEnter"
            @dragover="handleBackgroundDragOver"
            @dragleave="handleBackgroundDragLeave"
            @drop="handleBackgroundDrop"
          >
            <div
              class="asset-thumb"
              :class="{ 'asset-thumb--empty': !backgroundAsset }"
              :style="backgroundPreviewStyle"
              role="button"
              tabindex="0"
              :title="backgroundAsset ? 'Change HDRI asset' : 'Select HDRI asset'"
              @click="openAssetDialog('background', $event)"
              @keydown.enter.prevent="openAssetDialog('background')"
              @keydown.space.prevent="openAssetDialog('background')"
            >
              <v-icon v-if="!backgroundAsset" size="20" color="rgba(233, 236, 241, 0.4)">mdi-image-off</v-icon>
            </div>
            <div
              class="asset-info"
              role="button"
              tabindex="0"
              @click="openAssetDialog('background', $event)"
              @keydown.enter.prevent="openAssetDialog('background')"
              @keydown.space.prevent="openAssetDialog('background')"
            >
              <div class="asset-name">{{ backgroundAssetLabel }}</div>
              <div class="asset-hint">{{ backgroundAssetHint }}</div>
            </div>
            <div class="asset-actions">
              <v-btn
                class="asset-action"
                icon="mdi-close"
                size="x-small"
                variant="text"
                :disabled="environmentSettings.background.mode !== 'hdri' || !backgroundAsset"
                title="Clear background HDRI"
                @click.stop="clearBackgroundAsset"
              />
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
            v-if="environmentSettings.environmentMap.mode === 'custom'"
            class="asset-tile"
            :class="{
              'is-active-drop': isEnvironmentDropActive,
              'is-inactive': environmentSettings.environmentMap.mode !== 'custom',
            }"
            @dragenter="handleEnvironmentDragEnter"
            @dragover="handleEnvironmentDragOver"
            @dragleave="handleEnvironmentDragLeave"
            @drop="handleEnvironmentDrop"
          >
            <div
              class="asset-thumb"
              :class="{ 'asset-thumb--empty': !environmentMapAsset }"
              :style="environmentPreviewStyle"
              role="button"
              tabindex="0"
              :title="environmentMapAsset ? 'Change environment map' : 'Select environment map'"
              @click="openAssetDialog('environment', $event)"
              @keydown.enter.prevent="openAssetDialog('environment')"
              @keydown.space.prevent="openAssetDialog('environment')"
            >
              <v-icon v-if="!environmentMapAsset" size="20" color="rgba(233, 236, 241, 0.4)">mdi-image-off</v-icon>
            </div>
            <div
              class="asset-info"
              role="button"
              tabindex="0"
              @click="openAssetDialog('environment', $event)"
              @keydown.enter.prevent="openAssetDialog('environment')"
              @keydown.space.prevent="openAssetDialog('environment')"
            >
              <div class="asset-name">{{ environmentAssetLabel }}</div>
              <div class="asset-hint">{{ environmentAssetHint }}</div>
            </div>
            <div class="asset-actions">
              <v-btn
                class="asset-action"
                icon="mdi-close"
                size="x-small"
                variant="text"
                :disabled="!environmentMapAsset"
                title="Clear environment map"
                @click.stop="clearEnvironmentAsset"
              />
            </div>
          </div>
          <div
            v-else
            class="environment-placeholder"
          >
            <v-icon size="30" color="rgba(233, 236, 241, 0.45)">mdi-weather-partly-cloudy</v-icon>
            <div class="placeholder-text">
              <div class="placeholder-title">Using Skybox Reflections</div>
              <div class="placeholder-hint">Environment map derives from the active skybox</div>
            </div>
          </div>
        </section>
        <section class="environment-section">
          <div class="section-title">Ambient Light</div>
          <div class="material-color">
            <div class="color-input">
              <v-text-field
                label="Ambient Color"
                class="slider-input"
                density="compact"
                variant="underlined"
                hide-details
                :model-value="environmentSettings.ambientLightColor"
                @update:model-value="(value) => handleHexColorChange('ambient', value)"
              />
              <v-menu
                v-model="ambientColorMenuOpen"
                :close-on-content-click="false"
                transition="scale-transition"
                location="bottom start"
              >
                <template #activator="{ props: menuProps }">
                  <button
                    class="color-swatch"
                    type="button"
                    v-bind="menuProps"
                    :style="{ backgroundColor: environmentSettings.ambientLightColor }"
                    title="Select ambient color"
                  >
                    <span class="sr-only">Select ambient color</span>
                  </button>
                </template>
                <div class="color-picker">
                  <v-color-picker
                    :model-value="environmentSettings.ambientLightColor"
                    mode="hex"
                    :modes="['hex']"
                    hide-inputs
                    @update:model-value="(value) => handleColorPickerInput('ambient', value)"
                  />
                </div>
              </v-menu>
            </div>
          </div>
          <div class="slider-row">
            <v-text-field
              class="slider-input"
              label="Intensity"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="10"
              :step="0.05"
              :model-value="formatAmbientIntensity()"
              @update:model-value="handleAmbientIntensityInput"
            />
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Shadows</div>
          <div class="toggle-row">
            <span class="toggle-label">Enable Shadows</span>
            <v-switch
              :model-value="shadowsEnabled"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="handleShadowsToggle"
            />
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
              color="primary"
              size="small"
              @update:model-value="handleFogToggle"
            />
          </div>
          <div class="material-color" :class="{ 'is-disabled': !isFogEnabled }">
            <div class="color-input">
              <v-text-field
                label="Fog Color"
                class="slider-input"
                density="compact"
                variant="underlined"
                hide-details
                :model-value="environmentSettings.fogColor"
                :disabled="!isFogEnabled"
                @update:model-value="(value) => handleHexColorChange('fog', value)"
              />
              <v-menu
                v-model="fogColorMenuOpen"
                :close-on-content-click="false"
                transition="scale-transition"
                location="bottom start"
                :disabled="!isFogEnabled"
              >
                <template #activator="{ props: menuProps }">
                  <button
                    class="color-swatch"
                    type="button"
                    v-bind="menuProps"
                    :disabled="!isFogEnabled"
                    :style="{ backgroundColor: environmentSettings.fogColor }"
                    title="Select fog color"
                  >
                    <span class="sr-only">Select fog color</span>
                  </button>
                </template>
                <div class="color-picker">
                  <v-color-picker
                    :model-value="environmentSettings.fogColor"
                    mode="hex"
                    :modes="['hex']"
                    hide-inputs
                    @update:model-value="(value) => handleColorPickerInput('fog', value)"
                  />
                </div>
              </v-menu>
            </div>
          </div>
          <div class="slider-row" :class="{ 'is-disabled': !isFogEnabled }">
            <v-text-field
              class="slider-input"
              label="Density"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="1"
              :step="0.005"
              :model-value="formatFogDensity()"
              :disabled="!isFogEnabled"
              @update:model-value="handleFogDensityInput"
            />
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Physics</div>
          <div class="slider-row">
            <v-text-field
              class="slider-input"
              label="Gravity Strength (m/s^2)"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="100"
              :step="0.1"
              :model-value="formatGravityStrength()"
              @update:model-value="handleGravityStrengthInput"
            />
          </div>
          <div class="slider-row">
            <v-text-field
              class="slider-input"
              label="Collision Restitution"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="1"
              :step="0.05"
              :model-value="formatRestitution()"
              @update:model-value="handleRestitutionInput"
            />
          </div>
          <div class="slider-row">
            <v-text-field
              class="slider-input"
              label="Collision Friction"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="1"
              :step="0.05"
              :model-value="formatFriction()"
              @update:model-value="handleFrictionInput"
            />
          </div>
        </section>

        
      </div>
      <AssetDialog
        v-model="assetDialogVisible"
        v-model:assetId="assetDialogSelectedId"
        :asset-type="HDRI_ASSET_TYPE"
        :title="assetDialogTitle"
        :anchor="assetDialogAnchor"
        confirm-text="选择"
        cancel-text="取消"
        @update:asset="handleAssetDialogUpdate"
        @cancel="handleAssetDialogCancel"
      />
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
  gap: 14px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(15, 20, 28, 0.55);
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

.material-color {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.material-color.is-disabled {
  opacity: 0.55;
}

.color-input {
  display: flex;
  align-items: center;
  gap: 10px;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 0;
  background: transparent;
}

.color-swatch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.color-swatch:focus-visible {
  outline: 2px solid rgba(107, 152, 255, 0.85);
  outline-offset: 2px;
}

.color-picker {
  padding: 12px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.slider-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-row.is-disabled {
  opacity: 0.55;
}

.slider-input {
  width: 100%;
}

.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}

.slider-input :deep(input) {
  font-variant-numeric: tabular-nums;
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

.asset-tile {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  column-gap: 12px;
  row-gap: 2px;
  align-items: center;
  padding: 6px 10px;
  min-height: 40px;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  background: rgba(12, 16, 22, 0.45);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.asset-tile.is-inactive {
  opacity: 0.65;
}

.asset-tile.is-active-drop {
  border-color: rgba(107, 152, 255, 0.85);
  background: rgba(56, 86, 160, 0.38);
}

.asset-thumb {
  grid-row: 1 / span 2;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background-color: rgba(233, 236, 241, 0.08);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

.asset-thumb--empty {
  border-style: dashed;
}

.asset-thumb:hover {
  border-color: rgba(77, 208, 225, 0.75);
  box-shadow: 0 0 0 1px rgba(77, 208, 225, 0.3);
}

.asset-info {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
  cursor: pointer;
}

.asset-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-hint {
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  grid-column: 3;
  grid-row: 1;
}

.asset-action {
  color: rgba(233, 236, 241, 0.76);
}

.asset-action:disabled {
  color: rgba(233, 236, 241, 0.28) !important;
}

.environment-placeholder {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  background: rgba(12, 16, 22, 0.45);
  color: rgba(233, 236, 241, 0.82);
}

.placeholder-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.placeholder-title {
  font-size: 0.82rem;
  font-weight: 600;
}

.placeholder-hint {
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.55);
}
</style>
