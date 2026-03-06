<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import AssetPickerList from '@/components/common/AssetPickerList.vue'

const BRUSH_RADIUS_MIN = 0.1
const BRUSH_RADIUS_MAX = 50
const BRUSH_RADIUS_STEP = 0.1
const BRUSH_RADIUS_PRECISION = 1

const SMOOTHNESS_MIN = 0
const SMOOTHNESS_MAX = 1
const SMOOTHNESS_STEP = 0.01
const SMOOTHNESS_PRECISION = 2

const props = defineProps<{
  hasGround: boolean
  brushRadius: number
  smoothness: number
  asset: ProjectAsset | null
}>()

const emit = defineEmits<{
  (event: 'update:brushRadius', value: number): void
  (event: 'update:smoothness', value: number): void
  (event: 'update:asset', value: ProjectAsset | null): void
}>()

const brushRadiusModel = computed({
  get: () => props.brushRadius,
  set: (value: number) => emit('update:brushRadius', value),
})

const smoothnessModel = computed({
  get: () => props.smoothness,
  set: (value: number) => emit('update:smoothness', value),
})

const brushRadiusInput = ref(formatNumericValue(props.brushRadius, BRUSH_RADIUS_PRECISION))
const smoothnessInput = ref(formatNumericValue(props.smoothness, SMOOTHNESS_PRECISION))

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

const smoothnessPercent = computed(() => `${Math.round((smoothnessModel.value ?? 0) * 100)}%`)
</script>

<template>
  <div class="terrain-paint-panel">
    <div class="control-group">
      <div class="text-caption">Brush Radius: {{ brushRadiusInput }} m</div>
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

    <div class="control-group">
      <div class="text-caption">Edge Smoothing: {{ smoothnessPercent }}</div>
      <v-text-field
        v-model="smoothnessInput"
        type="number"
        suffix="x"
        :min="SMOOTHNESS_MIN"
        :max="SMOOTHNESS_MAX"
        :step="SMOOTHNESS_STEP"
        variant="outlined"
        density="compact"
        hide-details
        inputmode="decimal"
        :disabled="!props.hasGround"
        class="numeric-input"
        @blur="commitSmoothnessInput"
        @keydown.enter.prevent="commitSmoothnessInput"
      />
    </div>
    <div class="control-group">
      <div class="text-caption mb-1">Terrain Texture</div>
      <AssetPickerList
        :active="true"
        :asset-id="selectedAssetId"
        asset-type="image,texture"
        :show-search="true"
        :thumbnail-size="52"
        @update:asset="(next) => emit('update:asset', next)"
      />
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

.numeric-input {
  max-width: 160px;
}

.hint-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}
</style>
