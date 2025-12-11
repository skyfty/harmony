<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  SceneCloudSettings,
  SceneCloudImplementation,
  SceneCubeTextureCloudSettings,
  SceneSphericalCloudSettings,
  SceneVolumetricCloudSettings,
} from '@harmony/schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import AssetDialog from '@/components/common/AssetDialog.vue'
import {
  cloneCloudSettings,
  cloudSettingsEqual,
  createDefaultCloudSettings,
  sanitizeCloudSettings,
} from '@schema/cloudRenderer'

const ASSET_DRAG_MIME = 'application/x-harmony-asset'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { skybox } = storeToRefs(sceneStore)

type CloudModeOption = SceneCloudImplementation | 'none'
type CubeFaceKey = keyof Pick<SceneCubeTextureCloudSettings, 'positiveX' | 'negativeX' | 'positiveY' | 'negativeY' | 'positiveZ' | 'negativeZ'>

type AssetDialogTarget = CubeFaceKey | 'sphericalTexture'

const cubeFaceDescriptors: Array<{ key: CubeFaceKey; label: string; description: string }> = [
  { key: 'positiveX', label: '+X', description: 'Right' },
  { key: 'negativeX', label: '-X', description: 'Left' },
  { key: 'positiveY', label: '+Y', description: 'Top' },
  { key: 'negativeY', label: '-Y', description: 'Bottom' },
  { key: 'positiveZ', label: '+Z', description: 'Front' },
  { key: 'negativeZ', label: '-Z', description: 'Back' },
]

const modeOptions: Array<{ title: string; value: CloudModeOption }> = [
  { title: 'Disabled', value: 'none' },
  { title: 'Cube Texture Loader', value: 'cubeTexture' },
  { title: 'Spherical Cloud Layer', value: 'spherical' },
  { title: 'Volumetric Clouds', value: 'volumetric' },
]

const localSettings = ref<SceneCloudSettings | null>(cloneCloudSettings(skybox.value.clouds))
const cubeFaceDropState = reactive<Record<CubeFaceKey, boolean>>({
  positiveX: false,
  negativeX: false,
  positiveY: false,
  negativeY: false,
  positiveZ: false,
  negativeZ: false,
})
const assetDialogVisible = ref(false)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const assetDialogTarget = ref<AssetDialogTarget | null>(null)
const ASSET_DIALOG_TYPES = 'image,texture'
const sphericalDropActive = ref(false)
const sphericalColorMenuOpen = ref(false)
const volumetricColorMenuOpen = ref(false)

watch(
  () => skybox.value.clouds,
  (next) => {
    const sanitized = sanitizeCloudSettings(next)
    localSettings.value = sanitized ? cloneCloudSettings(sanitized) : null
  },
  { immediate: true },
)

const currentMode = computed<CloudModeOption>(() => localSettings.value?.mode ?? 'none')

const cubeSettings = computed(() =>
  localSettings.value?.mode === 'cubeTexture'
    ? (localSettings.value as SceneCubeTextureCloudSettings)
    : null,
)

const sphericalSettings = computed(() =>
  localSettings.value?.mode === 'spherical'
    ? (localSettings.value as SceneSphericalCloudSettings)
    : null,
)

const volumetricSettings = computed(() =>
  localSettings.value?.mode === 'volumetric'
    ? (localSettings.value as SceneVolumetricCloudSettings)
    : null,
)

const cubeFaceEntries = computed(() => {
  const settings = cubeSettings.value
  return cubeFaceDescriptors.map((descriptor) => {
    const source = settings ? settings[descriptor.key] ?? '' : ''
    const normalizedId = normalizeAssetReference(source)
    const asset = normalizedId ? sceneStore.getAsset(normalizedId) ?? null : null
    const trimmedSource = source.trim()
    const displayName = asset
      ? asset.name?.trim().length ? asset.name : asset.id
      : trimmedSource.length ? truncateLabel(trimmedSource) : 'Drag texture asset here'
    const displayHint = asset
      ? asset.id
      : trimmedSource.length ? 'External reference' : 'PNG, JPG, EXR supported'
    return {
      ...descriptor,
      source,
      asset,
      displayName,
      displayHint,
      previewStyle: resolveAssetPreviewStyle(asset),
      hasValue: trimmedSource.length > 0,
    }
  })
})

