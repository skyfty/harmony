<script setup lang="ts">
import { reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorVectorControls from '@/components/inspector/VectorControls.vue'
import { useSceneStore } from '@/stores/sceneStore'
import type { Vector3Like } from '@/types/scene'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const props = defineProps<{ disabled?: boolean }>()

const transformForm = reactive({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
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
  if (!selectedNodeId.value || props.disabled) return
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
    const clamped = Math.max(0.01, numeric)
    transformForm.scale[axis] = clamped
    sceneStore.updateNodeProperties({
      id: selectedNodeId.value,
      scale: { ...transformForm.scale },
    })
  }
}

function handlePosition(axis: keyof Vector3Like, value: string) {
  updateVector('position', axis, value)
}

function handleRotation(axis: keyof Vector3Like, value: string) {
  updateVector('rotation', axis, value)
}

function handleScale(axis: keyof Vector3Like, value: string) {
  updateVector('scale', axis, value)
}
</script>

<template>
  <v-expansion-panel value="transform">
    <v-expansion-panel-title>Transform</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="section-block">
        <InspectorVectorControls
          label="Position"
          :model-value="transformForm.position"
          :disabled="props.disabled"
          @update:axis="handlePosition"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Rotation"
          :model-value="transformForm.rotation"
          :disabled="props.disabled"
          @update:axis="handleRotation"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Scale"
          :model-value="transformForm.scale"
          min="0.01"
          :disabled="props.disabled"
          @update:axis="handleScale"
        />
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
</style>
