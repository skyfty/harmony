<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  EnvironmentBackgroundMode,
  EnvironmentFogMode,
  EnvironmentOrientationPreset,
  EnvironmentRotationDegrees,
  SkyCubeBackgroundFormat,
} from '@/types/environment'
import { getLastExtensionFromFilenameOrUrl, isHdriLikeExtension, isImageLikeExtension } from '@harmony/schema'
import type { SceneSkyboxSettings } from '@harmony/schema'
import type { SkyboxParameterKey } from '@/types/skybox'
import { SKYBOX_PRESETS, CUSTOM_SKYBOX_PRESET_ID, cloneSkyboxSettings } from '@/stores/skyboxPresets'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'


const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { environmentSettings: storeEnvironmentSettings, shadowsEnabled, skybox } = storeToRefs(sceneStore)

const environmentSettings = computed(() => storeEnvironmentSettings.value)

// --- Skybox settings (shown when background mode is 'skybox') ---
const skyboxSettings = computed(() => skybox.value)
const localSkyboxSettings = ref<SceneSkyboxSettings>(cloneSkyboxSettings(skyboxSettings.value))

watch(
  skyboxSettings,
  (next) => {
    localSkyboxSettings.value = cloneSkyboxSettings(next)
  },
  { immediate: true },
)

const skyboxPresetOptions = computed(() => [
  ...SKYBOX_PRESETS.map((preset) => ({ title: preset.name, value: preset.id })),
  { title: 'Custom', value: CUSTOM_SKYBOX_PRESET_ID },
])

function handleSkyboxPresetSelect(presetId: string | null) {
  if (!presetId || presetId === CUSTOM_SKYBOX_PRESET_ID) {
    return
  }
  sceneStore.applySkyboxPreset(presetId)
}

function onSkyboxChange(key: SkyboxParameterKey, value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  if (Math.abs(numeric - localSkyboxSettings.value[key]) < 1e-6) {
    return
  }
  localSkyboxSettings.value = {
    ...localSkyboxSettings.value,
    [key]: numeric,
  }
  sceneStore.setSkyboxSettings({ [key]: numeric } as Partial<SceneSkyboxSettings>, { markCustom: true })
}

const backgroundModeOptions: Array<{ title: string; value: EnvironmentBackgroundMode }> = [
  { title: 'Skybox', value: 'skybox' },
  { title: 'Solid Color', value: 'solidColor' },
  { title: 'HDRI', value: 'hdri' },
  { title: 'SkyCube', value: 'skycube' },
]

const orientationPresetOptions: Array<{ title: string; value: EnvironmentOrientationPreset }> = [
  { title: '+Y Up (Three default)', value: 'yUp' },
  { title: '+Z Up (Z-up assets)', value: 'zUp' },
  { title: '+X Up (X-up assets)', value: 'xUp' },
  { title: 'Custom', value: 'custom' },
]

const backgroundColorMenuOpen = ref(false)
const gradientTopColorMenuOpen = ref(false)

const DEFAULT_GRADIENT_OFFSET = 33
const DEFAULT_GRADIENT_EXPONENT = 0.6

const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
type SkyCubeFaceKey = 'positiveXAssetId' | 'negativeXAssetId' | 'positiveYAssetId' | 'negativeYAssetId' | 'positiveZAssetId' | 'negativeZAssetId'
type AssetDialogTarget = 'background' | 'skycubeZip' | SkyCubeFaceKey
const assetDialogTarget = ref<AssetDialogTarget | null>(null)

const HDRI_ASSET_TYPE = 'hdri' as const
const SKYCUBE_ASSET_TYPE = 'image,texture,file' as const

const skyCubeFormatOptions: Array<{ title: string; value: SkyCubeBackgroundFormat }> = [
  { title: 'Six Images', value: 'faces' },
  { title: '.skycube (zip)', value: 'zip' },
]

const skyCubeFaceDescriptors: Array<{ key: SkyCubeFaceKey; label: string; description: string }> = [
  { key: 'positiveXAssetId', label: 'px', description: 'Right' },
  { key: 'negativeXAssetId', label: 'nx', description: 'Left' },
  { key: 'positiveYAssetId', label: 'py', description: 'Top' },
  { key: 'negativeYAssetId', label: 'ny', description: 'Bottom' },
  { key: 'positiveZAssetId', label: 'pz', description: 'Front' },
  { key: 'negativeZAssetId', label: 'nz', description: 'Back' },
]

