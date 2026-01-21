<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import AssetPickerList from '@/components/common/AssetPickerList.vue'

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

const selectedAssetId = computed(() => props.asset?.id ?? '')

function formatSliderValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0'
}

const smoothnessPercent = computed(() => `${Math.round((smoothnessModel.value ?? 0) * 100)}%`)
</script>

<template>
  <div class="terrain-paint-panel">
    <div class="control-group">
      <div class="text-caption">Brush Radius: {{ formatSliderValue(brushRadiusModel) }} m</div>
      <v-slider
        v-model="brushRadiusModel"
        :min="0.1"
        :max="50"
        :step="0.1"
        color="primary"
        density="compact"
        hide-details
        :disabled="!props.hasGround"
      />
    </div>

    <div class="control-group">
      <div class="text-caption">Edge Smoothing: {{ smoothnessPercent }}</div>
      <v-slider
        v-model="smoothnessModel"
        :min="0"
        :max="1"
        :step="0.01"
        color="primary"
        density="compact"
        hide-details
        :disabled="!props.hasGround"
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

.hint-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}
</style>
