<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  SceneCloudSettings,
  SceneCloudImplementation,
  SceneCubeTextureCloudSettings,
  SceneSphericalCloudSettings,
  SceneVolumetricCloudSettings,
} from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import {
  cloneCloudSettings,
  cloudSettingsEqual,
  createDefaultCloudSettings,
  sanitizeCloudSettings,
} from '@schema/cloudRenderer'

const sceneStore = useSceneStore()
const { skybox } = storeToRefs(sceneStore)

type CloudModeOption = SceneCloudImplementation | 'none'

const modeOptions: Array<{ title: string; value: CloudModeOption }> = [
  { title: 'Disabled', value: 'none' },
  { title: 'Cube Texture Loader', value: 'cubeTexture' },
  { title: 'Spherical Cloud Layer', value: 'spherical' },
  { title: 'Volumetric Clouds', value: 'volumetric' },
]

const localSettings = ref<SceneCloudSettings | null>(cloneCloudSettings(skybox.value.clouds))

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

function handleCubeFaceInput(face: keyof Pick<SceneCubeTextureCloudSettings, 'positiveX' | 'negativeX' | 'positiveY' | 'negativeY' | 'positiveZ' | 'negativeZ'>, value: string) {
  const current = cubeSettings.value
  if (!current) {
    return
  }
  commitSettings({ ...current, [face]: value })
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

function handleSphericalStringInput(key: 'textureAssetId' | 'color', value: string) {
  const current = sphericalSettings.value
  if (!current) {
    return
  }
  commitSettings({ ...current, [key]: value })
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

function handleVolumetricStringInput(value: string) {
  const current = volumetricSettings.value
  if (!current) {
    return
  }
  commitSettings({ ...current, color: value })
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
</script>

<template>
  <v-expansion-panel value="clouds">
    <v-expansion-panel-title>
      Cloud Layer
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="cloud-panel">
        <div class="cloud-section">
          <div class="section-label">Implementation</div>
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
          <div class="cube-grid">
            <v-text-field
              label="+X"
              :model-value="cubeSettings.positiveX"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleCubeFaceInput('positiveX', value as string)"
            />
            <v-text-field
              label="-X"
              :model-value="cubeSettings.negativeX"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleCubeFaceInput('negativeX', value as string)"
            />
            <v-text-field
              label="+Y"
              :model-value="cubeSettings.positiveY"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleCubeFaceInput('positiveY', value as string)"
            />
            <v-text-field
              label="-Y"
              :model-value="cubeSettings.negativeY"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleCubeFaceInput('negativeY', value as string)"
            />
            <v-text-field
              label="+Z"
              :model-value="cubeSettings.positiveZ"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleCubeFaceInput('positiveZ', value as string)"
            />
            <v-text-field
              label="-Z"
              :model-value="cubeSettings.negativeZ"
              variant="underlined"
              density="compact"
              hide-details
              @update:model-value="(value) => handleCubeFaceInput('negativeZ', value as string)"
            />
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
            <div class="section-label">Texture Asset ID</div>
            <v-text-field
              :model-value="sphericalSettings.textureAssetId ?? ''"
              variant="underlined"
              density="compact"
              hide-details
              placeholder="asset identifier or URL"
              @update:model-value="(value) => handleSphericalStringInput('textureAssetId', value as string)"
            />
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
            <v-text-field
              :model-value="sphericalSettings.color"
              variant="underlined"
              density="compact"
              hide-details
              placeholder="#ffffff"
              @update:model-value="(value) => handleSphericalStringInput('color', value as string)"
            />
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
            <v-text-field
              :model-value="volumetricSettings.color"
              variant="underlined"
              density="compact"
              hide-details
              placeholder="#ffffff"
              @update:model-value="(value) => handleVolumetricStringInput(value as string)"
            />
          </div>
        </template>

        <p v-else class="cloud-placeholder">
          Select a cloud implementation to configure sky cloud parameters.
        </p>
      </div>
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

.cube-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
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

.cloud-placeholder {
  margin: 0;
  font-size: 13px;
  color: #9fb5c7;
}
</style>
