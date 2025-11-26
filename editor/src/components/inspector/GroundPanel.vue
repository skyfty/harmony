<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { groundSettings } = storeToRefs(sceneStore)

const localWidth = ref<number>(groundSettings.value.width)
const localDepth = ref<number>(groundSettings.value.depth)

function clampDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  const normalized = Math.min(20000, Math.max(1, value))
  return Math.round(normalized * 1000) / 1000
}

watch(
  groundSettings,
  (settings) => {
    localWidth.value = settings.width
    localDepth.value = settings.depth
  },
  { immediate: true },
)

function applyDimensions() {
  const nextWidth = clampDimension(localWidth.value, groundSettings.value.width)
  const nextDepth = clampDimension(localDepth.value, groundSettings.value.depth)

  if (Math.abs(nextWidth - groundSettings.value.width) < 1e-6 && Math.abs(nextDepth - groundSettings.value.depth) < 1e-6) {
    localWidth.value = nextWidth
    localDepth.value = nextDepth
    return
  }

  localWidth.value = nextWidth
  localDepth.value = nextDepth
  sceneStore.setGroundDimensions({ width: nextWidth, depth: nextDepth })
}
</script>

<template>
  <v-expansion-panel value="ground">
    <v-expansion-panel-title>
      Ground Properties
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="ground-grid">
        <v-text-field
          v-model.number="localWidth"
          label="Width (m)"
          type="number"
          density="compact"
          variant="underlined"
          class="slider-input"
      inputmode="decimal"
          step="1"
          min="1"
          suffix="m"
          @blur="applyDimensions"
          @keydown.enter.prevent="applyDimensions"
        />
        <v-text-field
          v-model.number="localDepth"
          label="Depth (m)"
          type="number"
          class="slider-input"
          density="compact"
        inputmode="decimal"
          variant="underlined"
          step="1"
          min="1"
          suffix="m"
          @blur="applyDimensions"
          @keydown.enter.prevent="applyDimensions"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.ground-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem;
}

.v-field-label {
  font-size: 0.82rem;
}
.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}
.hint-text {
  display: block;
  margin-top: 0.25rem;
  color: rgba(220, 225, 232, 0.65);
}
</style>
