<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  EnvironmentBackgroundMode,
  EnvironmentNorthDirection,
  EnvironmentOrientationPreset,
  EnvironmentPhysicsEngine,
  EnvironmentRotationDegrees,
  EnvironmentSettings,
} from '@/types/environment'
import {
  isHdriLikeExtension,
  isKtx2LikeExtension,
  isSkyCubeArchiveExtension,
} from '@schema/core'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'


const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { environmentSettings: storeEnvironmentSettings, shadowsEnabled } = storeToRefs(sceneStore)

const environmentSettings = computed(() => storeEnvironmentSettings.value)

type BackgroundUiMode = 'solidColor' | 'sky'

const backgroundModeOptions: Array<{ title: string; value: BackgroundUiMode }> = [
  { title: 'Solid Color', value: 'solidColor' },
  { title: 'Sky', value: 'sky' },
]

const orientationPresetOptions: Array<{ title: string; value: EnvironmentOrientationPreset }> = [
  { title: '+Y Up (Three default)', value: 'yUp' },
  { title: '+Z Up (Z-up assets)', value: 'zUp' },
  { title: '+X Up (X-up assets)', value: 'xUp' },
  { title: 'Custom', value: 'custom' },
]

const northDirectionOptions: Array<{ title: string; value: EnvironmentNorthDirection }> = [
  { title: '+X', value: '+X' },
  { title: '-X', value: '-X' },
  { title: '+Z', value: '+Z' },
  { title: '-Z', value: '-Z' },
]

const backgroundColorMenuOpen = ref(false)
const gradientTopColorMenuOpen = ref(false)

const DEFAULT_GRADIENT_OFFSET = 33
const DEFAULT_GRADIENT_EXPONENT = 0.6

const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
type AssetDialogTarget = 'background'
const assetDialogTarget = ref<AssetDialogTarget | null>(null)

const HDRI_ASSET_TYPE = 'hdri' as const
const BACKGROUND_ASSET_TYPE = 'hdri,texture,file' as const
const BACKGROUND_ASSET_EXTENSIONS = [
  'hdr',
  'hdri',
  'rgbe',
  'exr',
  'ktx2',
  'skycube',
] as const

const isBackgroundDropActive = ref(false)

const isPhysicsEnabled = computed(() => environmentSettings.value.physicsEnabled !== false)
const physicsEngine = computed<EnvironmentPhysicsEngine>(() => environmentSettings.value.physicsEngine ?? 'cannon')

const orientationPreset = computed<EnvironmentOrientationPreset>(() => environmentSettings.value.environmentOrientationPreset ?? 'yUp')
const rotationDegrees = computed<EnvironmentRotationDegrees>(() => environmentSettings.value.environmentRotationDegrees ?? { x: 0, y: 0, z: 0 })
const showOrientationControls = computed(() => {
  const bgMode = environmentSettings.value.background.mode
  return bgMode === 'hdri' || bgMode === 'fastHdri' || bgMode === 'skycube'
})
const backgroundUiMode = computed<BackgroundUiMode>(() => (
  environmentSettings.value.background.mode === 'solidColor' ? 'solidColor' : 'sky'
))

const physicsEngineOptions: Array<{ title: string; value: EnvironmentPhysicsEngine }> = [
  { title: 'Ammo', value: 'ammo' },
  { title: 'Cannon', value: 'cannon' },
]

// ---- Slow Roads 环境（季节 × 时间 × 天气）----
const SLOWROADS_SEASONS = [
  { title: '春', value: 'spring' as const },
  { title: '夏', value: 'summer' as const },
  { title: '秋', value: 'autumn' as const },
  { title: '冬', value: 'winter' as const },
]
const SLOWROADS_TIMES = [
  { title: '早晨', value: 'morning' as const },
  { title: '白天', value: 'day' as const },
  { title: '傍晚', value: 'evening' as const },
  { title: '夜晚', value: 'night' as const },
]
const SLOWROADS_WEATHERS = [
  { title: '晴', value: 'clear' as const },
  { title: '阴', value: 'overcast' as const },
]

function patchSlowroadsSettings(patch: Partial<EnvironmentSettings['slowroads']>) {
  sceneStore.patchEnvironmentSettings({
    slowroads: { ...environmentSettings.value.slowroads, ...patch },
  })
}

