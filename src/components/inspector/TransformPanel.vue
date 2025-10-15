<script setup lang="ts">
import InspectorVectorControls from '@/components/inspector/VectorControls.vue'
import type { Vector3Like } from '@/types/scene'

const props = defineProps<{
  position: Vector3Like
  rotation: Vector3Like
  scale: Vector3Like
}>()

const emit = defineEmits<{
  (event: 'update:position', axis: keyof Vector3Like, value: string): void
  (event: 'update:rotation', axis: keyof Vector3Like, value: string): void
  (event: 'update:scale', axis: keyof Vector3Like, value: string): void
}>()

function handlePosition(axis: keyof Vector3Like, value: string) {
  emit('update:position', axis, value)
}

function handleRotation(axis: keyof Vector3Like, value: string) {
  emit('update:rotation', axis, value)
}

function handleScale(axis: keyof Vector3Like, value: string) {
  emit('update:scale', axis, value)
}
</script>

<template>
  <v-expansion-panel value="transform">
    <v-expansion-panel-title>Transform</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="section-block">
        <InspectorVectorControls
          label="Position"
          :model-value="props.position"
          @update:axis="handlePosition"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Rotation"
          :model-value="props.rotation"
          @update:axis="handleRotation"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Scale"
          :model-value="props.scale"
          min="0.01"
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
