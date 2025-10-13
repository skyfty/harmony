<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorVectorControls from '@/components/inspector/InspectorVectorControls.vue'
import { useSceneStore } from '@/stores/sceneStore'
import type { Vector3Like } from '@/types/scene'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const nodeName = ref('')
const expandedPanels = ref<string[]>(['transform', 'material'])

const transformForm = reactive({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
})

const materialForm = reactive({
  color: '#ffffff',
  opacity: 1,
  wireframe: false,
})

watch(
  selectedNode,
  (node) => {
    if (!node) return
    nodeName.value = node.name
    expandedPanels.value = ['transform', 'material']
    transformForm.position = { ...node.position }
    transformForm.rotation = {
      x: radToDeg(node.rotation.x),
      y: radToDeg(node.rotation.y),
      z: radToDeg(node.rotation.z),
    }
    transformForm.scale = { ...node.scale }
    materialForm.color = node.material.color
    materialForm.opacity = node.material.opacity ?? 1
    materialForm.wireframe = node.material.wireframe ?? false
  },
  { immediate: true }
)

function radToDeg(value: number) {
  return +(value * (180 / Math.PI)).toFixed(2)
}

function degToRad(value: number) {
  return value * (Math.PI / 180)
}

function updateVector(section: 'position' | 'rotation' | 'scale', axis: keyof Vector3Like, value: string) {
  if (!selectedNodeId.value) return
  const numeric = parseFloat(value)
  if (Number.isNaN(numeric)) {
    return
  }

  if (section === 'rotation') {
    transformForm.rotation[axis] = numeric
    sceneStore.updateNodeProperties({
      id: selectedNodeId.value,
      rotation: {
        x: degToRad(transformForm.rotation.x),
        y: degToRad(transformForm.rotation.y),
        z: degToRad(transformForm.rotation.z),
      },
    })
  } else if (section === 'position') {
    transformForm.position[axis] = numeric
    sceneStore.updateNodeProperties({
      id: selectedNodeId.value,
      position: { ...transformForm.position },
    })
  } else {
    const clamped = section === 'scale' ? Math.max(0.01, numeric) : numeric
    transformForm.scale[axis] = clamped
    sceneStore.updateNodeProperties({
      id: selectedNodeId.value,
      scale: { ...transformForm.scale },
    })
  }
}

function handlePositionUpdate(axis: keyof Vector3Like, value: string) {
  updateVector('position', axis, value)
}

function handleRotationUpdate(axis: keyof Vector3Like, value: string) {
  updateVector('rotation', axis, value)
}

function handleScaleUpdate(axis: keyof Vector3Like, value: string) {
  updateVector('scale', axis, value)
}

function updateColor(value: string) {
  if (!selectedNodeId.value) return
  materialForm.color = value
  sceneStore.updateNodeMaterial(selectedNodeId.value, { color: value })
}

function updateOpacity(value: number) {
  if (!selectedNodeId.value) return
  materialForm.opacity = value
  sceneStore.updateNodeMaterial(selectedNodeId.value, { opacity: value })
}

function updateVisibility(value: boolean | null) {
  if (!selectedNodeId.value) return
  sceneStore.setNodeVisibility(selectedNodeId.value, Boolean(value))
}

function handleNameUpdate(value: string) {
  if (!selectedNodeId.value) return
  nodeName.value = value
  const trimmed = value.trim()
  if (!trimmed) {
    nodeName.value = selectedNode.value?.name ?? ''
    return
  }
  if (trimmed === selectedNode.value?.name) {
    return
  }
  sceneStore.renameNode(selectedNodeId.value, trimmed)
}

</script>

<template>
  <v-card class="panel-card" elevation="4">
    <v-toolbar density="compact" title="Inspector" class="panel-toolbar" height="40">
      <v-spacer />
      <v-btn icon="mdi-window-minimize" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="panel-body" v-if="selectedNode">
      <div style="display: flex; align-items: center; gap: 0.2rem; padding: 0.2rem 0.7rem;">
        <v-icon color="primary" size="40">mdi-cube-outline</v-icon>
        <v-text-field
          :model-value="nodeName"
          variant="solo"
          density="compact"
          hide-details
          @update:modelValue="handleNameUpdate"
        />
        <v-checkbox
          :model-value="selectedNode.visible ?? true"
          density="compact"
          hide-details
          @update:modelValue="updateVisibility"
        />
      </div>

      <v-expansion-panels
        v-model="expandedPanels"
        multiple
        variant="accordion"
        class="inspector-panels"
      >
        <v-expansion-panel value="transform">
          <v-expansion-panel-title>Transform</v-expansion-panel-title>
          <v-expansion-panel-text>
            <div class="section-block">
              <InspectorVectorControls
                label="Position"
                :model-value="transformForm.position"
                @update:axis="handlePositionUpdate"
              />
            </div>
            <div class="section-block">
              <InspectorVectorControls
                label="Rotation (deg)"
                :model-value="transformForm.rotation"
                @update:axis="handleRotationUpdate"
              />
            </div>
            <div class="section-block">
              <InspectorVectorControls
                label="Scale"
                :model-value="transformForm.scale"
                min="0.01"
                @update:axis="handleScaleUpdate"
              />
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel value="material">
          <v-expansion-panel-title>Material</v-expansion-panel-title>
          <v-expansion-panel-text>
            <div class="section-block material-row">
              <span class="row-label">Base Color</span>
              <input
                class="color-input"
                type="color"
                :value="materialForm.color"
                @input="updateColor(($event.target as HTMLInputElement).value)"
              />
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
                  @update:model-value="updateOpacity"
                />
                <div class="slider-value">{{ materialForm.opacity.toFixed(2) }}</div>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>
    <div v-else class="placeholder-text">
      Select an object to inspect its properties.
    </div>
  </v-card>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgba(36, 38, 41, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
    padding: 0.2rem;
  display: flex;
  flex-direction: column;
  gap:0.3rem;
}

.panel-toolbar :deep(.v-toolbar-title) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-inline-start: 0px;
}

.panel-toolbar :deep(.v-btn) {
  width: 32px;
  height: 32px;
}

.inspector-panels {
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  background-color: rgba(14, 16, 18, 0.35);
}

.inspector-panels :deep(.v-expansion-panel-title) {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  min-height: 34px;
  padding-block: 4px;
  
  
}


.inspector-panels :deep(.v-expansion-panel-text__wrapper) {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-top: 0.6rem;
  padding-bottom: 0.6rem;
}

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

.vector-group {
  display: grid;
  grid-template-columns: 1fr repeat(3, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0.5rem 0.7rem;
}

.vector-label {
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  color: rgba(233, 236, 241, 1.0);
}

.vector-input {
  max-width: 90px;
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