const backgroundAsset = computed(() => {
  const background = environmentSettings.value.background
  const assetId = background.mode === 'solidColor' ? null : background.backgroundAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const backgroundAssetLabel = computed(() => {
  const asset = backgroundAsset.value
  if (!asset) {
    return 'Drag Sky asset here'
  }
  return asset.name?.trim().length ? asset.name : asset.id
})

const backgroundAssetHint = computed(() => {
  const asset = backgroundAsset.value
  if (!asset) {
    return 'Supports HDRI, Fast HDRI, or SkyCube assets'
  }
  const extension = asset.extension ? asset.extension.toLowerCase() : null
  if (isSkyCubeArchiveExtension(extension)) {
    return '.skycube archive'
  }
  if (isKtx2LikeExtension(extension)) {
    return '.ktx2 Fast HDRI'
  }
  return isHdriLikeExtension(extension) ? 'HDRI asset' : 'Sky asset'
})

const backgroundPreviewStyle = computed(() => resolveAssetPreviewStyle(backgroundAsset.value))

const assetDialogTitle = computed(() => {
  return assetDialogTarget.value === 'background' ? 'Select Background Asset' : 'Select Asset'
})

const assetDialogAssetType = computed(() => {
  if (!assetDialogTarget.value) {
    return HDRI_ASSET_TYPE
  }
  return BACKGROUND_ASSET_TYPE
})

const assetDialogExtensions = computed(() => {
  return assetDialogTarget.value === 'background' ? [...BACKGROUND_ASSET_EXTENSIONS] : undefined
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

function updateBackgroundMode(mode: BackgroundUiMode | null) {
  if (!mode || mode === environmentSettings.value.background.mode) {
    return
  }
  if (mode === 'solidColor') {
    patchEnvironmentBackground({
      mode: 'solidColor',
      solidColor: environmentSettings.value.background.solidColor,
      gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
      gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
      gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
      backgroundAssetId: null,
    })
    return
  }

  const background = environmentSettings.value.background
  const nextMode = background.mode === 'skycube' ? 'skycube' : background.mode === 'fastHdri' ? 'fastHdri' : 'hdri'
  patchEnvironmentBackground({
    mode: nextMode,
    solidColor: background.solidColor,
    gradientTopColor: background.gradientTopColor ?? null,
    gradientOffset: background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
    gradientExponent: background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
    backgroundAssetId: null,
  })
}

function resolvePresetRotationDegrees(preset: EnvironmentOrientationPreset): EnvironmentRotationDegrees {
  if (preset === 'zUp') {
    return { x: -90, y: 0, z: 0 }
  }
  if (preset === 'xUp') {
    return { x: 0, y: 0, z: 90 }
  }
  return { x: 0, y: 0, z: 0 }
}

function updateOrientationPreset(preset: EnvironmentOrientationPreset | null) {
  if (!preset) {
    return
  }
  if (preset === orientationPreset.value && environmentSettings.value.environmentRotationDegrees) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    environmentOrientationPreset: preset,
    environmentRotationDegrees: resolvePresetRotationDegrees(preset),
  })
}

function updateNorthDirection(direction: EnvironmentNorthDirection | null) {
  if (!direction || direction === environmentSettings.value.northDirection) {
    return
  }
  sceneStore.patchEnvironmentSettings({ northDirection: direction })
}

function handleRotationDegreesInput(axis: keyof EnvironmentRotationDegrees, value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(-360, Math.min(360, numeric))
  const current = rotationDegrees.value
  if (Math.abs((current[axis] ?? 0) - clamped) < 1e-6) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    environmentRotationDegrees: {
      ...current,
      [axis]: clamped,
    },
  })
}

function handleHexColorChange(_target: 'background', value: string | null) {
  if (typeof value !== 'string') {
    return
  }
  const current = environmentSettings.value.background.solidColor
  const normalized = normalizeHexColor(value, current)
  if (normalized === current) {
    return
  }
  patchEnvironmentBackground({
    mode: environmentSettings.value.background.mode,
    solidColor: normalized,
    gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
    gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
    gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
    backgroundAssetId: environmentSettings.value.background.backgroundAssetId,
  })
}

function handleColorPickerInput(target: 'background', value: string | null) {
  handleHexColorChange(target, value)
}

