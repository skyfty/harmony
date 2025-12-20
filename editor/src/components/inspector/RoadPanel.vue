<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { RoadDynamicMesh } from '@harmony/schema'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, selectedRoadSegment } = storeToRefs(sceneStore)

const roadDynamicMesh = computed(() => {
  const mesh = selectedNode.value?.dynamicMesh
  if (!mesh || mesh.type !== 'Road') {
    return null
  }
  return mesh as RoadDynamicMesh
})

const selectedSegmentIndex = computed(() => {
  const selection = selectedRoadSegment.value
  if (!selection) {
    return null
  }
  if (!selectedNodeId.value || selection.nodeId !== selectedNodeId.value) {
    return null
  }
  return selection.segmentIndex
})

const availableNodeMaterials = computed(() => {
  const materials = selectedNode.value?.materials ?? []
  return materials.map((entry) => ({
    title: entry.name?.trim() ? entry.name : entry.id.slice(0, 8),
    value: entry.id,
  }))
})

const localMaterialId = ref<string | null>(null)
const isSyncingFromScene = ref(false)

watch(
  () => ({ mesh: roadDynamicMesh.value, segmentIndex: selectedSegmentIndex.value }),
  ({ mesh, segmentIndex }) => {
    isSyncingFromScene.value = true
    if (!mesh || segmentIndex === null || segmentIndex < 0 || segmentIndex >= mesh.segments.length) {
      localMaterialId.value = null
      nextTick(() => {
        isSyncingFromScene.value = false
      })
      return
    }
    localMaterialId.value = mesh.segments[segmentIndex]?.materialId ?? null
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true, deep: false },
)

function applyMaterialIdUpdate(nextMaterialId: string | null) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const mesh = roadDynamicMesh.value
  const segmentIndex = selectedSegmentIndex.value
  if (!nodeId || !mesh || segmentIndex === null) {
    return
  }
  if (segmentIndex < 0 || segmentIndex >= mesh.segments.length) {
    return
  }

  const nextMesh = JSON.parse(JSON.stringify(mesh)) as RoadDynamicMesh
  const segment = nextMesh.segments[segmentIndex]
  if (!segment) {
    return
  }
  segment.materialId = nextMaterialId
  sceneStore.updateNodeDynamicMesh(nodeId, nextMesh)
}
</script>

<template>
  <v-expansion-panel value="road">
    <v-expansion-panel-title>
      <div class="road-panel-header">
        <span class="road-panel-title">Road</span>
        <v-spacer />
        <span v-if="selectedSegmentIndex !== null" class="road-panel-subtitle">
          Segment #{{ selectedSegmentIndex }}
        </span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div v-if="selectedSegmentIndex === null" class="road-panel-empty">
        Select a road segment in the viewport to edit it.
      </div>

      <div v-else class="road-field-grid">
        <v-select
          :items="[{ title: 'None', value: null }, ...availableNodeMaterials]"
          :model-value="localMaterialId"
          label="Segment Material"
          density="compact"
          variant="underlined"
          clearable
          @update:modelValue="(v) => { localMaterialId = v; applyMaterialIdUpdate(v) }"
        />
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.road-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.road-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.road-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
}

.road-panel-empty {
  opacity: 0.8;
  font-size: 0.85rem;
}

.road-field-grid {
  display: grid;
  gap: 0.4rem;
}
</style>
