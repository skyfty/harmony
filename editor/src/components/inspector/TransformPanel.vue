<script setup lang="ts">
import { reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import InspectorVectorControls from '@/components/common/VectorControls.vue'
import { useSceneStore } from '@/stores/sceneStore'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'

const sceneStore = useSceneStore()
const { selectedNode } = storeToRefs(sceneStore)

const props = defineProps<{ disabled?: boolean }>()

type VectorDisplay = { x: string; y: string; z: string }
type VectorAxis = keyof VectorDisplay
type TransformField = 'position' | 'rotation' | 'scale'
type NumericVector = { x: number; y: number; z: number }

const MIN_SCALE = 0.01

const transformForm = reactive({
  position: createZeroVector(),
  rotation: createZeroVector(),
  scale: createScaleVector(),
})

function resetPosition() {
  applyTransformReset({ position: createNumericVector(0, 0, 0) })
}

function resetRotation() {
  applyTransformReset({ rotation: createNumericVector(0, 0, 0) })
}

function resetScale() {
  applyTransformReset({ scale: createNumericVector(1, 1, 1) })
}

function applyTransformReset(patch: Partial<Pick<TransformUpdatePayload, 'position' | 'rotation' | 'scale'>>) {
  if (props.disabled) {
    return
  }
  const node = selectedNode.value
  if (!node) {
    return
  }
  sceneStore.updateNodeProperties({
    id: node.id,
    ...patch,
  })
}

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

function handleVectorChange(field: TransformField, axis: VectorAxis, rawValue: string) {
  transformForm[field] = {
    ...transformForm[field],
    [axis]: rawValue,
  }

  if (props.disabled) {
    return
  }

  const node = selectedNode.value
  if (!node) {
    return
  }

  const numericValue = parseFloat(rawValue)
  if (!Number.isFinite(numericValue)) {
    return
  }

  const payload: Partial<Pick<TransformUpdatePayload, TransformField>> & { id: string } = {
    id: node.id,
  }
  const baseVector = cloneVector(field, node[field] as NumericVector | undefined)

  if (field === 'rotation') {
    baseVector[axis] = degToRad(numericValue)
  } else if (field === 'scale') {
    baseVector[axis] = Math.max(MIN_SCALE, numericValue)
  } else {
    baseVector[axis] = numericValue
  }

  payload[field] = baseVector
  sceneStore.updateNodeProperties(payload)
}

function radToDeg(value: number) {
  return formatNumeric(value * (180 / Math.PI))
}

function degToRad(value: number) {
  return value * (Math.PI / 180)
}

function resetTransformForm() {
  transformForm.position = createZeroVector()
  transformForm.rotation = createZeroVector()
  transformForm.scale = createScaleVector()
}

function formatNumeric(value: number) {
  if (!Number.isFinite(value)) {
    return '0.00'
  }
  // Truncate (not round) to 2 decimals.
  const truncated = Math.trunc(value * 100) / 100
  return truncated.toFixed(2)
}

function createZeroVector(): VectorDisplay {
  return { x: '0.00', y: '0.00', z: '0.00' }
}

function createScaleVector(): VectorDisplay {
  return { x: '1.00', y: '1.00', z: '1.00' }
}

function createNumericVector(x: number, y: number, z: number) {
  return { x, y, z }
}

function cloneVector(field: TransformField, source?: NumericVector): NumericVector {
  if (!source) {
    return field === 'scale' ? createNumericVector(1, 1, 1) : createNumericVector(0, 0, 0)
  }
  return createNumericVector(source.x, source.y, source.z)
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
          @dblclick:label="resetPosition"
          @update:axis="(axis, value) => handleVectorChange('position', axis, value)"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Rotation"
          :model-value="transformForm.rotation"
          :disabled="props.disabled"
          @dblclick:label="resetRotation"
          @update:axis="(axis, value) => handleVectorChange('rotation', axis, value)"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Scale"
          :model-value="transformForm.scale"
          min="0.01"
          :disabled="props.disabled"
          @dblclick:label="resetScale"
          @update:axis="(axis, value) => handleVectorChange('scale', axis, value)"
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