const sphericalTextureEntry = computed(() => {
  const settings = sphericalSettings.value
  const source = settings?.textureAssetId ?? ''
  const normalizedId = normalizeAssetReference(source)
  const asset = normalizedId ? sceneStore.getAsset(normalizedId) ?? null : null
  const trimmedSource = source.trim()
  const displayName = asset
    ? asset.name?.trim().length ? asset.name : asset.id
    : trimmedSource.length ? truncateLabel(trimmedSource) : 'Drag texture asset here'
  const displayHint = asset
    ? asset.id
    : trimmedSource.length ? 'External reference' : 'Optional diffuse texture'
  return {
    source,
    asset,
    displayName,
    displayHint,
    previewStyle: resolveAssetPreviewStyle(asset),
    hasValue: trimmedSource.length > 0,
  }
})

const assetDialogTitle = computed(() => {
  if (!assetDialogTarget.value) {
    return '选择云层贴图'
  }
  if (assetDialogTarget.value === 'sphericalTexture') {
    return '选择云层纹理贴图'
  }
  const descriptor = cubeFaceDescriptors.find((entry) => entry.key === assetDialogTarget.value)
  if (!descriptor) {
    return '选择云层贴图'
  }
  return `选择 ${descriptor.label} 面贴图`
})

watch(assetDialogVisible, (open) => {
  if (!open) {
    assetDialogTarget.value = null
    assetDialogAnchor.value = null
    assetDialogSelectedId.value = ''
  }
})

function commitSettings(candidate: SceneCloudSettings | null) {
  const sanitized = sanitizeCloudSettings(candidate)
  if (cloudSettingsEqual(localSettings.value ?? null, sanitized ?? null)) {
    return
  }
  localSettings.value = sanitized ? cloneCloudSettings(sanitized) : null
  sceneStore.setSkyboxSettings({ clouds: sanitized ?? null }, { markCustom: true })
}

function handleModeChange(mode: CloudModeOption) {
  if (mode === currentMode.value) {
    return
  }
  if (mode === 'none') {
    commitSettings(null)
    return
  }
  const next = localSettings.value?.mode === mode
    ? cloneCloudSettings(localSettings.value)
    : createDefaultCloudSettings(mode)
  commitSettings(next)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function handleCubeIntensityInput(value: unknown) {
  const current = cubeSettings.value
  if (!current) {
    return
  }
  const parsed = toNumber(value)
  if (parsed === null) {
    return
  }
  commitSettings({ ...current, intensity: parsed })
}

function handleSphericalStringInput(key: 'textureAssetId' | 'color', value: unknown) {
  const current = sphericalSettings.value
  if (!current) {
    return
  }
  const raw = typeof value === 'string'
    ? value
    : value == null
      ? ''
      : String(value)
  if (key === 'color') {
    const normalized = normalizeHexColor(raw, current.color)
    if (normalized === current.color) {
      return
    }
    commitSettings({ ...current, color: normalized })
    return
  }
  const next = raw
  if (next === current.textureAssetId) {
    return
  }
  commitSettings({ ...current, textureAssetId: next })
}

function handleSphericalNumberInput(key: 'radius' | 'opacity' | 'rotationSpeed' | 'height', value: unknown) {
  const current = sphericalSettings.value
  if (!current) {
    return
  }
  const parsed = toNumber(value)
  if (parsed === null) {
    return
  }
  commitSettings({ ...current, [key]: parsed })
}

function handleVolumetricStringInput(value: unknown) {
  const current = volumetricSettings.value
  if (!current) {
    return
  }
  const raw = typeof value === 'string'
    ? value
    : value == null
      ? ''
      : String(value)
  const normalized = normalizeHexColor(raw, current.color)
  if (normalized === current.color) {
    return
  }
  commitSettings({ ...current, color: normalized })
}

function handleVolumetricNumberInput(key: 'density' | 'speed' | 'detail' | 'coverage' | 'height' | 'size', value: unknown) {
  const current = volumetricSettings.value
  if (!current) {
    return
  }
  const parsed = toNumber(value)
  if (parsed === null) {
    return
  }
  commitSettings({ ...current, [key]: parsed })
}

function normalizeAssetReference(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) {
    return ''
  }
  return trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
}

