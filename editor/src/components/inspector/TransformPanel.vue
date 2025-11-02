<script setup lang="ts">
import { reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorVectorControls from '@/components/common/VectorControls.vue'
import { useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { selectedNode } = storeToRefs(sceneStore)

const props = defineProps<{ disabled?: boolean }>()

type VectorDisplay = { x: string; y: string; z: string }
type VectorAxis = 'x' | 'y' | 'z'

const transformForm = reactive({
  position: createZeroVector(),
  rotation: createZeroVector(),
  scale: createScaleVector(),
  offset: createZeroVector(),
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
    transformForm.offset = {
      x: formatNumeric(node.offset?.x ?? 0),
      y: formatNumeric(node.offset?.y ?? 0),
      z: formatNumeric(node.offset?.z ?? 0),
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
  transformForm.offset = createZeroVector()
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

function handleOffsetAxisUpdate(axis: VectorAxis, rawValue: string) {
  if (props.disabled) {
    return
  }
  const node = selectedNode.value
  if (!node) {
    return
  }
  const numeric = Number.parseFloat(rawValue)
  if (!Number.isFinite(numeric)) {
    const source = node.offset as Record<VectorAxis, number> | undefined
    transformForm.offset[axis] = formatNumeric(source?.[axis] ?? 0)
    return
  }
  const currentOffset = (node.offset as Record<VectorAxis, number> | undefined) ?? { x: 0, y: 0, z: 0 }
  if (currentOffset[axis] === numeric) {
    transformForm.offset[axis] = formatNumeric(numeric)
    return
  }
  const nextOffset = {
    x: axis === 'x' ? numeric : currentOffset.x,
    y: axis === 'y' ? numeric : currentOffset.y,
    z: axis === 'z' ? numeric : currentOffset.z,
  }
  sceneStore.setNodeOffset({ id: node.id, offset: nextOffset })
  transformForm.offset[axis] = formatNumeric(numeric)
}
</script>

<template>
  <v-expansion-panel value="transform" >
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
      <div class="section-block">
        <InspectorVectorControls
          label="Offset"
          :model-value="transformForm.offset"
          :disabled="props.disabled"
          :readonly="props.disabled"
          @update:axis="handleOffsetAxisUpdate"
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
