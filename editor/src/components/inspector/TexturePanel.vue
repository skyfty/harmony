<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  cloneTextureSettings,
  createTextureSettings,
  type SceneMaterialTextureRef,
  type SceneMaterialTextureSettings,
  type SceneTextureWrapMode,
} from '@/types/material'

const props = defineProps<{
  modelValue: SceneMaterialTextureRef | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: SceneMaterialTextureRef | null): void
}>()

const wrapOptions: Array<{ label: string; value: SceneTextureWrapMode }> = [
  { label: 'Clamp to Edge', value: 'ClampToEdgeWrapping' },
  { label: 'Repeat', value: 'RepeatWrapping' },
  { label: 'Mirrored Repeat', value: 'MirroredRepeatWrapping' },
]

const localSettings = reactive<SceneMaterialTextureSettings>(createTextureSettings())

const isDisabled = computed(() => props.disabled || !props.modelValue)
const hasTexture = computed(() => !!props.modelValue)

watch(
  () => props.modelValue?.settings,
  (next) => {
    const normalized = createTextureSettings(next ?? null)
    Object.assign(localSettings, normalized)
  },
  { immediate: true, deep: true },
)

function emitSettings() {
  if (!props.modelValue) {
    return
  }
  emit('update:modelValue', {
    ...props.modelValue,
    settings: cloneTextureSettings(localSettings),
  })
}