const skyCubeFaceDropState = reactive<Record<SkyCubeFaceKey, boolean>>({
  positiveXAssetId: false,
  negativeXAssetId: false,
  positiveYAssetId: false,
  negativeYAssetId: false,
  positiveZAssetId: false,
  negativeZAssetId: false,
})

const isBackgroundDropActive = ref(false)
const isSkyCubeZipDropActive = ref(false)

const isExponentialFog = computed(() => environmentSettings.value.fogMode === 'exp')
const isLinearFog = computed(() => environmentSettings.value.fogMode === 'linear')

const orientationPreset = computed<EnvironmentOrientationPreset>(() => environmentSettings.value.environmentOrientationPreset ?? 'yUp')
const rotationDegrees = computed<EnvironmentRotationDegrees>(() => environmentSettings.value.environmentRotationDegrees ?? { x: 0, y: 0, z: 0 })
const showOrientationControls = computed(() => {
  const bgMode = environmentSettings.value.background.mode
  return bgMode === 'hdri' || bgMode === 'skycube'
})

const fogModeOptions: Array<{ title: string; value: EnvironmentFogMode }> = [
  { title: 'No Fog', value: 'none' },
  { title: 'Linear Fog', value: 'linear' },
  { title: 'Exponential Fog', value: 'exp' },
]

type LinearFogPreset = 'light' | 'medium' | 'heavy' | 'custom'
type ExpFogPreset = 'light' | 'medium' | 'heavy' | 'custom'

const linearFogPresetOptions: Array<{ title: string; value: LinearFogPreset }> = [
  { title: 'Light Fog', value: 'light' },
  { title: 'Medium Fog', value: 'medium' },
  { title: 'Heavy Fog', value: 'heavy' },
  { title: 'Custom', value: 'custom' },
]

const expFogPresetOptions: Array<{ title: string; value: ExpFogPreset }> = [
  { title: 'Light Fog', value: 'light' },
  { title: 'Medium Fog', value: 'medium' },
  { title: 'Heavy Fog', value: 'heavy' },
  { title: 'Custom', value: 'custom' },
]

const LINEAR_FOG_PRESETS: Record<Exclude<LinearFogPreset, 'custom'>, { near: number; far: number }> = {
  light: { near: 100, far: 500 },
  medium: { near: 50, far: 300 },
  heavy: { near: 10, far: 100 },
}

const EXP_FOG_PRESETS: Record<Exclude<ExpFogPreset, 'custom'>, { density: number }> = {
  light: { density: 0.001 },
  medium: { density: 0.01 },
  heavy: { density: 0.1 },
}

const DEFAULT_LINEAR_FOG_NEAR = 1
const DEFAULT_LINEAR_FOG_FAR = 50

const selectedLinearFogPreset = computed<LinearFogPreset>(() => {
  if (environmentSettings.value.fogMode !== 'linear') {
    return 'custom'
  }
  const epsilon = 1e-6
  const near = environmentSettings.value.fogNear
  const far = environmentSettings.value.fogFar
  const presets: Array<Exclude<LinearFogPreset, 'custom'>> = ['light', 'medium', 'heavy']
  for (const preset of presets) {
    const presetSettings = LINEAR_FOG_PRESETS[preset]
    if (Math.abs(near - presetSettings.near) <= epsilon && Math.abs(far - presetSettings.far) <= epsilon) {
      return preset
    }
  }
  return 'custom'
})

const selectedExpFogPreset = computed<ExpFogPreset>(() => {
  if (environmentSettings.value.fogMode !== 'exp') {
    return 'custom'
  }
  const epsilon = 1e-6
  const density = environmentSettings.value.fogDensity
  const presets: Array<Exclude<ExpFogPreset, 'custom'>> = ['light', 'medium', 'heavy']
  for (const preset of presets) {
    const presetSettings = EXP_FOG_PRESETS[preset]
    if (Math.abs(density - presetSettings.density) <= epsilon) {
      return preset
    }
  }
  return 'custom'
})