function handleGradientTopColorChange(value: string | null) {
  if (value === null || value === undefined) {
    return
  }
  const current = environmentSettings.value.background.gradientTopColor ?? ''
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) {
    if (!current.length) {
      return
    }
    patchEnvironmentBackground({
      mode: environmentSettings.value.background.mode,
      solidColor: environmentSettings.value.background.solidColor,
      gradientTopColor: null,
      gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
      gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
      backgroundAssetId: environmentSettings.value.background.backgroundAssetId,
    })
    return
  }
  const normalized = normalizeHexColor(trimmed, current.length ? current : '#ffffff')
  if (normalized === (environmentSettings.value.background.gradientTopColor ?? null)) {
    return
  }
  patchEnvironmentBackground({
    mode: environmentSettings.value.background.mode,
    solidColor: environmentSettings.value.background.solidColor,
    gradientTopColor: normalized,
    gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
    gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
    backgroundAssetId: environmentSettings.value.background.backgroundAssetId,
  })
}

function handleGradientTopColorPickerInput(value: string | null) {
  handleGradientTopColorChange(value)
}

function handleGradientOffsetInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(100000, numeric))
  if (Math.abs((environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET) - clamped) < 1e-6) {
    return
  }
  patchEnvironmentBackground({
    mode: environmentSettings.value.background.mode,
    solidColor: environmentSettings.value.background.solidColor,
    gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
    gradientOffset: clamped,
    gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
    backgroundAssetId: environmentSettings.value.background.backgroundAssetId,
  })
}

function handleGradientExponentInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(10, numeric))
  if (Math.abs((environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT) - clamped) < 1e-6) {
    return
  }
  patchEnvironmentBackground({
    mode: environmentSettings.value.background.mode,
    solidColor: environmentSettings.value.background.solidColor,
    gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
    gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
    gradientExponent: clamped,
    backgroundAssetId: environmentSettings.value.background.backgroundAssetId,
  })
}

