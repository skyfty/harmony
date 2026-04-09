<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { GroundDynamicMesh } from '@schema'

const sceneStore = useSceneStore()
const { selectedNode } = storeToRefs(sceneStore)

const selectedGroundNode = computed(() => {
  if (selectedNode.value?.dynamicMesh?.type === 'Ground') {
    return selectedNode.value
  }
  return null
})

const groundDefinition = computed(() => selectedGroundNode.value?.dynamicMesh as GroundDynamicMesh | undefined)

const localWidth = computed(() => groundDefinition.value?.width ?? 0)
const localDepth = computed(() => groundDefinition.value?.depth ?? 0)
const enableAirWall = computed({
  get: () => sceneStore.groundSettings.enableAirWall === true,
  set: (value: boolean) => {
    sceneStore.setGroundAirWallEnabled(value)
  },
})

const groundCastShadow = computed({
  get: () => groundDefinition.value?.castShadow === true,
  set: (value: boolean) => {
    const node = selectedGroundNode.value
    if (!node || node.dynamicMesh?.type !== 'Ground') {
      return
    }
    sceneStore.updateGroundNodeDynamicMesh(node.id, { castShadow: value })
  },
})

const groundChunkStreamingEnabled = computed({
  get: () => groundDefinition.value?.chunkStreamingEnabled === true,
  set: (value: boolean) => {
    const node = selectedGroundNode.value
    if (!node || node.dynamicMesh?.type !== 'Ground') {
      return
    }
    sceneStore.updateGroundNodeDynamicMesh(node.id, { chunkStreamingEnabled: value })
  },
})

const editorScatterDynamicStreamingEnabled = computed({
  get: () => sceneStore.groundSettings.editorScatterDynamicStreamingEnabled !== false,
  set: (value: boolean) => {
    sceneStore.setGroundEditorScatterDynamicStreamingEnabled(value)
  },
})

const editorScatterVisible = computed({
  get: () => sceneStore.groundSettings.editorScatterVisible !== false,
  set: (value: boolean) => {
    sceneStore.setGroundEditorScatterVisible(value)
  },
})
</script>

<template>
  <v-expansion-panel value="ground">
    <v-expansion-panel-title>
       Ground Tools
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="ground-dimensions">
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

      <v-switch
        v-model="enableAirWall"
        density="compact"
        hide-details
        color="primary"
        label="Enable Air Wall"
      />

      <v-switch
        v-model="groundCastShadow"
        density="compact"
        hide-details
        color="primary"
        label="Cast Ground Shadows"
      />

      <v-switch
        v-model="groundChunkStreamingEnabled"
        density="compact"
        hide-details
        color="primary"
        label="Enable Terrain Chunk Streaming"
      />

      <v-switch
        v-model="editorScatterDynamicStreamingEnabled"
        density="compact"
        hide-details
        color="primary"
        label="Scatter Dynamic Load/Unload"
      />

      <v-switch
        v-model="editorScatterVisible"
        density="compact"
        hide-details
        color="primary"
        label="Show All Ground Scatter"
      />
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

.ground-dimensions {
  display: flex;
  gap: 12px;
}

.ground-dimensions :deep(.v-text-field) {
  flex: 1;
}

</style>
