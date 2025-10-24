<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const localHeight = ref(3)
const localWidth = ref(0.2)
const localThickness = ref(0.2)

const hasWallNode = computed(() => selectedNode.value?.dynamicMesh?.type === 'Wall' && !!selectedNodeId.value)

function syncLocalInputs() {
  if (!hasWallNode.value) {
    return
  }
  const definition = selectedNode.value?.dynamicMesh
  if (!definition || definition.type !== 'Wall' || definition.segments.length === 0) {
    return
  }
  const segment = definition.segments[0]
  localHeight.value = segment?.height ?? localHeight.value
  localWidth.value = segment?.width ?? localWidth.value
  localThickness.value = segment?.thickness ?? localThickness.value
}

watch(selectedNode, () => {
  syncLocalInputs()
}, { immediate: true })

function clampDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.max(0.05, value)
}

function applyDimensions() {
  if (!hasWallNode.value || !selectedNodeId.value) {
    return
  }

  const nextHeight = clampDimension(Number(localHeight.value), 3)
  const nextWidth = clampDimension(Number(localWidth.value), 0.2)
  const nextThickness = clampDimension(Number(localThickness.value), 0.2)

  localHeight.value = nextHeight
  localWidth.value = nextWidth
  localThickness.value = nextThickness

  sceneStore.setWallNodeDimensions(selectedNodeId.value, {
    height: nextHeight,
    width: nextWidth,
    thickness: nextThickness,
  })
}
</script>

<template>
  <v-expansion-panel value="wall">
    <v-expansion-panel-title>
      Wall Properties
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="wall-field-grid">
        <v-text-field
          v-model.number="localHeight"
          label="Height (m)"
          type="number"
          density="compact"
          variant="underlined"
          class="slider-input"
          step="0.1"
          min="0.5"
          @blur="applyDimensions"
                inputmode="decimal"
          @keydown.enter.prevent="applyDimensions"
        />
        <v-text-field
          v-model.number="localWidth"
          label="Width (m)"
          type="number"
          density="compact"
          variant="underlined"
          step="0.05"
          min="0.1"
          class="slider-input"
          @blur="applyDimensions"
                inputmode="decimal"
          @keydown.enter.prevent="applyDimensions"
        />
        <v-text-field
          v-model.number="localThickness"
          label="Thickness (m)"
          type="number"
          class="slider-input"
          density="compact"
                inputmode="decimal"
          variant="underlined"
          step="0.05"
          min="0.05"
          @blur="applyDimensions"
          @keydown.enter.prevent="applyDimensions"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.wall-field-grid {
  display: grid;
  gap: 0.2rem;
  margin: 0px 5px;
}

.hint-text {
  display: block;
  margin-top: 0.25rem;
  color: rgba(220, 225, 232, 0.65);
}

.v-field-label {
  font-size: 0.82rem;
}
.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}
</style>