const backgroundAsset = computed(() => {
  const assetId = environmentSettings.value.background.hdriAssetId
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

const backgroundPreviewStyle = computed(() => resolveAssetPreviewStyle(backgroundAsset.value))

const assetDialogTitle = computed(() => {
  if (assetDialogTarget.value === 'background') {
    return 'Select Background HDRI'
  }
  if (assetDialogTarget.value === 'skycubeZip') {
    return 'Select SkyCube .skycube Zip'
  }
  if (assetDialogTarget.value) {
    const descriptor = skyCubeFaceDescriptors.find((entry) => entry.key === assetDialogTarget.value)
    if (descriptor) {
      return `Select SkyCube ${descriptor.label} Face (${descriptor.description})`
    }
  }
  return 'Select Asset'
})

const assetDialogAssetType = computed(() => {
  if (!assetDialogTarget.value) {
    return HDRI_ASSET_TYPE
  }
  if (assetDialogTarget.value === 'background') {
    return HDRI_ASSET_TYPE
  }
  return SKYCUBE_ASSET_TYPE
})

const assetDialogExtensions = computed(() => {
  if (assetDialogTarget.value === 'skycubeZip') {
    return ['skycube']
  }
  return undefined
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
      gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
      gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
      gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
      hdriAssetId: environmentSettings.value.background.hdriAssetId,
    },
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

function handleHexColorChange(target: 'background', value: string | null) {
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
        gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
        gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
        gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
        hdriAssetId: environmentSettings.value.background.hdriAssetId,
      },
    })
  }
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
    sceneStore.patchEnvironmentSettings({
      background: {
        mode: environmentSettings.value.background.mode,
        solidColor: environmentSettings.value.background.solidColor,
        gradientTopColor: null,
        gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
        gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
        hdriAssetId: environmentSettings.value.background.hdriAssetId,
      },
    })
    return
  }
  const normalized = normalizeHexColor(trimmed, current.length ? current : '#ffffff')
  if (normalized === (environmentSettings.value.background.gradientTopColor ?? null)) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: environmentSettings.value.background.mode,
      solidColor: environmentSettings.value.background.solidColor,
      gradientTopColor: normalized,
      gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
      gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
      hdriAssetId: environmentSettings.value.background.hdriAssetId,
    },
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
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: environmentSettings.value.background.mode,
      solidColor: environmentSettings.value.background.solidColor,
      gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
      gradientOffset: clamped,
      gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
      hdriAssetId: environmentSettings.value.background.hdriAssetId,
    },
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
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: environmentSettings.value.background.mode,
      solidColor: environmentSettings.value.background.solidColor,
      gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
      gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
      gradientExponent: clamped,
      hdriAssetId: environmentSettings.value.background.hdriAssetId,
    },
  })
}

function clearBackgroundAsset() {
  if (environmentSettings.value.background.mode !== 'hdri') {
    return
  }
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: 'solidColor',
      solidColor: environmentSettings.value.background.solidColor,
      gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
      gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
      gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
      hdriAssetId: null,
    },
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

function handleFogModeChange(mode: EnvironmentFogMode | null) {
  if (!mode || mode === environmentSettings.value.fogMode) {
    return
  }
  if (mode === 'none') {
    sceneStore.patchEnvironmentSettings({ fogMode: 'none' })
    return
  }
  if (mode === 'linear') {
    const presetSettings = LINEAR_FOG_PRESETS.light
    const near = Number.isFinite(presetSettings.near) ? presetSettings.near : DEFAULT_LINEAR_FOG_NEAR
    const far = Number.isFinite(presetSettings.far) ? presetSettings.far : DEFAULT_LINEAR_FOG_FAR
    sceneStore.patchEnvironmentSettings({
      fogMode: 'linear',
      fogNear: Math.max(0, near),
      fogFar: Math.max(Math.max(0, near) + 0.001, far),
    })
    return
  }
  // exp
  const expPreset = EXP_FOG_PRESETS.light
  sceneStore.patchEnvironmentSettings({
    fogMode: 'exp',
    fogDensity: expPreset.density,
  })
}

