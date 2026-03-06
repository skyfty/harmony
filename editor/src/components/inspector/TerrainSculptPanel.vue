<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GroundGenerationMode, GroundSculptOperation } from '@schema'

const BRUSH_RADIUS_MIN = 0.1
const BRUSH_RADIUS_MAX = 50
const BRUSH_RADIUS_STEP = 0.1

const BRUSH_STRENGTH_MIN = 0.1
const BRUSH_STRENGTH_MAX = 10
const BRUSH_STRENGTH_STEP = 0.1

const NOISE_STRENGTH_MIN = 0
const NOISE_STRENGTH_MAX = 5
const NOISE_STRENGTH_STEP = 0.1
const VALUE_PRECISION = 1

type TerrainOperationOption = { value: GroundSculptOperation; label: string; icon: string }
type NoiseModeOption = { value: GroundGenerationMode; label: string; icon: string }

const props = defineProps<{
  hasGround: boolean
  brushRadius: number
  brushStrength: number
  brushShape: 'circle' | 'square' | 'star'
  brushOperation: GroundSculptOperation | null
  terrainOperations: TerrainOperationOption[]
  noiseStrength: number
  noiseMode: GroundGenerationMode
  noiseModeOptions: NoiseModeOption[]
}>()

const emit = defineEmits<{
  (event: 'update:brushRadius', value: number): void
  (event: 'update:brushStrength', value: number): void
  (event: 'update:brushShape', value: 'circle' | 'square' | 'star'): void
  (event: 'update:brushOperation', value: GroundSculptOperation | null): void
  (event: 'update:noiseStrength', value: number): void
  (event: 'update:noiseMode', value: GroundGenerationMode): void
}>()

const brushShapeModel = computed({
  get: () => props.brushShape,
  set: (value: 'circle' | 'square' | 'star') => emit('update:brushShape', value),
})

const brushOperationModel = computed({
  get: () => props.brushOperation,
  set: (value: GroundSculptOperation | null) => emit('update:brushOperation', value),
})

const brushRadiusModel = computed({
  get: () => props.brushRadius,
  set: (value: number) => emit('update:brushRadius', value),
})

const brushStrengthModel = computed({
  get: () => props.brushStrength,
  set: (value: number) => emit('update:brushStrength', value),
})

const noiseStrengthModel = computed({
  get: () => props.noiseStrength,
  set: (value: number) => emit('update:noiseStrength', value),
})

const noiseModeModel = computed({
  get: () => props.noiseMode,
  set: (value: GroundGenerationMode) => emit('update:noiseMode', value),
})

const brushRadiusInput = ref(formatNumericValue(props.brushRadius))
const brushStrengthInput = ref(formatNumericValue(props.brushStrength))
const noiseStrengthInput = ref(formatNumericValue(props.noiseStrength))

watch(
  () => props.brushRadius,
  (value) => {
    brushRadiusInput.value = formatNumericValue(value)
  },
)

watch(
  () => props.brushStrength,
  (value) => {
    brushStrengthInput.value = formatNumericValue(value)
  },
)

watch(
  () => props.noiseStrength,
  (value) => {
    noiseStrengthInput.value = formatNumericValue(value)
  },
)

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapToStep(value: number, min: number, step: number): number {
  const steps = Math.round((value - min) / step)
  return min + steps * step
}

function formatNumericValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(VALUE_PRECISION) : (0).toFixed(VALUE_PRECISION)
}

function parseAndNormalize(raw: string, fallback: number, min: number, max: number, step: number): number {
  const parsed = Number.parseFloat(raw)
  const base = Number.isFinite(parsed) ? parsed : fallback
  const clamped = clampValue(base, min, max)
  const stepped = snapToStep(clamped, min, step)
  const normalized = Number(stepped.toFixed(VALUE_PRECISION))
  return clampValue(normalized, min, max)
}

function commitBrushRadiusInput() {
  const normalized = parseAndNormalize(
    brushRadiusInput.value,
    props.brushRadius,
    BRUSH_RADIUS_MIN,
    BRUSH_RADIUS_MAX,
    BRUSH_RADIUS_STEP,
  )
  brushRadiusModel.value = normalized
  brushRadiusInput.value = formatNumericValue(normalized)
}

