<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { type TerrainPaintBlendMode } from '@schema'
import type { ProjectAsset } from '@/types/project-asset'
import type { TerrainPaintBrushSettings } from '@/stores/terrainStore'
import AssetPickerList from '@/components/common/AssetPickerList.vue'

const BRUSH_RADIUS_MIN = 0.1
const BRUSH_RADIUS_MAX = 50
const BRUSH_RADIUS_STEP = 0.1
const BRUSH_RADIUS_PRECISION = 1

const SMOOTHNESS_MIN = 0
const SMOOTHNESS_MAX = 1
const SMOOTHNESS_STEP = 0.01
const SMOOTHNESS_PRECISION = 2

const TILE_SCALE_MIN = 0.001
const TILE_SCALE_MAX = 64
const TILE_SCALE_STEP = 0.01
const TILE_SCALE_PRECISION = 2

const OFFSET_MIN = -64
const OFFSET_MAX = 64
const OFFSET_STEP = 0.01
const OFFSET_PRECISION = 2

const ROTATION_MIN = -360
const ROTATION_MAX = 360
const ROTATION_STEP = 1
const ROTATION_PRECISION = 0

const OPACITY_MIN = 0
const OPACITY_MAX = 1
const OPACITY_STEP = 0.01
const OPACITY_PRECISION = 2

const FEATHER_MIN = 0
const FEATHER_MAX = 1
const FEATHER_STEP = 0.01
const FEATHER_PRECISION = 2

const blendModeOptions: Array<{ value: TerrainPaintBlendMode; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
]

const props = defineProps<{
  hasGround: boolean
  brushRadius: number
  smoothness: number
  asset: ProjectAsset | null
  settings: TerrainPaintBrushSettings
}>()

const emit = defineEmits<{
  (event: 'update:brushRadius', value: number): void
  (event: 'update:smoothness', value: number): void
  (event: 'update:asset', value: ProjectAsset | null): void
  (event: 'update:settings', value: TerrainPaintBrushSettings): void
}>()

const selectedAssetLabel = computed(() => {
  const name = typeof props.asset?.name === 'string' ? props.asset.name.trim() : ''
  return name.length > 0 ? `Texture: ${name}` : 'Select a paint texture'
})

const brushRadiusModel = computed({
  get: () => props.brushRadius,
  set: (value: number) => emit('update:brushRadius', value),
})

const smoothnessModel = computed({
  get: () => props.smoothness,
  set: (value: number) => emit('update:smoothness', value),
})

function emitSettingsPatch(patch: Partial<TerrainPaintBrushSettings>) {
  emit('update:settings', {
    ...props.settings,
    ...patch,
  })
}

const blendModeModel = computed<TerrainPaintBlendMode>({
  get: () => props.settings.blendMode,
  set: (value) => emitSettingsPatch({ blendMode: value }),
})

const worldSpaceModel = computed({
  get: () => props.settings.worldSpace,
  set: (value: boolean) => emitSettingsPatch({ worldSpace: value }),
})

const brushRadiusInput = ref(formatNumericValue(props.brushRadius, BRUSH_RADIUS_PRECISION))
const smoothnessInput = ref(formatNumericValue(props.smoothness, SMOOTHNESS_PRECISION))
const tileScaleXInput = ref(formatNumericValue(props.settings.tileScale.x, TILE_SCALE_PRECISION))
const tileScaleYInput = ref(formatNumericValue(props.settings.tileScale.y, TILE_SCALE_PRECISION))
const offsetXInput = ref(formatNumericValue(props.settings.offset.x, OFFSET_PRECISION))
const offsetYInput = ref(formatNumericValue(props.settings.offset.y, OFFSET_PRECISION))
const rotationInput = ref(formatNumericValue(props.settings.rotationDeg, ROTATION_PRECISION))
const opacityInput = ref(formatNumericValue(props.settings.opacity, OPACITY_PRECISION))
const featherInput = ref(formatNumericValue(props.settings.feather, FEATHER_PRECISION))

const selectedAssetId = computed(() => props.asset?.id ?? '')

watch(
  () => props.brushRadius,
  (value) => {
    brushRadiusInput.value = formatNumericValue(value, BRUSH_RADIUS_PRECISION)
  },
)

watch(
  () => props.smoothness,
  (value) => {
    smoothnessInput.value = formatNumericValue(value, SMOOTHNESS_PRECISION)
  },
)

watch(
  () => props.settings.tileScale.x,
  (value) => {
    tileScaleXInput.value = formatNumericValue(value, TILE_SCALE_PRECISION)
  },
)

watch(
  () => props.settings.tileScale.y,
  (value) => {
    tileScaleYInput.value = formatNumericValue(value, TILE_SCALE_PRECISION)
  },
)

watch(
  () => props.settings.offset.x,
  (value) => {
    offsetXInput.value = formatNumericValue(value, OFFSET_PRECISION)
  },
)