function applyLinearFogPreset(preset: unknown) {
  if (preset === null || preset === undefined) {
    return
  }
  if (preset === 'custom') {
    if (environmentSettings.value.fogMode !== 'linear') {
      sceneStore.patchEnvironmentSettings({ fogMode: 'linear' })
    }
    return
  }
  if (preset !== 'light' && preset !== 'medium' && preset !== 'heavy') {
    return
  }
  const presetSettings = LINEAR_FOG_PRESETS[preset]
  const nextNear = Math.max(0, presetSettings.near)
  const nextFar = Math.max(nextNear + 0.001, presetSettings.far)
  const shouldPatchMode = environmentSettings.value.fogMode !== 'linear'
  const shouldPatchNear = Math.abs(environmentSettings.value.fogNear - nextNear) > 1e-6
  const shouldPatchFar = Math.abs(environmentSettings.value.fogFar - nextFar) > 1e-6
  if (!shouldPatchMode && !shouldPatchNear && !shouldPatchFar) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    fogMode: 'linear',
    fogNear: nextNear,
    fogFar: nextFar,
  })
}

function applyExpFogPreset(preset: unknown) {
  if (preset === null || preset === undefined) {
    return
  }
  if (preset === 'custom') {
    if (environmentSettings.value.fogMode !== 'exp') {
      sceneStore.patchEnvironmentSettings({ fogMode: 'exp' })
    }
    return
  }
  if (preset !== 'light' && preset !== 'medium' && preset !== 'heavy') {
    return
  }
  const presetSettings = EXP_FOG_PRESETS[preset]
  const nextDensity = presetSettings.density
  const shouldPatchMode = environmentSettings.value.fogMode !== 'exp'
  const shouldPatchDensity = Math.abs(environmentSettings.value.fogDensity - nextDensity) > 1e-6
  if (!shouldPatchMode && !shouldPatchDensity) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    fogMode: 'exp',
    fogDensity: nextDensity,
  })
}

function handleFogNearInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(100000, numeric))
  const nextFar = Math.max(clamped + 0.001, environmentSettings.value.fogFar)
  if (Math.abs(clamped - environmentSettings.value.fogNear) < 1e-4 && Math.abs(nextFar - environmentSettings.value.fogFar) < 1e-4) {
    return
  }
  sceneStore.patchEnvironmentSettings({ fogNear: clamped, fogFar: nextFar })
}

function handleFogFarInput(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const minFar = environmentSettings.value.fogNear + 0.001
  const clamped = Math.max(minFar, Math.min(100000, numeric))
  if (Math.abs(clamped - environmentSettings.value.fogFar) < 1e-4) {
    return
  }
  sceneStore.patchEnvironmentSettings({ fogFar: clamped })
}

function formatFogNear(): string {
  return environmentSettings.value.fogNear.toFixed(2)
}

function formatFogFar(): string {
  return environmentSettings.value.fogFar.toFixed(2)
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
  return getLastExtensionFromFilenameOrUrl(source)
}

function isHdrExtension(extension: string | null): boolean {
  return isHdriLikeExtension(extension)
}

function isImageExtension(extension: string | null): boolean {
  return isImageLikeExtension(extension)
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

function isSkyCubeFaceAsset(asset: ProjectAsset | null): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  if (asset.type === 'image' || asset.type === 'texture') {
    return true
  }
  if (asset.type === 'file') {
    return isImageExtension(inferAssetExtension(asset))
  }
  return false
}

function isSkyCubeZipAsset(asset: ProjectAsset | null): asset is ProjectAsset {
  if (!asset) {
    return false
  }
  if (asset.type !== 'file') {
    return false
  }
  const ext = inferAssetExtension(asset)
  return (ext ?? '').toLowerCase() === 'skycube'
}

const skyCubeFormat = computed<SkyCubeBackgroundFormat>(() => environmentSettings.value.background.skycubeFormat ?? 'faces')

