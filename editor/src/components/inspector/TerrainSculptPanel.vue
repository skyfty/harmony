<script setup lang="ts">
import { computed } from 'vue'
import type { GroundGenerationMode, GroundSculptOperation } from '@harmony/schema'

type TerrainOperationOption = { value: GroundSculptOperation; label: string; icon: string }
type NoiseModeOption = { value: GroundGenerationMode; label: string; icon: string }

const props = defineProps<{
  hasGround: boolean
  brushRadius: number
  brushStrength: number
  brushShape: 'circle' | 'square' | 'star'
  brushOperation: GroundSculptOperation
  terrainOperations: TerrainOperationOption[]
  noiseStrength: number
  noiseMode: GroundGenerationMode
  noiseModeOptions: NoiseModeOption[]
}>()

const emit = defineEmits<{
  (event: 'update:brushRadius', value: number): void
  (event: 'update:brushStrength', value: number): void
  (event: 'update:brushShape', value: 'circle' | 'square' | 'star'): void
  (event: 'update:brushOperation', value: GroundSculptOperation): void
  (event: 'update:noiseStrength', value: number): void
  (event: 'update:noiseMode', value: GroundGenerationMode): void
}>()

const brushShapeModel = computed({
  get: () => props.brushShape,
  set: (value: 'circle' | 'square' | 'star') => emit('update:brushShape', value),
})

const brushOperationModel = computed({
  get: () => props.brushOperation,
  set: (value: GroundSculptOperation) => emit('update:brushOperation', value),
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

function formatSliderValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0'
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
        mandatory
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

    <div class="control-group">
      <div class="text-caption">Brush Radius: {{ formatSliderValue(brushRadiusModel) }}</div>
      <v-slider
        v-model="brushRadiusModel"
        :min="0.1"
        :max="50"
        :step="0.1"
        color="primary"
        density="compact"
        hide-details
      />
    </div>

    <div class="control-group">
      <div class="text-caption">Brush Strength: {{ formatSliderValue(brushStrengthModel) }}</div>
      <v-slider
        v-model="brushStrengthModel"
        :min="0.1"
        :max="10"
        :step="0.1"
        color="primary"
        density="compact"
        hide-details
      />
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
      <div class="text-caption">Noise Strength: {{ formatSliderValue(noiseStrengthModel) }}</div>
      <v-slider
        v-model="noiseStrengthModel"
        :min="0"
        :max="5"
        :step="0.1"
        color="primary"
        density="compact"
        :disabled="!props.hasGround"
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

.icon-toggle-group :deep(.v-btn) {
  min-width: 38px;
}

.noise-type {
  margin-bottom: 10px;
}
</style>
