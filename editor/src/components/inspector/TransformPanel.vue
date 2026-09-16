<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import InspectorVectorControls from '@/components/common/VectorControls.vue'
import type { Direction } from '@/components/common/VectorControls.vue'
import { getRuntimeObject, useSceneStore } from '@/stores/sceneStore'
import type { TransformUpdatePayload } from '@/types/transform-update-payload'
import { isLightweightImportNode, type SceneNode } from '@schema/core'
import { getCachedModelObject } from '@schema/modelObjectCache'
import { findObjectByPath } from '@schema/modelAssetLoader'

const sceneStore = useSceneStore()
const { selectedNode } = storeToRefs(sceneStore)

const props = defineProps<{ disabled?: boolean }>()

type VectorDisplay = { x: string; y: string; z: string }
type VectorAxis = keyof VectorDisplay
type TransformField = 'position' | 'rotation' | 'scale'
type NumericVector = { x: number; y: number; z: number }

const MIN_SCALE = 0.01

/**
 * Lightweight imported model nodes store their transform as a delta on top of
 * the asset node's own local transform (L). The inspector shows and edits the
 * composed absolute local transform (A = C · L) and writes the delta back.
 */
const assetLocalMatrix = computed<THREE.Matrix4 | null>(() => {
  const node = selectedNode.value
  if (!node || !isLightweightImportNode(node)) {
    return null
  }
  const assetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId.trim() : ''
  if (!assetId) {
    return null
  }
  const cached = getCachedModelObject(assetId)
  if (!cached) {
    return null
  }
  const target = findObjectByPath(cached.object, node.importMetadata?.objectPath ?? null)
  if (!target) {
    return null
  }
  return new THREE.Matrix4().compose(target.position, target.quaternion, target.scale)
})

function composeTransformMatrix(
  position: NumericVector,
  rotation: NumericVector,
  scale: NumericVector,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z, 'XYZ')),
    new THREE.Vector3(scale.x, scale.y, scale.z),
  )
}

function decomposeTransformMatrix(matrix: THREE.Matrix4): {
  position: NumericVector
  rotation: NumericVector
  scale: NumericVector
} {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  matrix.decompose(position, quaternion, scale)
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  }
}

function nodeDeltaTransform(node: SceneNode) {
  return {
    position: { x: node.position.x, y: node.position.y, z: node.position.z },
    rotation: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
    scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
  }
}

/** Absolute local transform shown in the inspector (delta composed onto L). */
function resolveAbsoluteTransform(node: SceneNode) {
  const base = assetLocalMatrix.value
  const delta = nodeDeltaTransform(node)
  if (!base) {
    return delta
  }
  return decomposeTransformMatrix(composeTransformMatrix(delta.position, delta.rotation, delta.scale).multiply(base))
}

/** Converts an absolute local transform back into the stored delta (C = A · L⁻¹). */
function resolveDeltaTransform(_node: SceneNode, absolute: {
  position: NumericVector
  rotation: NumericVector
  scale: NumericVector
}) {
  const base = assetLocalMatrix.value
  if (!base) {
    return absolute
  }
  const absoluteMatrix = composeTransformMatrix(absolute.position, absolute.rotation, absolute.scale)
  const deltaMatrix = absoluteMatrix.multiply(new THREE.Matrix4().copy(base).invert())
  return decomposeTransformMatrix(deltaMatrix)
}

function isFieldDisabled(_field: TransformField): boolean {
  if (props.disabled) {
    return true
  }
  return false
}

const transformForm = reactive({
  position: createZeroVector(),
  rotation: createZeroVector(),
  scale: createScaleVector(),
})

function resetPosition() {
  applyTransformReset('position', { position: createNumericVector(0, 0, 0) })
}

function resetRotation() {
  applyTransformReset('rotation', { rotation: createNumericVector(0, 0, 0) })
}

function resetScale() {
  applyTransformReset('scale', { scale: createNumericVector(1, 1, 1) })
}

function ratioScale(direction: Direction) {
  if (isFieldDisabled('scale')) {
    return
  }
  const node = selectedNode.value
  if (!node) {
    return
  }
  const scaleFactor = direction === 'up' ? 1.1 : 0.9
  const absolute = resolveAbsoluteTransform(node)
  const newScale = {
    x: Math.max(MIN_SCALE, absolute.scale.x * scaleFactor),
    y: Math.max(MIN_SCALE, absolute.scale.y * scaleFactor),
    z: Math.max(MIN_SCALE, absolute.scale.z * scaleFactor),
  }
  const delta = resolveDeltaTransform(node, { ...absolute, scale: newScale })
  sceneStore.updateNodeProperties({
    id: node.id,
    scale: delta.scale,
  })
}