const skyCubeZipAsset = computed(() => {
  const assetId = environmentSettings.value.background.skycubeZipAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const skyCubeZipAssetLabel = computed(() => {
  const asset = skyCubeZipAsset.value
  if (!asset) {
    return 'Drag .skycube asset here'
  }
  return asset.name?.trim().length ? asset.name : asset.id
})

const skyCubeZipAssetHint = computed(() => {
  const asset = skyCubeZipAsset.value
  if (!asset) {
    return 'Zip containing px/nx/py/ny/pz/nz face images'
  }
  return asset.id
})

function updateSkyCubeFormat(format: SkyCubeBackgroundFormat | null) {
  if (!format) {
    return
  }
  if (environmentSettings.value.background.mode !== 'skycube') {
    return
  }
  if (format === environmentSettings.value.background.skycubeFormat) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: 'skycube',
      skycubeFormat: format,
      // Keep other fields intact; clearing is handled by user actions.
    },
  })
}

function openSkyCubeZipDialog(event?: MouseEvent) {
  if (event) {
    assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  } else {
    assetDialogAnchor.value = null
  }
  assetDialogTarget.value = 'skycubeZip'
  assetDialogSelectedId.value = environmentSettings.value.background.skycubeZipAssetId ?? ''
  assetDialogVisible.value = true
}

function clearSkyCubeZipAsset() {
  if (environmentSettings.value.background.mode !== 'skycube') {
    return
  }
  if (!environmentSettings.value.background.skycubeZipAssetId) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    background: {
      skycubeZipAssetId: null,
    },
  })
}

function handleSkyCubeZipDragEnter(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isSkyCubeZipAsset(asset)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isSkyCubeZipDropActive.value = true
}

function handleSkyCubeZipDragOver(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isSkyCubeZipAsset(asset)) {
    if (isSkyCubeZipDropActive.value) {
      isSkyCubeZipDropActive.value = false
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isSkyCubeZipDropActive.value = true
}

function handleSkyCubeZipDragLeave(event: DragEvent) {
  if (!isSkyCubeZipDropActive.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  isSkyCubeZipDropActive.value = false
}

function handleSkyCubeZipDrop(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  isSkyCubeZipDropActive.value = false
  if (!isSkyCubeZipAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: 'skycube',
      skycubeFormat: 'zip',
      skycubeZipAssetId: asset.id,
    },
  })
}

const skyCubeFaceEntries = computed(() => {
  const background = environmentSettings.value.background
  return skyCubeFaceDescriptors.map((descriptor) => {
    const assetId = background[descriptor.key]
    const asset = assetId ? sceneStore.getAsset(assetId) ?? null : null
    return {
      ...descriptor,
      assetId: assetId ?? null,
      asset,
      previewStyle: resolveAssetPreviewStyle(asset),
      hasValue: Boolean(assetId && String(assetId).trim().length),
    }
  })
})

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

function applyEnvironmentAsset(target: 'background' | 'environment', asset: ProjectAsset) {
  if (target !== 'background') {
    return
  }
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: 'hdri',
      solidColor: environmentSettings.value.background.solidColor,
      gradientTopColor: environmentSettings.value.background.gradientTopColor ?? null,
      gradientOffset: environmentSettings.value.background.gradientOffset ?? DEFAULT_GRADIENT_OFFSET,
      gradientExponent: environmentSettings.value.background.gradientExponent ?? DEFAULT_GRADIENT_EXPONENT,
      hdriAssetId: asset.id,
    },
  })
}

function openAssetDialog(target: 'background', event?: MouseEvent) {
  if (event) {
    assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  } else {
    assetDialogAnchor.value = null
  }
  assetDialogTarget.value = target
  assetDialogSelectedId.value = environmentSettings.value.background.hdriAssetId ?? ''
  assetDialogVisible.value = true
}

function openSkyCubeFaceDialog(face: SkyCubeFaceKey, event?: MouseEvent) {
  if (event) {
    assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  } else {
    assetDialogAnchor.value = null
  }
  assetDialogTarget.value = face
  assetDialogSelectedId.value = environmentSettings.value.background[face] ?? ''
  assetDialogVisible.value = true
}

function clearSkyCubeFace(face: SkyCubeFaceKey) {
  if (environmentSettings.value.background.mode !== 'skycube') {
    return
  }
  if (!environmentSettings.value.background[face]) {
    return
  }
  sceneStore.patchEnvironmentSettings({
    background: {
      [face]: null,
    },
  })
}

