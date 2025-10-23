<script setup lang="ts">
import { reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorVectorControls from '@/components/common/VectorControls.vue'
import { useSceneStore } from '@/stores/sceneStore'

const { selectedNode } = storeToRefs(useSceneStore())

const props = defineProps<{ disabled?: boolean }>()

type VectorDisplay = { x: string; y: string; z: string }

const transformForm = reactive({
  position: createZeroVector(),
  rotation: createZeroVector(),
  scale: createScaleVector(),
})

watch(
  selectedNode,
  (node) => {
    if (!node) {
      resetTransformForm()
      return
    }
    transformForm.position = {
      x: formatNumeric(node.position.x),
      y: formatNumeric(node.position.y),
      z: formatNumeric(node.position.z),
    }
    transformForm.rotation = {
      x: radToDeg(node.rotation.x),
      y: radToDeg(node.rotation.y),
      z: radToDeg(node.rotation.z),
    }
    transformForm.scale = {
      x: formatNumeric(node.scale.x),
      y: formatNumeric(node.scale.y),
      z: formatNumeric(node.scale.z),
    }
  },
  { immediate: true, deep: true }
)

function radToDeg(value: number) {
  return formatNumeric(value * (180 / Math.PI))
}

function resetTransformForm() {
  transformForm.position = createZeroVector()
  transformForm.rotation = createZeroVector()
  transformForm.scale = createScaleVector()
}

function formatNumeric(value: number) {
  return value.toFixed(1)
}

function createZeroVector(): VectorDisplay {
  return { x: '0.0', y: '0.0', z: '0.0' }
}

function createScaleVector(): VectorDisplay {
  return { x: '1.0', y: '1.0', z: '1.0' }
}
</script>

<template>
  <v-expansion-panel value="transform">
    <v-expansion-panel-title>Transform</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="transform-field-grid">
      <div class="section-block">
        <InspectorVectorControls
          label="Position"
          :model-value="transformForm.position"
          :disabled="props.disabled"
          :readonly="true"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Rotation"
          :model-value="transformForm.rotation"
          :disabled="props.disabled"
          :readonly="true"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Scale"
          :model-value="transformForm.scale"
          min="0.01"
          :disabled="props.disabled"
          :readonly="true"
        />
      </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.transform-field-grid {
  display: grid;
  margin: 0px 5px;
}

.section-block {
  margin-bottom: 0.4rem;
}

.section-block:last-of-type {
  margin-bottom: 0;
}
</style>