function handleWrapChange(axis: 'wrapS' | 'wrapT' | 'wrapR', value: SceneTextureWrapMode | null) {
  if (!value) {
    return
  }
  localSettings[axis] = value
  emitSettings()
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function handleVectorChange(
  key: 'offset' | 'repeat' | 'center',
  axis: 'x' | 'y',
  value: string | number,
) {
  const numeric = coerceNumber(value, localSettings[key][axis])
  localSettings[key][axis] = numeric
  emitSettings()
}

function handleRotationChange(value: string | number) {
  const numeric = coerceNumber(value, localSettings.rotation)
  localSettings.rotation = numeric
  emitSettings()
}

function handleToggleChange(key: 'matrixAutoUpdate' | 'generateMipmaps' | 'premultiplyAlpha' | 'flipY', value: boolean | null) {
  if (value === null) {
    return
  }
  localSettings[key] = value
  emitSettings()
}
</script>

<template>
  <div class="texture-panel">
    <div v-if="!hasTexture" class="texture-empty">
      Assign a texture to configure settings.
    </div>
    <div v-else class="texture-body">
      <div class="panel-section">
        <div class="section-title">Wrap Mode</div>
        <div class="wrap-grid">
          <v-select
            class="wrap-input"
            label="U (wrapS)"
            density="compact"
            variant="underlined"
            hide-details
            :items="wrapOptions"
            item-title="label"
            item-value="value"
            :model-value="localSettings.wrapS"
            :disabled="isDisabled"
            @update:model-value="(value) => handleWrapChange('wrapS', value as SceneTextureWrapMode | null)"
          />
          <v-select
            class="wrap-input"
            label="V (wrapT)"
            density="compact"
            variant="underlined"
            hide-details
            :items="wrapOptions"
            item-title="label"
            item-value="value"
            :model-value="localSettings.wrapT"
            :disabled="isDisabled"
            @update:model-value="(value) => handleWrapChange('wrapT', value as SceneTextureWrapMode | null)"
          />
          <v-select
            class="wrap-input"
            label="W (wrapR)"
            density="compact"
            variant="underlined"
            hide-details
            :items="wrapOptions"
            item-title="label"
            item-value="value"
            :model-value="localSettings.wrapR"
            :disabled="isDisabled"
            @update:model-value="(value) => handleWrapChange('wrapR', value as SceneTextureWrapMode | null)"
          />
        </div>
      </div>

      <div class="panel-section">
        <div class="section-title">Filtering &amp; Sampling</div>
        <div class="vector-grid">
          <div class="vector-group">
            <div class="vector-label">Offset</div>
            <div class="vector-inputs">
              <v-text-field
                type="number"
                density="compact"
                variant="underlined"
                hide-details
                suffix="X"
                :model-value="localSettings.offset.x"
                :disabled="isDisabled"
                @update:model-value="(value) => handleVectorChange('offset', 'x', value as string | number)"
              />
              <v-text-field
                type="number"
                density="compact"
                variant="underlined"
                hide-details
                suffix="Y"
                :model-value="localSettings.offset.y"
                :disabled="isDisabled"
                @update:model-value="(value) => handleVectorChange('offset', 'y', value as string | number)"
              />
            </div>
          </div>
          <div class="vector-group">
            <div class="vector-label">Repeat</div>
            <div class="vector-inputs">
              <v-text-field
                type="number"
                density="compact"
                variant="underlined"
                hide-details
                suffix="X"
                :model-value="localSettings.repeat.x"
                :disabled="isDisabled"
                @update:model-value="(value) => handleVectorChange('repeat', 'x', value as string | number)"
              />
              <v-text-field
                type="number"
                density="compact"
                variant="underlined"
                hide-details
                suffix="Y"
                :model-value="localSettings.repeat.y"
                :disabled="isDisabled"
                @update:model-value="(value) => handleVectorChange('repeat', 'y', value as string | number)"
              />
            </div>
          </div>
          <div class="vector-group">
            <div class="vector-label">Center</div>
            <div class="vector-inputs">
              <v-text-field
                type="number"
                density="compact"
                variant="underlined"
                hide-details
                suffix="X"
                :model-value="localSettings.center.x"
                :disabled="isDisabled"
                @update:model-value="(value) => handleVectorChange('center', 'x', value as string | number)"
              />
              <v-text-field
                type="number"
                density="compact"
                variant="underlined"
                hide-details
                suffix="Y"
                :model-value="localSettings.center.y"
                :disabled="isDisabled"
                @update:model-value="(value) => handleVectorChange('center', 'y', value as string | number)"
              />
            </div>
          </div>
          <div class="vector-group">
            <div class="vector-label">Rotation (rad)</div>
            <v-text-field
              type="number"
              density="compact"
              variant="underlined"
              hide-details
              :model-value="localSettings.rotation"
              :disabled="isDisabled"
              @update:model-value="(value) => handleRotationChange(value as string | number)"
            />
          </div>
        </div>
        <v-checkbox
            size="small"
          class="matrix-switch"
          density="compact"
          hide-details
          label="Matrix Auto Update"
          :model-value="localSettings.matrixAutoUpdate"
          :disabled="isDisabled"
          @update:model-value="(value) => handleToggleChange('matrixAutoUpdate', value as boolean | null)"
        />
                  <v-checkbox
            size="small"
            density="compact"
            hide-details
            label="Generate Mipmaps"
            :model-value="localSettings.generateMipmaps"
            :disabled="isDisabled"
            @update:model-value="(value) => handleToggleChange('generateMipmaps', value as boolean | null)"
          />
          <v-checkbox
            size="small"
            density="compact"
            hide-details
            label="Premultiply Alpha"
            :model-value="localSettings.premultiplyAlpha"
            :disabled="isDisabled"
            @update:model-value="(value) => handleToggleChange('premultiplyAlpha', value as boolean | null)"
          />
          <v-checkbox
            size="small"
            density="compact"
            hide-details
            label="Flip Y"
            :model-value="localSettings.flipY"
            :disabled="isDisabled"
            @update:model-value="(value) => handleToggleChange('flipY', value as boolean | null)"
          />
      </div>

    </div>
  </div>
</template>

<style scoped>
.texture-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.texture-empty {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.6);
}

.section-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.74);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.wrap-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.wrap-input :deep(.v-field__input) {
  font-size: 0.8rem;
}

.vector-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.vector-group {
  display: grid;
  gap: 6px;
}

.vector-inputs {
  display: flex;
  gap: 6px;
}

.vector-inputs > * {
  flex: 1;
}

.vector-label {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.58);
}

.matrix-switch {
  margin-top: 6px;
}

.toggle-grid {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