watch(
  () => props.settings.offset.y,
  (value) => {
    offsetYInput.value = formatNumericValue(value, OFFSET_PRECISION)
  },
)

watch(
  () => props.settings.rotationDeg,
  (value) => {
    rotationInput.value = formatNumericValue(value, ROTATION_PRECISION)
  },
)

watch(
  () => props.settings.opacity,
  (value) => {
    opacityInput.value = formatNumericValue(value, OPACITY_PRECISION)
  },
)

watch(
  () => props.settings.feather,
  (value) => {
    featherInput.value = formatNumericValue(value, FEATHER_PRECISION)
  },
)

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapToStep(value: number, min: number, step: number): number {
  const steps = Math.round((value - min) / step)
  return min + steps * step
}

function formatNumericValue(value: number, precision: number): string {
  return Number.isFinite(value) ? value.toFixed(precision) : (0).toFixed(precision)
}

function parseAndNormalize(
  raw: string,
  fallback: number,
  min: number,
  max: number,
  step: number,
  precision: number,
): number {
  const parsed = Number.parseFloat(raw)
  const base = Number.isFinite(parsed) ? parsed : fallback
  const clamped = clampValue(base, min, max)
  const stepped = snapToStep(clamped, min, step)
  const normalized = Number(stepped.toFixed(precision))
  return clampValue(normalized, min, max)
}

function commitBrushRadiusInput() {
  const normalized = parseAndNormalize(
    brushRadiusInput.value,
    props.brushRadius,
    BRUSH_RADIUS_MIN,
    BRUSH_RADIUS_MAX,
    BRUSH_RADIUS_STEP,
    BRUSH_RADIUS_PRECISION,
  )
  brushRadiusModel.value = normalized
  brushRadiusInput.value = formatNumericValue(normalized, BRUSH_RADIUS_PRECISION)
}

function commitSmoothnessInput() {
  const normalized = parseAndNormalize(
    smoothnessInput.value,
    props.smoothness,
    SMOOTHNESS_MIN,
    SMOOTHNESS_MAX,
    SMOOTHNESS_STEP,
    SMOOTHNESS_PRECISION,
  )
  smoothnessModel.value = normalized
  smoothnessInput.value = formatNumericValue(normalized, SMOOTHNESS_PRECISION)
}

function commitTileScaleAxis(axis: 'x' | 'y') {
  const source = axis === 'x' ? tileScaleXInput : tileScaleYInput
  const fallback = props.settings.tileScale[axis]
  const normalized = parseAndNormalize(
    source.value,
    fallback,
    TILE_SCALE_MIN,
    TILE_SCALE_MAX,
    TILE_SCALE_STEP,
    TILE_SCALE_PRECISION,
  )
  emitSettingsPatch({
    tileScale: {
      ...props.settings.tileScale,
      [axis]: normalized,
    },
  })
  source.value = formatNumericValue(normalized, TILE_SCALE_PRECISION)
}

function commitOffsetAxis(axis: 'x' | 'y') {
  const source = axis === 'x' ? offsetXInput : offsetYInput
  const fallback = props.settings.offset[axis]
  const normalized = parseAndNormalize(
    source.value,
    fallback,
    OFFSET_MIN,
    OFFSET_MAX,
    OFFSET_STEP,
    OFFSET_PRECISION,
  )
  emitSettingsPatch({
    offset: {
      ...props.settings.offset,
      [axis]: normalized,
    },
  })
  source.value = formatNumericValue(normalized, OFFSET_PRECISION)
}

function commitRotationInput() {
  const normalized = parseAndNormalize(
    rotationInput.value,
    props.settings.rotationDeg,
    ROTATION_MIN,
    ROTATION_MAX,
    ROTATION_STEP,
    ROTATION_PRECISION,
  )
  emitSettingsPatch({ rotationDeg: normalized })
  rotationInput.value = formatNumericValue(normalized, ROTATION_PRECISION)
}

function commitOpacityInput() {
  const normalized = parseAndNormalize(
    opacityInput.value,
    props.settings.opacity,
    OPACITY_MIN,
    OPACITY_MAX,
    OPACITY_STEP,
    OPACITY_PRECISION,
  )
  emitSettingsPatch({ opacity: normalized })
  opacityInput.value = formatNumericValue(normalized, OPACITY_PRECISION)
}

function commitFeatherInput() {
  const normalized = parseAndNormalize(
    featherInput.value,
    props.settings.feather,
    FEATHER_MIN,
    FEATHER_MAX,
    FEATHER_STEP,
    FEATHER_PRECISION,
  )
  emitSettingsPatch({ feather: normalized })
  featherInput.value = formatNumericValue(normalized, FEATHER_PRECISION)
}

const smoothnessPercent = computed(() => `${Math.round((smoothnessModel.value ?? 0) * 100)}%`)
</script>

