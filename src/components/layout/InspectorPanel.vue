<script setup lang="ts">
import { reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorVectorControls from '@/components/inspector/InspectorVectorControls.vue'
import { useSceneStore } from '@/stores/sceneStore'
import type { Vector3Like } from '@/types/scene'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

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
          v-model="selectedNode.name"
          label="Name"
          variant="outlined"
          density="comfortable"
          hide-details
        />
        <v-checkbox
          v-model="selectedNode.visible"
          density="comfortable"
          hide-details
        />
      </div>

      <v-list class="inspector-section" lines="two" density="compact">
        <v-list-subheader>Transform</v-list-subheader>
        <InspectorVectorControls
          label="Position"
          :model-value="transformForm.position"
          @update:axis="handlePositionUpdate"
        />
        <InspectorVectorControls
          label="Rotation (deg)"
          :model-value="transformForm.rotation"
          @update:axis="handleRotationUpdate"
        />
        <InspectorVectorControls
          label="Scale"
          :model-value="transformForm.scale"
          min="0.01"
          @update:axis="handleScaleUpdate"
        />
      </v-list>


      <v-list class="inspector-section" lines="two" density="compact">
        <v-list-subheader>Material</v-list-subheader>
        <v-list-item title="Base Color">
          <template #append>
            <input
              class="color-input"
              type="color"
              :value="materialForm.color"
              @input="updateColor(($event.target as HTMLInputElement).value)"
            />
          </template>
        </v-list-item>
        <v-list-item title="Opacity">
          <template #append>
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
          </template>
        </v-list-item>
      </v-list>
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

.panel-toolbar :deep(.v-toolbar-title),
.inspector-section :deep(.v-list-subheader__text) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.inspector-section :deep(.v-list-item-title) {
  font-size: 0.8rem;
}

.inspector-section :deep(.v-list-item-subtitle) {
  font-size: 0.7rem;
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

.inspector-section {
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  padding: 0.25rem 0;
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