function clearBackgroundAsset() {
  const background = environmentSettings.value.background
  if (background.mode === 'solidColor') {
    return
  }
  const nextBackground: Record<string, unknown> = {
    mode: background.mode,
    solidColor: background.solidColor,
    gradientTopColor: background.gradientTopColor ?? null,
    gradientOffset: background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
    gradientExponent: background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
    backgroundAssetId: null,
  }
  patchEnvironmentBackground({
    ...nextBackground,
  })
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

function handleViewportPerformanceModeToggle(enabled: boolean | null) {
  if (typeof enabled !== 'boolean') {
    return
  }
  if (enabled === Boolean(environmentSettings.value.viewportPerformanceMode)) {
    return
  }
  sceneStore.patchEnvironmentSettings({ viewportPerformanceMode: enabled })
}

function handlePhysicsEnabledToggle(enabled: boolean | null) {
  if (typeof enabled !== 'boolean') {
    return
  }
  if (enabled === (environmentSettings.value.physicsEnabled !== false)) {
    return
  }
  sceneStore.patchEnvironmentSettings({ physicsEnabled: enabled })
}

function handlePhysicsEngineChange(nextEngine: EnvironmentPhysicsEngine | { value?: unknown } | null) {
  const normalizedEngine = typeof nextEngine === 'string'
    ? nextEngine
    : nextEngine && typeof nextEngine === 'object' && 'value' in nextEngine
      ? (nextEngine as { value?: unknown }).value
      : null

  if (normalizedEngine !== 'ammo' && normalizedEngine !== 'cannon') {
    return
  }
  if (normalizedEngine === (environmentSettings.value.physicsEngine ?? 'cannon')) {
    return
  }
  sceneStore.patchEnvironmentSettings({ physicsEngine: normalizedEngine })
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

function isHdrExtension(extension: string | null): boolean {
  return isHdriLikeExtension(extension) || isKtx2LikeExtension(extension)
}

function isEnvironmentAsset(asset: ProjectAsset | null): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  if (asset.type === 'hdri' || asset.type === 'texture') {
    const extension = asset.extension ? asset.extension.toLowerCase() : null
    return isHdrExtension(extension)
  }
  if (asset.type === 'file') {
    const extension = asset.extension ? asset.extension.toLowerCase() : null
    return isHdrExtension(extension) || isSkyCubeArchiveExtension(extension)
  }
  return false
}

function patchEnvironmentBackground(background: Record<string, unknown>): void {
  sceneStore.patchEnvironmentSettings({ background: background as any })
}

async function registerBackgroundAsset(asset: ProjectAsset): Promise<ProjectAsset> {
  const source = asset.source ?? null
  const registeredAsset = sceneStore.ensureSceneAssetRegistered(asset, {
    providerId: source?.type === 'package' ? source.providerId : undefined,
    packagePathSegments: source?.type === 'package' && Array.isArray(source.packagePathSegments)
      ? source.packagePathSegments
      : undefined,
    source: source ?? undefined,
  })

  const syncSource = registeredAsset.source ?? source ?? undefined
  if (syncSource) {
    await sceneStore.syncAssetRegistryEntry(registeredAsset, syncSource)
  }

  return registeredAsset
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

async function applySkyAsset(asset: ProjectAsset) {
  const registeredAsset = await registerBackgroundAsset(asset)
  const extension = registeredAsset.extension ? registeredAsset.extension.toLowerCase() : null
  if (isSkyCubeArchiveExtension(extension)) {
    patchEnvironmentBackground({
      mode: 'skycube',
      solidColor: environmentSettings.value.background.solidColor,
      gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
      gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
      gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
      backgroundAssetId: registeredAsset.id,
    })
    return
  }

  const mode: EnvironmentBackgroundMode = isKtx2LikeExtension(extension) ? 'fastHdri' : 'hdri'
  patchEnvironmentBackground({
    mode,
    solidColor: environmentSettings.value.background.solidColor,
    gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
    gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
    gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
    backgroundAssetId: registeredAsset.id,
  })
}

function openAssetDialog(target: 'background', event?: MouseEvent) {
  if (event) {
    assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  } else {
    assetDialogAnchor.value = null
  }
  assetDialogTarget.value = target
  assetDialogSelectedId.value =
    environmentSettings.value.background.mode === 'solidColor'
      ? ''
      : (environmentSettings.value.background.backgroundAssetId ?? '')
  assetDialogVisible.value = true
}

async function handleAssetDialogUpdate(asset: ProjectAsset | null) {
  if (!assetDialogTarget.value) {
    return
  }
  if (!asset) {
    clearBackgroundAsset()
    assetDialogVisible.value = false
    return
  }
  if (!isEnvironmentAsset(asset)) {
    console.warn('Selected asset is not a supported environment asset')
    return
  }
  await applySkyAsset(asset)
  assetDialogVisible.value = false
}

function handleAssetDialogCancel() {
  assetDialogVisible.value = false
}

async function handleBackgroundDrop(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  isBackgroundDropActive.value = false
  if (!isEnvironmentAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (asset) {
    await applySkyAsset(asset)
  }
}

// Environment map selection has been removed; reflections follow background.
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
            :model-value="backgroundUiMode"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            @update:model-value="(mode) => updateBackgroundMode(mode as BackgroundUiMode | null)"
          />

          <div v-if="showOrientationControls" class="orientation-controls">
            <v-select
              :items="orientationPresetOptions"
              :model-value="orientationPreset"
              density="compact"
              hide-details
              variant="underlined"
              class="section-select"
              label="Up Axis / Preset"
              @update:model-value="(value) => updateOrientationPreset(value as EnvironmentOrientationPreset | null)"
            />
            <div class="orientation-rotation-grid">
              <v-text-field
                label="Rot X (deg)"
                density="compact"
                variant="underlined"
                hide-details
                type="number"
                inputmode="decimal"
                :min="-360"
                :max="360"
                :step="1"
                :model-value="rotationDegrees.x"
                @update:model-value="(value) => handleRotationDegreesInput('x', value)"
              />
              <v-text-field
                label="Rot Y (deg)"
                density="compact"
                variant="underlined"
                hide-details
                type="number"
                inputmode="decimal"
                :min="-360"
                :max="360"
                :step="1"
                :model-value="rotationDegrees.y"
                @update:model-value="(value) => handleRotationDegreesInput('y', value)"
              />
              <v-text-field
                label="Rot Z (deg)"
                density="compact"
                variant="underlined"
                hide-details
                type="number"
                inputmode="decimal"
                :min="-360"
                :max="360"
                :step="1"
                :model-value="rotationDegrees.z"
                @update:model-value="(value) => handleRotationDegreesInput('z', value)"
              />
            </div>
          </div>
          <div
            v-if="environmentSettings.background.mode === 'solidColor'"
            class="material-color drop-target"
          >
            <div class="color-input">
              <v-text-field
                label="Bottom Color"
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
                    title="Select bottom color"
                  >
                    <span class="sr-only">Select bottom color</span>
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

            <div class="color-input">
              <v-text-field
                label="Top Color (optional)"
                class="slider-input"
                density="compact"
                variant="underlined"
                hide-details
                :model-value="environmentSettings.background.gradientTopColor ?? ''"
                @update:model-value="(value) => handleGradientTopColorChange(value as string | null)"
              />
              <v-menu
                v-model="gradientTopColorMenuOpen"
                :close-on-content-click="false"
                transition="scale-transition"
                location="bottom start"
              >
                <template #activator="{ props: menuProps }">
                  <button
                    class="color-swatch"
                    type="button"
                    v-bind="menuProps"
                    :style="{ backgroundColor: environmentSettings.background.gradientTopColor ?? environmentSettings.background.solidColor }"
                    title="Select top color"
                  >
                    <span class="sr-only">Select top color</span>
                  </button>
                </template>
                <div class="color-picker">
                  <v-color-picker
                    :model-value="environmentSettings.background.gradientTopColor ?? environmentSettings.background.solidColor"
                    mode="hex"
                    :modes="['hex']"
                    hide-inputs
                    @update:model-value="(value) => handleGradientTopColorPickerInput(value)"
                  />
                </div>
              </v-menu>
            </div>

            <div class="orientation-rotation-grid">
              <v-text-field
                label="Gradient Offset"
                density="compact"
                variant="underlined"
                hide-details
                type="number"
                inputmode="decimal"
                :min="0"
                :max="100000"
                :step="1"
                :model-value="environmentSettings.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET"
                @update:model-value="handleGradientOffsetInput"
              />
              <v-text-field
                label="Gradient Exponent"
                density="compact"
                variant="underlined"
                hide-details
                type="number"
                inputmode="decimal"
                :min="0"
                :max="10"
                :step="0.05"
                :model-value="environmentSettings.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT"
                @update:model-value="handleGradientExponentInput"
              />
            </div>
          </div>
          <div
            v-else
            class="asset-tile"
            :class="{ 'is-active-drop': isBackgroundDropActive }"
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
              :title="backgroundAsset ? 'Change Sky asset' : 'Select Sky asset'"
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
              <div class="asset-name" :title="backgroundAssetLabel">{{ backgroundAssetLabel }}</div>
              <div class="asset-hint">{{ backgroundAssetHint }}</div>
            </div>
            <div class="asset-actions">
              <v-btn
                class="asset-action"
                icon="mdi-close"
                size="x-small"
                variant="text"
                :disabled="!backgroundAsset"
                title="Clear Sky asset"
                @click.stop="clearBackgroundAsset"
              />
            </div>
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
          <div class="section-title">Viewport</div>
          <div class="toggle-row">
            <span class="toggle-label">Performance Mode</span>
            <v-switch
              :model-value="Boolean(environmentSettings.viewportPerformanceMode)"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="handleViewportPerformanceModeToggle"
            />
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Navigation</div>
          <v-select
            :items="northDirectionOptions"
            :model-value="environmentSettings.northDirection ?? '+X'"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            label="North Direction"
            @update:model-value="(value) => updateNorthDirection(value as EnvironmentNorthDirection | null)"
          />
        </section>

        <section class="environment-section">
          <div class="section-title">Slow Roads 环境</div>
          <div class="section-hint">季节/时间/天气驱动光照、三色雾、天空、云层、星空与降雪；素材固定来自在线资产包。</div>
          <div class="toggle-label">季节</div>
          <div class="pl-choice-row">
            <button
              v-for="item in SLOWROADS_SEASONS"
              :key="item.value"
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': environmentSettings.slowroads.season === item.value }"
              @click="patchSlowroadsSettings({ season: item.value })"
            >{{ item.title }}</button>
          </div>
          <div class="toggle-label">时间</div>
          <div class="pl-choice-row">
            <button
              v-for="item in SLOWROADS_TIMES"
              :key="item.value"
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': environmentSettings.slowroads.timeOfDay === item.value }"
              @click="patchSlowroadsSettings({ timeOfDay: item.value })"
            >{{ item.title }}</button>
          </div>
          <div class="toggle-label">天气</div>
          <div class="pl-choice-row">
            <button
              v-for="item in SLOWROADS_WEATHERS"
              :key="item.value"
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': environmentSettings.slowroads.weather === item.value }"
              @click="patchSlowroadsSettings({ weather: item.value })"
            >{{ item.title }}</button>
          </div>
          <div class="toggle-row">
            <span class="toggle-label">天空</span>
            <v-switch
              :model-value="environmentSettings.slowroads.showSky"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="(v) => patchSlowroadsSettings({ showSky: Boolean(v) })"
            />
          </div>
          <div class="toggle-row">
            <span class="toggle-label">云层</span>
            <v-switch
              :model-value="environmentSettings.slowroads.showClouds"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="(v) => patchSlowroadsSettings({ showClouds: Boolean(v) })"
            />
          </div>
          <div class="toggle-row">
            <span class="toggle-label">星空</span>
            <v-switch
              :model-value="environmentSettings.slowroads.showStars"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="(v) => patchSlowroadsSettings({ showStars: Boolean(v) })"
            />
          </div>
          <div class="toggle-row">
            <span class="toggle-label">降雪</span>
            <v-switch
              :model-value="environmentSettings.slowroads.showSnow"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="(v) => patchSlowroadsSettings({ showSnow: Boolean(v) })"
            />
          </div>
          <div class="slider-row">
            <v-slider
              class="slider-control"
              :min="0.2"
              :max="3"
              :step="0.05"
              :model-value="environmentSettings.slowroads.exposureScale"
              @update:model-value="(value) => patchSlowroadsSettings({ exposureScale: Number(value) })"
            />
            <v-text-field
              class="slider-input"
              label="曝光缩放"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0.2"
              :max="3"
              :step="0.05"
              :model-value="String(environmentSettings.slowroads.exposureScale)"
              @update:model-value="(value) => patchSlowroadsSettings({ exposureScale: Number(value) })"
            />
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Physics</div>
          <div class="toggle-row">
            <span class="toggle-label">Enable Physics</span>
            <v-switch
              :model-value="isPhysicsEnabled"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="handlePhysicsEnabledToggle"
            />
          </div>
          <div class="slider-row">
          <v-select
            class="slider-input"
            label="Physics Engine"
            density="compact"
            variant="underlined"
            hide-details
            :items="physicsEngineOptions"
            item-title="title"
            item-value="value"
            :return-object="false"
            :model-value="physicsEngine"
            @update:model-value="handlePhysicsEngineChange"
          />
          </div>
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
      <AssetPickerDialog
        v-model="assetDialogVisible"
        :asset-id="assetDialogSelectedId"
        :asset-type="assetDialogAssetType"
        :extensions="assetDialogExtensions"
        :title="assetDialogTitle"
        :anchor="assetDialogAnchor"
        confirm-text="Select"
        cancel-text="Cancel"
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

.section-hint {
  font-size: 0.72rem;
  line-height: 1.35;
  color: rgba(159, 181, 199, 0.72);
}

.pl-choice-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 2px 0 6px;
}

.pl-choice {
  border: 1px solid rgba(126, 148, 168, 0.45);
  background: transparent;
  color: rgba(214, 226, 236, 0.9);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
}

.pl-choice--active {
  border-color: rgba(88, 160, 232, 0.9);
  background: rgba(88, 160, 232, 0.18);
  color: #ffffff;
}

.section-select :deep(.v-field__input) {
  font-size: 0.82rem;
}

.orientation-controls {
  display: flex;
  flex-direction: column;
  gap: 17px;
}

.orientation-rotation-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 17px;
}

.material-color {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.cube-face-tile {
  grid-template-columns: 48px minmax(0, 1fr) auto;
  min-height: 60px;
}

.cube-face-tile .asset-thumb {
  width: 48px;
  height: 48px;
}

.asset-tile.is-inactive {
  opacity: 0.65;
}

.asset-tile.is-active-drop {
  border-color: rgba(107, 152, 255, 0.85);
  background: rgba(56, 86, 160, 0.38);
}

.asset-tile.is-empty {
  border-style: dashed;
}

.cube-face-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.cube-face-tile .asset-info {
  min-width: 0;
  overflow: visible;
}

.cube-face-tile .asset-hint {
  white-space: normal;
  word-break: break-word;
}

.cube-face-tile .asset-face-label {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.cube-face-tile .asset-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.cube-face-thumb-label {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.78);
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

.asset-face-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(233, 236, 241, 0.62);
}

.asset-face-axis {
  font-weight: 700;
  color: rgba(233, 236, 241, 0.92);
}

.asset-face-description {
  font-weight: 600;
  color: rgba(233, 236, 241, 0.55);
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

</style>