function handleAssetDialogUpdate(asset: ProjectAsset | null) {
  if (!assetDialogTarget.value) {
    return
  }
  if (assetDialogTarget.value === 'skycubeZip') {
    if (!asset) {
      sceneStore.patchEnvironmentSettings({ background: { skycubeZipAssetId: null } })
      assetDialogVisible.value = false
      return
    }
    if (!isSkyCubeZipAsset(asset)) {
      console.warn('Selected asset is not a supported .skycube zip')
      return
    }
    sceneStore.patchEnvironmentSettings({
      background: {
        mode: 'skycube',
        skycubeFormat: 'zip',
        skycubeZipAssetId: asset.id,
      },
    })
    assetDialogVisible.value = false
    return
  }
  if (assetDialogTarget.value !== 'background') {
    const faceKey = assetDialogTarget.value
    if (!asset) {
      sceneStore.patchEnvironmentSettings({ background: { [faceKey]: null } })
      assetDialogVisible.value = false
      return
    }
    if (!isSkyCubeFaceAsset(asset)) {
      console.warn('Selected asset is not a supported SkyCube face texture')
      return
    }
    sceneStore.patchEnvironmentSettings({
      background: {
        mode: 'skycube',
        [faceKey]: asset.id,
      },
    })
    assetDialogVisible.value = false
    return
  }
  if (!asset) {
    sceneStore.patchEnvironmentSettings({
      background: {
        mode: environmentSettings.value.background.mode,
        solidColor: environmentSettings.value.background.solidColor,
        hdriAssetId: '',
      },
    })
    assetDialogVisible.value = false
    return
  }
  if (!isEnvironmentAsset(asset)) {
    console.warn('Selected asset is not a supported environment asset')
    return
  }
  if (assetDialogTarget.value === 'background') {
    applyEnvironmentAsset('background', asset)
  }
  assetDialogVisible.value = false
}

function handleSkyCubeFaceDragEnter(face: SkyCubeFaceKey, event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isSkyCubeFaceAsset(asset)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  skyCubeFaceDropState[face] = true
}

