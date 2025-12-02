<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useTerrainStore } from '@/stores/terrainStore'
import type { GroundDynamicMesh } from '@harmony/schema'

const sceneStore = useSceneStore()
const terrainStore = useTerrainStore()
const { selectedNode } = storeToRefs(sceneStore)
const { brushRadius, brushStrength, brushShape } = storeToRefs(terrainStore)

const selectedGroundNode = computed(() => {
  if (selectedNode.value?.dynamicMesh?.type === 'Ground') {
    return selectedNode.value
  }
  return null
})

const groundDefinition = computed(() => selectedGroundNode.value?.dynamicMesh as GroundDynamicMesh | undefined)

const localWidth = computed(() => groundDefinition.value?.width ?? 0)
const localDepth = computed(() => groundDefinition.value?.depth ?? 0)

</script>

<template>
  <v-expansion-panel value="ground">
    <v-expansion-panel-title>
       Terrain Tools
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div >
        <v-text-field
          :model-value="localWidth"
          label="Width (m)"
          type="number"
          density="compact"
          variant="underlined"
          disabled
          suffix="m"
        />
        <v-text-field
          :model-value="localDepth"
          label="Depth (m)"
          type="number"
          density="compact"
          variant="underlined"
          disabled
          suffix="m"
        />
      </div>

      <div class="control-group " style="    margin: 0px 0px 10px 0px;">
        <div class="text-caption mb-1">Brush Shape</div>
        <v-btn-toggle v-model="brushShape" density="compact" mandatory divided variant="outlined" color="primary">
          <v-btn value="circle" icon="mdi-circle-outline" title="Circle"></v-btn>
          <v-btn value="square" icon="mdi-square-outline" title="Square"></v-btn>
          <v-btn value="star" icon="mdi-star-outline" title="Star"></v-btn>
        </v-btn-toggle>
      </div>
      
      <div class="control-group">
        <div class="text-caption">Brush Radius: {{ brushRadius }}</div>
        <v-text-field
          v-model="brushRadius"
          min="0.1"
          max="50"
          step="0.1"
          type="number"
          density="compact"
          variant="underlined"
          hide-details
          suffix="m"
        />
      </div>

      <div class="control-group ">
        <div class="text-caption ">Brush Strength: {{ brushStrength }}</div>
        <v-text-field
          v-model="brushStrength"
          min="0.1"
          max="10"
          step="0.1"
          type="number"
          variant="underlined"
          density="compact"
          hide-details
          suffix="m"
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