function applyTransformReset(
  field: TransformField,
  patch: Partial<Pick<TransformUpdatePayload, 'position' | 'rotation' | 'scale'>>,
) {
  if (isFieldDisabled(field)) {
    return
  }
  const node = selectedNode.value
  if (!node) {
    return
  }
  const absolute = resolveAbsoluteTransform(node)
  const nextAbsolute = {
    position: patch.position ? { ...patch.position } : { ...absolute.position },
    rotation: patch.rotation ? { ...patch.rotation } : { ...absolute.rotation },
    scale: patch.scale ? { ...patch.scale } : { ...absolute.scale },
  }
  const delta = resolveDeltaTransform(node, nextAbsolute)
  sceneStore.updateNodeProperties({
    id: node.id,
    position: delta.position,
    rotation: delta.rotation,
    scale: delta.scale,
  })
}

watch(
  selectedNode,
  (node) => {
    if (!node) {
      resetTransformForm()
      return
    }
    const absolute = resolveAbsoluteTransform(node)
    transformForm.position = {
      x: formatNumeric(absolute.position.x),
      y: formatNumeric(absolute.position.y),
      z: formatNumeric(absolute.position.z),
    }
    transformForm.rotation = {
      x: radToDeg(absolute.rotation.x),
      y: radToDeg(absolute.rotation.y),
      z: radToDeg(absolute.rotation.z),
    }
    transformForm.scale = {
      x: formatNumeric(absolute.scale.x),
      y: formatNumeric(absolute.scale.y),
      z: formatNumeric(absolute.scale.z),
    }
  },
  { immediate: true, deep: true }
)

let liveSyncHandle: number | null = null

function stopLiveTransformSync() {
  if (liveSyncHandle !== null) {
    cancelAnimationFrame(liveSyncHandle)
    liveSyncHandle = null
  }
}

function startLiveTransformSync(nodeId: string) {
  stopLiveTransformSync()

  const tick = () => {
    const node = selectedNode.value
    if (!node || node.id !== nodeId || sceneStore.activeTransformNodeId !== nodeId) {
      stopLiveTransformSync()
      return
    }

    const runtime = getRuntimeObject(nodeId)
    if (runtime) {
      const base = assetLocalMatrix.value
      const displayed = base
        ? decomposeTransformMatrix(
            composeTransformMatrix(
              { x: runtime.position.x, y: runtime.position.y, z: runtime.position.z },
              { x: runtime.rotation.x, y: runtime.rotation.y, z: runtime.rotation.z },
              { x: runtime.scale.x, y: runtime.scale.y, z: runtime.scale.z },
            ).multiply(base),
          )
        : {
            position: { x: runtime.position.x, y: runtime.position.y, z: runtime.position.z },
            rotation: { x: runtime.rotation.x, y: runtime.rotation.y, z: runtime.rotation.z },
            scale: { x: runtime.scale.x, y: runtime.scale.y, z: runtime.scale.z },
          }
      transformForm.position = {
        x: formatNumeric(displayed.position.x),
        y: formatNumeric(displayed.position.y),
        z: formatNumeric(displayed.position.z),
      }
      transformForm.rotation = {
        x: radToDeg(displayed.rotation.x),
        y: radToDeg(displayed.rotation.y),
        z: radToDeg(displayed.rotation.z),
      }
      transformForm.scale = {
        x: formatNumeric(displayed.scale.x),
        y: formatNumeric(displayed.scale.y),
        z: formatNumeric(displayed.scale.z),
      }
    }

    liveSyncHandle = requestAnimationFrame(tick)
  }

  liveSyncHandle = requestAnimationFrame(tick)
}

watch(
  [() => sceneStore.activeTransformNodeId, selectedNode],
  ([activeNodeId, node]) => {
    if (activeNodeId && node && node.id === activeNodeId) {
      startLiveTransformSync(activeNodeId)
      return
    }
    stopLiveTransformSync()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopLiveTransformSync()
})

function handleVectorChange(field: TransformField, axis: VectorAxis, rawValue: string) {
  transformForm[field] = {
    ...transformForm[field],
    [axis]: rawValue,
  }

  if (isFieldDisabled(field)) {
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
  const absolute = resolveAbsoluteTransform(node)
  const baseVector = cloneVector(field, absolute[field] as NumericVector | undefined)

  if (field === 'rotation') {
    baseVector[axis] = degToRad(numericValue)
  } else if (field === 'scale') {
    baseVector[axis] = Math.max(MIN_SCALE, numericValue)
  } else {
    baseVector[axis] = numericValue
  }

  const nextAbsolute = { ...absolute, [field]: baseVector }
  const delta = resolveDeltaTransform(node, nextAbsolute)
  payload[field] = delta[field]
  sceneStore.updateNodeProperties(payload, { autoSaveMode: 'interactive' })
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
          :disabled="isFieldDisabled('position')"
          @dblclick:label="resetPosition"
          @update:axis="(axis, value) => handleVectorChange('position', axis, value)"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Rotation"
          :model-value="transformForm.rotation"
          :disabled="isFieldDisabled('rotation')"
          @dblclick:label="resetRotation"
          @update:axis="(axis, value) => handleVectorChange('rotation', axis, value)"
        />
      </div>
      <div class="section-block">
        <InspectorVectorControls
          label="Scale"
          :model-value="transformForm.scale"
          min="0.01"
          :disabled="isFieldDisabled('scale')"
          @dblclick:label="resetScale"
          @wheel:label="ratioScale"
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