function commitBrushStrengthInput() {
  const normalized = parseAndNormalize(
    brushStrengthInput.value,
    props.brushStrength,
    BRUSH_STRENGTH_MIN,
    BRUSH_STRENGTH_MAX,
    BRUSH_STRENGTH_STEP,
  )
  brushStrengthModel.value = normalized
  brushStrengthInput.value = formatNumericValue(normalized)
}

function commitNoiseStrengthInput() {
  const normalized = parseAndNormalize(
    noiseStrengthInput.value,
    props.noiseStrength,
    NOISE_STRENGTH_MIN,
    NOISE_STRENGTH_MAX,
    NOISE_STRENGTH_STEP,
  )
  noiseStrengthModel.value = normalized
  noiseStrengthInput.value = formatNumericValue(normalized)
}
</script>

<template>
  <div class="terrain-panel">
    <div class="control-group" style="margin: 0 0 10px 0">
      <div class="text-caption mb-1">Brush Shape</div>
      <v-btn-toggle v-model="brushShapeModel" density="compact" mandatory divided variant="outlined" color="primary">
        <v-btn value="circle" icon="mdi-circle-outline" title="Circle"></v-btn>
        <v-btn value="square" icon="mdi-square-outline" title="Square"></v-btn>
        <v-btn value="star" icon="mdi-star-outline" title="Star"></v-btn>
      </v-btn-toggle>
    </div>

    <div class="control-group">
      <div class="text-caption mb-1">Operation</div>
      <v-btn-toggle
        v-model="brushOperationModel"
        density="compact"
        divided
        variant="outlined"
        color="primary"
        :disabled="!props.hasGround"
        class="icon-toggle-group"
      >
        <v-btn
          v-for="operation in props.terrainOperations"
          :key="operation.value"
          :value="operation.value"
          :title="operation.label"
          icon
          :aria-label="operation.label"
        >
          <v-icon :icon="operation.icon" />
        </v-btn>
      </v-btn-toggle>
    </div>

    <div class="control-row">
      <div class="control-group control-group--compact">
        <div class="text-caption">Brush Radius: {{ brushRadiusInput }}</div>
        <v-text-field
          v-model="brushRadiusInput"
          type="number"
          suffix="m"
          :min="BRUSH_RADIUS_MIN"
          :max="BRUSH_RADIUS_MAX"
          :step="BRUSH_RADIUS_STEP"
          variant="outlined"
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
        <div class="text-caption">Brush Strength: {{ brushStrengthInput }}</div>
        <v-text-field
          v-model="brushStrengthInput"
          type="number"
          suffix="x"
          :min="BRUSH_STRENGTH_MIN"
          :max="BRUSH_STRENGTH_MAX"
          :step="BRUSH_STRENGTH_STEP"
          variant="outlined"
          density="compact"
          hide-details
          inputmode="decimal"
          :disabled="!props.hasGround"
          class="numeric-input"
          @blur="commitBrushStrengthInput"
          @keydown.enter.prevent="commitBrushStrengthInput"
        />
      </div>
    </div>

    <v-divider class="ground-panel-divider" />

    <div class="control-group noise-type">
      <div class="text-caption mb-1">Noise Type</div>
      <v-select
        v-model="noiseModeModel"
        :items="props.noiseModeOptions"
        item-title="label"
        item-value="value"
        density="compact"
        variant="underlined"
        hide-details
        :disabled="!props.hasGround"
        class="noise-mode-select"
      />
    </div>

    <div class="control-group">
      <div class="text-caption">Noise Strength: {{ noiseStrengthInput }}</div>
      <v-text-field
        v-model="noiseStrengthInput"
        type="number"
        suffix="x"
        :min="NOISE_STRENGTH_MIN"
        :max="NOISE_STRENGTH_MAX"
        :step="NOISE_STRENGTH_STEP"
        variant="outlined"
        density="compact"
        hide-details
        inputmode="decimal"
        :disabled="!props.hasGround"
        class="numeric-input"
        @blur="commitNoiseStrengthInput"
        @keydown.enter.prevent="commitNoiseStrengthInput"
      />
    </div>
  </div>
</template>

<style scoped>
.terrain-panel {
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

.control-group--compact {
  flex: 1;
  min-width: 0;
}

.numeric-input {
  max-width: 100%;
}

.icon-toggle-group :deep(.v-btn) {
  min-width: 38px;
}

.noise-type {
  margin-bottom: 10px;
}
</style>