function handleSkyCubeFaceDragOver(face: SkyCubeFaceKey, event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isSkyCubeFaceAsset(asset)) {
    if (skyCubeFaceDropState[face]) {
      skyCubeFaceDropState[face] = false
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  skyCubeFaceDropState[face] = true
}

function handleSkyCubeFaceDragLeave(face: SkyCubeFaceKey, event: DragEvent) {
  if (!skyCubeFaceDropState[face]) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  skyCubeFaceDropState[face] = false
}

function handleSkyCubeFaceDrop(face: SkyCubeFaceKey, event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  skyCubeFaceDropState[face] = false
  if (!isSkyCubeFaceAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  sceneStore.patchEnvironmentSettings({
    background: {
      mode: 'skycube',
      [face]: asset.id,
    },
  })
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
            :model-value="environmentSettings.background.mode"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            @update:model-value="(mode) => updateBackgroundMode(mode as EnvironmentBackgroundMode | null)"
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
            v-if="environmentSettings.background.mode === 'skybox'"
            class="skybox-settings"
          >
            <div class="sky-section">
              <div class="section-label">Skybox Preset</div>
              <v-select
                :items="skyboxPresetOptions"
                :model-value="localSkyboxSettings.presetId"
                density="compact"
                hide-details
                variant="underlined"
                class="sky-select"
                @update:model-value="handleSkyboxPresetSelect"
              />
            </div>
            <div class="sky-slider">
              <div class="slider-label"><span>Exposure</span></div>
              <v-text-field
                :model-value="localSkyboxSettings.exposure"
                :min="0.05" :max="2.00" :step="0.01"
                type="number" inputmode="decimal"
                density="compact" variant="underlined" hide-details color="primary"
                @update:model-value="(value) => onSkyboxChange('exposure', value)"
              />
            </div>
            <div class="sky-slider">
              <div class="slider-label"><span>Turbidity</span></div>
              <v-text-field
                :model-value="localSkyboxSettings.turbidity"
                :min="1.00" :max="20.00" :step="0.1"
                type="number" inputmode="decimal"
                density="compact" variant="underlined" hide-details color="primary"
                @update:model-value="(value) => onSkyboxChange('turbidity', value)"
              />
            </div>
            <div class="sky-slider">
              <div class="slider-label"><span>Rayleigh Scattering</span></div>
              <v-text-field
                :model-value="localSkyboxSettings.rayleigh"
                :min="0.00" :max="5.00" :step="0.05"
                type="number" inputmode="decimal"
                density="compact" variant="underlined" hide-details color="primary"
                @update:model-value="(value) => onSkyboxChange('rayleigh', value)"
              />
            </div>
            <div class="sky-slider">
              <div class="slider-label"><span>Mie Coefficient</span></div>
              <v-text-field
                :model-value="localSkyboxSettings.mieCoefficient"
                :min="0.00" :max="0.05" :step="0.0005"
                type="number" inputmode="decimal"
                density="compact" variant="underlined" hide-details color="primary"
                @update:model-value="(value) => onSkyboxChange('mieCoefficient', value)"
              />
            </div>
            <div class="sky-slider">
              <div class="slider-label"><span>Mie Directionality</span></div>
              <v-text-field
                :model-value="localSkyboxSettings.mieDirectionalG"
                :min="0" :max="1" :step="0.01"
                type="number" inputmode="decimal"
                density="compact" variant="underlined" hide-details color="primary"
                @update:model-value="(value) => onSkyboxChange('mieDirectionalG', value)"
              />
            </div>
            <div class="sky-slider">
              <div class="slider-label"><span>Sun Elevation</span></div>
              <v-text-field
                :model-value="localSkyboxSettings.elevation"
                :min="-10" :max="90" :step="1"
                type="number" inputmode="numeric"
                density="compact" variant="underlined" hide-details color="primary"
                @update:model-value="(value) => onSkyboxChange('elevation', value)"
              />
            </div>
            <div class="sky-slider">
              <div class="slider-label"><span>Sun Azimuth</span></div>
              <v-text-field
                :model-value="localSkyboxSettings.azimuth"
                :min="0" :max="360" :step="1"
                type="number" inputmode="numeric"
                density="compact" variant="underlined" hide-details color="primary"
                @update:model-value="(value) => onSkyboxChange('azimuth', value)"
              />
            </div>
          </div>
          <div
            v-else-if="environmentSettings.background.mode === 'solidColor'"
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
          <template v-else-if="environmentSettings.background.mode === 'skycube'">
            <v-select
              :items="skyCubeFormatOptions"
              :model-value="skyCubeFormat"
              density="compact"
              hide-details
              variant="underlined"
              class="section-select"
              label="Format"
              @update:model-value="(value) => updateSkyCubeFormat(value as SkyCubeBackgroundFormat | null)"
            />

            <div
              v-if="skyCubeFormat === 'zip'"
              class="asset-tile"
              :class="{ 'is-active-drop': isSkyCubeZipDropActive }"
              @dragenter="handleSkyCubeZipDragEnter"
              @dragover="handleSkyCubeZipDragOver"
              @dragleave="handleSkyCubeZipDragLeave"
              @drop="handleSkyCubeZipDrop"
            >
              <div
                class="asset-thumb"
                :class="{ 'asset-thumb--empty': !skyCubeZipAsset }"
                role="button"
                tabindex="0"
                :title="skyCubeZipAsset ? 'Change .skycube asset' : 'Select .skycube asset'"
                @click="openSkyCubeZipDialog($event)"
                @keydown.enter.prevent="openSkyCubeZipDialog()"
                @keydown.space.prevent="openSkyCubeZipDialog()"
              >
                <v-icon size="20" color="rgba(233, 236, 241, 0.4)">mdi-zip-box</v-icon>
              </div>
              <div
                class="asset-info"
                role="button"
                tabindex="0"
                @click="openSkyCubeZipDialog($event)"
                @keydown.enter.prevent="openSkyCubeZipDialog()"
                @keydown.space.prevent="openSkyCubeZipDialog()"
              >
                <div class="asset-name">{{ skyCubeZipAssetLabel }}</div>
                <div class="asset-hint">{{ skyCubeZipAssetHint }}</div>
              </div>
              <div class="asset-actions">
                <v-btn
                  class="asset-action"
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  :disabled="!skyCubeZipAsset"
                  title="Clear .skycube"
                  @click.stop="clearSkyCubeZipAsset"
                />
              </div>
            </div>

            <div class="cube-face-grid">
              <div
                v-for="face in skyCubeFaceEntries"
                :key="face.key"
                class="asset-tile cube-face-tile"
                :class="{
                  'is-active-drop': skyCubeFaceDropState[face.key],
                  'is-empty': !face.hasValue,
                }"
                @dragenter="(event) => handleSkyCubeFaceDragEnter(face.key, event)"
                @dragover="(event) => handleSkyCubeFaceDragOver(face.key, event)"
                @dragleave="(event) => handleSkyCubeFaceDragLeave(face.key, event)"
                @drop="(event) => handleSkyCubeFaceDrop(face.key, event)"
                v-show="skyCubeFormat !== 'zip'"
              >
                <div
                  class="asset-thumb"
                  :class="{ 'asset-thumb--empty': !face.asset }"
                  :style="face.previewStyle"
                  role="button"
                  tabindex="0"
                  :title="`Select ${face.label} face texture`"
                  @click="(event) => openSkyCubeFaceDialog(face.key, event)"
                  @keydown.enter.prevent="openSkyCubeFaceDialog(face.key)"
                  @keydown.space.prevent="openSkyCubeFaceDialog(face.key)"
                >
                  <span v-if="!face.asset" class="cube-face-thumb-label">{{ face.label }}</span>
                </div>
                <div
                  class="asset-info"
                  role="button"
                  tabindex="0"
                  @click="(event) => openSkyCubeFaceDialog(face.key, event)"
                  @keydown.enter.prevent="openSkyCubeFaceDialog(face.key)"
                  @keydown.space.prevent="openSkyCubeFaceDialog(face.key)"
                >
                  <div
                    v-if="face.asset"
                    class="asset-name"
                    :title="face.asset.name?.trim().length ? face.asset.name : face.asset.id"
                  >
                    {{ face.asset.name?.trim().length ? face.asset.name : face.asset.id }}
                  </div>
                  <div class="asset-face-label">
                    <span class="asset-face-axis">{{ face.label }}</span>
                    <span
                      v-if="face.description"
                      class="asset-face-description"
                    >{{ face.description }}</span>
                  </div>
                  <div v-if="!face.hasValue" class="asset-hint">Select texture</div>
                </div>
                <div class="asset-actions">
                  <v-btn
                    class="asset-action"
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    :disabled="!face.hasValue"
                    title="Clear face texture"
                    @click.stop="clearSkyCubeFace(face.key)"
                  />
                </div>
              </div>
            </div>

    
   
          </template>
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
              <div class="asset-name" :title="backgroundAssetLabel">{{ backgroundAssetLabel }}</div>
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
          <v-select
            :items="fogModeOptions"
            :model-value="environmentSettings.fogMode"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            @update:model-value="(mode) => handleFogModeChange(mode as EnvironmentFogMode | null)"
          />

          <v-select
            v-if="isLinearFog"
            :items="linearFogPresetOptions"
            :model-value="selectedLinearFogPreset"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            @update:model-value="applyLinearFogPreset"
          />

          <v-select
            v-if="isExponentialFog"
            :items="expFogPresetOptions"
            :model-value="selectedExpFogPreset"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            @update:model-value="applyExpFogPreset"
          />

          <div v-if="isExponentialFog" class="slider-row">
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
              @update:model-value="handleFogDensityInput"
            />
          </div>

          <div v-if="isLinearFog" class="slider-row">
            <v-text-field
              class="slider-input"
              label="Near"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="100000"
              :step="0.1"
              :model-value="formatFogNear()"
              @update:model-value="handleFogNearInput"
            />
          </div>
          <div v-if="isLinearFog" class="slider-row">
            <v-text-field
              class="slider-input"
              label="Far"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="100000"
              :step="0.1"
              :model-value="formatFogFar()"
              @update:model-value="handleFogFarInput"
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

.skybox-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 0;
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
</style>