<template>
  <div class="terrain-paint-panel">
    <div class="control-row">
      <div class="control-group control-group--compact">
        <div class="text-caption">Brush Radius: {{ brushRadiusInput }} m</div>
        <v-text-field
          v-model="brushRadiusInput"
          type="number"
          suffix="m"
          :min="BRUSH_RADIUS_MIN"
          :max="BRUSH_RADIUS_MAX"
          :step="BRUSH_RADIUS_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitBrushRadiusInput"
          @keydown.enter.prevent="commitBrushRadiusInput"
        />
      </div>

      <div class="control-group control-group--compact">
        <div class="text-caption">Edge Smoothing: {{ smoothnessPercent }}</div>
        <v-text-field
          v-model="smoothnessInput"
          type="number"
          suffix="x"
          :min="SMOOTHNESS_MIN"
          :max="SMOOTHNESS_MAX"
          :step="SMOOTHNESS_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitSmoothnessInput"
          @keydown.enter.prevent="commitSmoothnessInput"
        />
      </div>
    </div>
    <div class="control-group">
      <div class="text-caption mb-1">{{ selectedAssetLabel }}</div>
      <AssetPickerList
        :active="true"
        :asset-id="selectedAssetId"
        asset-type="image,texture"
        :show-search="true"
        :thumbnail-size="52"
        :disabled="!props.hasGround"
        @update:asset="(next) => emit('update:asset', next)"
      />
    </div>

    <div class="terrain-paint-grid">
      <div class="control-group control-group--compact">
        <div class="text-caption">Tile X</div>
        <v-text-field
          v-model="tileScaleXInput"
          type="number"
          :min="TILE_SCALE_MIN"
          :max="TILE_SCALE_MAX"
          :step="TILE_SCALE_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitTileScaleAxis('x')"
          @keydown.enter.prevent="commitTileScaleAxis('x')"
        />
      </div>

      <div class="control-group control-group--compact">
        <div class="text-caption">Tile Y</div>
        <v-text-field
          v-model="tileScaleYInput"
          type="number"
          :min="TILE_SCALE_MIN"
          :max="TILE_SCALE_MAX"
          :step="TILE_SCALE_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitTileScaleAxis('y')"
          @keydown.enter.prevent="commitTileScaleAxis('y')"
        />
      </div>

      <div class="control-group control-group--compact">
        <div class="text-caption">Offset X</div>
        <v-text-field
          v-model="offsetXInput"
          type="number"
          :min="OFFSET_MIN"
          :max="OFFSET_MAX"
          :step="OFFSET_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitOffsetAxis('x')"
          @keydown.enter.prevent="commitOffsetAxis('x')"
        />
      </div>

      <div class="control-group control-group--compact">
        <div class="text-caption">Offset Y</div>
        <v-text-field
          v-model="offsetYInput"
          type="number"
          :min="OFFSET_MIN"
          :max="OFFSET_MAX"
          :step="OFFSET_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitOffsetAxis('y')"
          @keydown.enter.prevent="commitOffsetAxis('y')"
        />
      </div>

      <div class="control-group control-group--compact">
        <div class="text-caption">Opacity</div>
        <v-text-field
          v-model="opacityInput"
          type="number"
          :min="OPACITY_MIN"
          :max="OPACITY_MAX"
          :step="OPACITY_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitOpacityInput"
          @keydown.enter.prevent="commitOpacityInput"
        />
      </div>

      <div class="control-group control-group--compact">
        <div class="text-caption">Feather</div>
        <v-text-field
          v-model="featherInput"
          type="number"
          :min="FEATHER_MIN"
          :max="FEATHER_MAX"
          :step="FEATHER_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitFeatherInput"
          @keydown.enter.prevent="commitFeatherInput"
        />
      </div>

      <div class="control-group control-group--compact">
        <div class="text-caption">Rotation</div>
        <v-text-field
          v-model="rotationInput"
          type="number"
          suffix="deg"
          :min="ROTATION_MIN"
          :max="ROTATION_MAX"
          :step="ROTATION_STEP"
          variant="underlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitRotationInput"
          @keydown.enter.prevent="commitRotationInput"
        />
      </div>

      <div class="control-group terrain-paint-grid__full-row">
        <div class="text-caption mb-1">Blend</div>
        <v-select
          v-model="blendModeModel"
          :items="blendModeOptions"
          item-title="label"
          item-value="value"
          variant="underlined"
          density="compact"
          hide-details
          :disabled="!props.hasGround"
        />
      </div>

      <div class="control-group terrain-paint-grid__full-row terrain-paint-grid__switch-row">
        <div class="text-caption">World Space</div>
        <v-switch
          v-model="worldSpaceModel"
          density="compact"
          hide-details
          inset
          color="primary"
          :disabled="!props.hasGround"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.terrain-paint-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.terrain-paint-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 8px;
}

.terrain-paint-grid__full-row {
  grid-column: 1 / -1;
}

.terrain-paint-grid__switch-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.control-group--compact {
  flex: 1;
  min-width: 0;
}

.numeric-input {
  max-width: 160px;
}
</style>
