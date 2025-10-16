<script setup lang="ts">
import { reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const materialForm = reactive({
  color: '#ffffff',
  opacity: 1,
  wireframe: false,
})

watch(
  selectedNode,
  (node) => {
    if (!node || !node.material) {
      materialForm.color = '#ffffff'
      materialForm.opacity = 1
      materialForm.wireframe = false
      return
    }
    materialForm.color = node.material.color ?? '#ffffff'
    materialForm.opacity = node.material.opacity ?? 1
    materialForm.wireframe = node.material.wireframe ?? false
  },
  { immediate: true }
)

function handleColorInput(event: Event) {
  if (!selectedNodeId.value) return
  const value = (event.target as HTMLInputElement).value
  materialForm.color = value
  sceneStore.updateNodeMaterial(selectedNodeId.value, { color: value })
}

function handleOpacity(value: number | number[]) {
  if (!selectedNodeId.value) return
  const numeric = Array.isArray(value) ? value[0] : value
  if (typeof numeric !== 'number' || Number.isNaN(numeric)) {
    return
  }
  materialForm.opacity = numeric
  sceneStore.updateNodeMaterial(selectedNodeId.value, { opacity: numeric })
}
</script>

<template>
  <v-expansion-panel value="material">
    <v-expansion-panel-title>Material</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="section-block material-row">
        <span class="row-label">Base Color</span>
  <input class="color-input" type="color" :value="materialForm.color" @input="handleColorInput" />
      </div>
      <div class="section-block material-row">
        <span class="row-label">Opacity</span>
        <div class="row-controls">
          <v-slider
            :model-value="materialForm.opacity"
            min="0"
            max="1"
            step="0.05"
            hide-details
            class="opacity-slider"
            @update:model-value="handleOpacity"
          />
          <div class="slider-value">{{ materialForm.opacity.toFixed(2) }}</div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.section-block {
  margin-bottom: 0.4rem;
}

.section-block:last-of-type {
  margin-bottom: 0;
}

.material-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.row-label {
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  color: rgba(233, 236, 241, 0.86);
}

.row-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.color-input {
  width: 48px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.opacity-slider {
  width: 140px;
}

.slider-value {
  width: 48px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgba(233, 236, 241, 0.72);
}
</style>