function truncateLabel(value: string, limit = 48): string {
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit - 1)}…`
}

function normalizeHexColor(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return fallback
  }
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

function resolveAssetPreviewStyle(asset: ProjectAsset | null): Record<string, string> {
  const fallback = 'rgba(233, 236, 241, 0.08)'
  if (!asset) {
    return { backgroundColor: fallback }
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
    return { backgroundColor: asset.previewColor }
  }
  return { backgroundColor: fallback }
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
  const normalizedId = normalizeAssetReference(payload.assetId)
  return sceneStore.getAsset(normalizedId)
}

function inferAssetExtension(asset: ProjectAsset | null): string | null {
  if (!asset) {
    return null
  }
  const source = asset.name || asset.downloadUrl || asset.id
  const match = source?.match(/\.([a-z0-9]+)(?:$|[?#])/i)
  return match ? (match[1]?.toLowerCase() ?? null) : null
}

function isImageExtension(extension: string | null): boolean {
  if (!extension) {
    return false
  }
  return ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'gif', 'exr', 'hdr'].includes(extension)
}

function isCubeTextureAsset(asset: ProjectAsset | null): asset is ProjectAsset {
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

function applyCubeFaceSource(face: CubeFaceKey, source: string) {
  const current = cubeSettings.value
  if (!current) {
    return
  }
  commitSettings({ ...current, [face]: source })
}

function applySphericalTexture(source: string) {
  const current = sphericalSettings.value
  if (!current) {
    return
  }
  commitSettings({ ...current, textureAssetId: source })
}

function handleCubeFaceDragEnter(face: CubeFaceKey, event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isCubeTextureAsset(asset)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  cubeFaceDropState[face] = true
}

function handleCubeFaceDragOver(face: CubeFaceKey, event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isCubeTextureAsset(asset)) {
    if (cubeFaceDropState[face]) {
      cubeFaceDropState[face] = false
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  cubeFaceDropState[face] = true
}

function handleCubeFaceDragLeave(face: CubeFaceKey, event: DragEvent) {
  if (!cubeFaceDropState[face]) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  cubeFaceDropState[face] = false
}

function handleCubeFaceDrop(face: CubeFaceKey, event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  cubeFaceDropState[face] = false
  if (!isCubeTextureAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  applyCubeFaceSource(face, normalizeAssetReference(asset.id))
}

function openAssetDialogForTarget(target: AssetDialogTarget, event?: MouseEvent) {
  if (event) {
    assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  } else {
    assetDialogAnchor.value = null
  }
  assetDialogTarget.value = target
  const settings = cubeSettings.value
  let current = ''
  if (target === 'sphericalTexture') {
    current = sphericalSettings.value?.textureAssetId ?? ''
  } else if (settings) {
    current = settings[target] ?? ''
  }
  assetDialogSelectedId.value = normalizeAssetReference(current)
  assetDialogVisible.value = true
}

function handleAssetDialogUpdate(asset: ProjectAsset | null) {
  const target = assetDialogTarget.value
  if (!target) {
    return
  }
  if (!asset) {
    assetDialogVisible.value = false
    return
  }
  if (!isCubeTextureAsset(asset)) {
    console.warn('Selected asset is not a supported cloud texture asset')
    return
  }
  if (target === 'sphericalTexture') {
    applySphericalTexture(normalizeAssetReference(asset.id))
  } else {
    applyCubeFaceSource(target, normalizeAssetReference(asset.id))
  }
  assetDialogVisible.value = false
}

function handleAssetDialogCancel() {
  assetDialogVisible.value = false
}

function handleCubeFaceClear(face: CubeFaceKey) {
  const current = cubeSettings.value
  if (!current || !current[face]) {
    return
  }
  commitSettings({ ...current, [face]: '' })
}

function handleSphericalTextureDragEnter(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isCubeTextureAsset(asset)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  sphericalDropActive.value = true
}

function handleSphericalTextureDragOver(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  if (!isCubeTextureAsset(asset)) {
    if (sphericalDropActive.value) {
      sphericalDropActive.value = false
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  sphericalDropActive.value = true
}

function handleSphericalTextureDragLeave(event: DragEvent) {
  if (!sphericalDropActive.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  sphericalDropActive.value = false
}

function handleSphericalTextureDrop(event: DragEvent) {
  const asset = resolveDraggedAsset(event)
  sphericalDropActive.value = false
  if (!isCubeTextureAsset(asset)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  applySphericalTexture(normalizeAssetReference(asset.id))
}

function handleSphericalTextureClear() {
  const current = sphericalSettings.value
  if (!current || !current.textureAssetId) {
    return
  }
  commitSettings({ ...current, textureAssetId: null })
}
</script>

<template>
  <v-expansion-panel value="clouds">
    <v-expansion-panel-title>
      Cloud Layer
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="cloud-panel">
        <div class="cloud-section">
          <v-select
            :items="modeOptions"
            :model-value="currentMode"
            density="compact"
            variant="underlined"
            hide-details
            @update:model-value="handleModeChange"
          />
        </div>

        <template v-if="currentMode === 'cubeTexture' && cubeSettings">
          <div class="section-label">Cubemap Faces</div>
          <div class="cube-face-grid">
            <div
              v-for="face in cubeFaceEntries"
              :key="face.key"
              class="asset-tile cube-face-tile"
              :class="{
                'is-active-drop': cubeFaceDropState[face.key],
                'is-empty': !face.hasValue,
              }"
              @dragenter="(event) => handleCubeFaceDragEnter(face.key, event)"
              @dragover="(event) => handleCubeFaceDragOver(face.key, event)"
              @dragleave="(event) => handleCubeFaceDragLeave(face.key, event)"
              @drop="(event) => handleCubeFaceDrop(face.key, event)"
            >
              <div
                class="asset-thumb"
                :class="{ 'asset-thumb--empty': !face.asset }"
                :style="face.previewStyle"
                role="button"
                tabindex="0"
                :title="`Select ${face.label} face texture`"
                @click="(event) => openAssetDialogForTarget(face.key, event)"
                @keydown.enter.prevent="openAssetDialogForTarget(face.key)"
                @keydown.space.prevent="openAssetDialogForTarget(face.key)"
              >
                <span v-if="!face.asset" class="cube-face-thumb-label">{{ face.label }}</span>
              </div>
              <div
                class="asset-info"
                role="button"
                tabindex="0"
                @click="(event) => openAssetDialogForTarget(face.key, event)"
                @keydown.enter.prevent="openAssetDialogForTarget(face.key)"
                @keydown.space.prevent="openAssetDialogForTarget(face.key)"
              >
                <div class="asset-face-label">
                  <span class="asset-face-axis">{{ face.label }}</span>
                  <span
                    v-if="face.description"
                    class="asset-face-description"
                  >{{ face.description }}</span>
                </div>
                <div class="asset-name">{{ face.displayName }}</div>
                <div class="asset-hint">{{ face.displayHint }}</div>
              </div>
              <div class="asset-actions">
                <v-btn
                  class="asset-action"
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  :disabled="!face.hasValue"
                  title="Clear face texture"
                  @click.stop="handleCubeFaceClear(face.key)"
                />
              </div>
            </div>
          </div>
          <div class="cloud-input">
            <div class="section-label">Intensity</div>
            <v-text-field
              :model-value="cubeSettings.intensity"
              type="number"
              :min="0"
              :max="1"
              :step="0.05"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="handleCubeIntensityInput"
            />
          </div>
        </template>

        <template v-else-if="currentMode === 'spherical' && sphericalSettings">
          <div class="cloud-input">
            <div class="section-label">Texture</div>
            <div
              class="asset-tile cloud-texture-tile"
              :class="{
                'is-active-drop': sphericalDropActive,
                'is-empty': !sphericalTextureEntry.hasValue,
              }"
              @dragenter="handleSphericalTextureDragEnter"
              @dragover="handleSphericalTextureDragOver"
              @dragleave="handleSphericalTextureDragLeave"
              @drop="handleSphericalTextureDrop"
            >
              <div
                class="asset-thumb"
                :class="{ 'asset-thumb--empty': !sphericalTextureEntry.asset }"
                :style="sphericalTextureEntry.previewStyle"
                role="button"
                tabindex="0"
                title="Select spherical cloud texture"
                @click="(event) => openAssetDialogForTarget('sphericalTexture', event)"
                @keydown.enter.prevent="openAssetDialogForTarget('sphericalTexture')"
                @keydown.space.prevent="openAssetDialogForTarget('sphericalTexture')"
              >
                <v-icon v-if="!sphericalTextureEntry.asset" size="18" color="rgba(233, 236, 241, 0.45)">mdi-cloud-outline</v-icon>
              </div>
              <div
                class="asset-info"
                role="button"
                tabindex="0"
                @click="(event) => openAssetDialogForTarget('sphericalTexture', event)"
                @keydown.enter.prevent="openAssetDialogForTarget('sphericalTexture')"
                @keydown.space.prevent="openAssetDialogForTarget('sphericalTexture')"
              >
                <div class="asset-name">{{ sphericalTextureEntry.displayName }}</div>
                <div class="asset-hint">{{ sphericalTextureEntry.displayHint }}</div>
              </div>
              <div class="asset-actions">
                <v-btn
                  class="asset-action"
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  :disabled="!sphericalTextureEntry.hasValue"
                  title="Clear spherical texture"
                  @click.stop="handleSphericalTextureClear"
                />
              </div>
            </div>
          </div>
          <div class="cloud-grid">
            <v-text-field
              label="Radius"
              :model-value="sphericalSettings.radius"
              type="number"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleSphericalNumberInput('radius', value)"
            />
            <v-text-field
              label="Height"
              :model-value="sphericalSettings.height"
              type="number"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleSphericalNumberInput('height', value)"
            />
            <v-text-field
              label="Opacity"
              :model-value="sphericalSettings.opacity"
              type="number"
              :min="0"
              :max="1"
              :step="0.05"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleSphericalNumberInput('opacity', value)"
            />
            <v-text-field
              label="Rotation Speed"
              :model-value="sphericalSettings.rotationSpeed"
              type="number"
              :step="0.005"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleSphericalNumberInput('rotationSpeed', value)"
            />
          </div>
          <div class="cloud-input">
            <div class="section-label">Tint</div>
            <div class="color-input">
              <v-text-field
                :model-value="sphericalSettings.color"
                variant="underlined"
                density="compact"
                hide-details
                placeholder="#ffffff"
                @update:model-value="(value) => handleSphericalStringInput('color', value)"
              />
              <v-menu
                v-model="sphericalColorMenuOpen"
                :close-on-content-click="false"
                transition="scale-transition"
                location="bottom start"
              >
                <template #activator="{ props: menuProps }">
                  <button
                    class="color-swatch"
                    type="button"
                    v-bind="menuProps"
                    :style="{ backgroundColor: sphericalSettings.color }"
                    title="Select tint color"
                  >
                    <span class="sr-only">Select tint color</span>
                  </button>
                </template>
                <div class="color-picker">
                  <v-color-picker
                    :model-value="sphericalSettings.color"
                    mode="hex"
                    :modes="['hex']"
                    hide-inputs
                    @update:model-value="(value) => handleSphericalStringInput('color', value)">
                  </v-color-picker>
                </div>
              </v-menu>
            </div>
          </div>
        </template>

        <template v-else-if="currentMode === 'volumetric' && volumetricSettings">
          <div class="cloud-grid">
            <v-text-field
              label="Density"
              :model-value="volumetricSettings.density"
              type="number"
              :step="0.05"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleVolumetricNumberInput('density', value)"
            />
            <v-text-field
              label="Coverage"
              :model-value="volumetricSettings.coverage"
              type="number"
              :step="0.05"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleVolumetricNumberInput('coverage', value)"
            />
            <v-text-field
              label="Speed"
              :model-value="volumetricSettings.speed"
              type="number"
              :step="0.05"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleVolumetricNumberInput('speed', value)"
            />
            <v-text-field
              label="Detail"
              :model-value="volumetricSettings.detail"
              type="number"
              :step="1"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleVolumetricNumberInput('detail', value)"
            />
            <v-text-field
              label="Height"
              :model-value="volumetricSettings.height"
              type="number"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleVolumetricNumberInput('height', value)"
            />
            <v-text-field
              label="Size"
              :model-value="volumetricSettings.size"
              type="number"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleVolumetricNumberInput('size', value)"
            />
          </div>
          <div class="cloud-input">
            <div class="section-label">Tint</div>
            <div class="color-input">
              <v-text-field
                :model-value="volumetricSettings.color"
                variant="underlined"
                density="compact"
                hide-details
                placeholder="#ffffff"
                @update:model-value="handleVolumetricStringInput"
              />
              <v-menu
                v-model="volumetricColorMenuOpen"
                :close-on-content-click="false"
                transition="scale-transition"
                location="bottom start"
              >
                <template #activator="{ props: menuProps }">
                  <button
                    class="color-swatch"
                    type="button"
                    v-bind="menuProps"
                    :style="{ backgroundColor: volumetricSettings.color }"
                    title="Select tint color"
                  >
                    <span class="sr-only">Select tint color</span>
                  </button>
                </template>
                <div class="color-picker">
                  <v-color-picker
                    :model-value="volumetricSettings.color"
                    mode="hex"
                    :modes="['hex']"
                    hide-inputs
                    @update:model-value="handleVolumetricStringInput"
                  />
                </div>
              </v-menu>
            </div>
          </div>
        </template>

        <p v-else class="cloud-placeholder">
          Select a cloud implementation to configure sky cloud parameters.
        </p>
      </div>
      <AssetDialog
        v-model="assetDialogVisible"
        v-model:assetId="assetDialogSelectedId"
        :asset-type="ASSET_DIALOG_TYPES"
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
.cloud-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cloud-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #9fb5c7;
}

.cube-face-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.asset-tile {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  column-gap: 12px;
  row-gap: 2px;
  align-items: center;
  padding: 8px 12px;
  min-height: 44px;
  border-radius: 10px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  background: rgba(12, 16, 22, 0.48);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.asset-tile.is-active-drop {
  border-color: rgba(107, 152, 255, 0.85);
  background: rgba(56, 86, 160, 0.38);
}

.asset-tile.is-empty {
  border-style: dashed;
}

.asset-thumb {
  grid-row: 1 / span 3;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
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
  grid-row: 1 / span 3;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
  cursor: pointer;
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

.asset-name {
  font-size: 0.84rem;
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
  justify-content: flex-end;
  grid-column: 3;
  grid-row: 1;
}

.asset-action {
  color: rgba(233, 236, 241, 0.76);
}

.asset-action:disabled {
  color: rgba(233, 236, 241, 0.28) !important;
}

.cloud-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.cloud-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
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

.cloud-placeholder {
  margin: 0;
  font-size: 13px;
  color: #9fb5c7;
}
</style>
