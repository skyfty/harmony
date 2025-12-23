import * as THREE from 'three'
import type { TerrainScatterInstance } from '@harmony/schema/terrain-scatter'
import { allocateModelInstance, releaseModelInstance, updateModelInstanceMatrix } from '@schema/modelObjectCache'

const localPositionHelper = new THREE.Vector3()
const localRotationHelper = new THREE.Euler()
const localScaleHelper = new THREE.Vector3()
const quaternionHelper = new THREE.Quaternion()
const instanceMatrixHelper = new THREE.Matrix4()
const groundMatrixHelper = new THREE.Matrix4()

export function buildScatterNodeId(layerId: string | null | undefined, instanceId: string): string {
  const normalizedLayer = typeof layerId === 'string' && layerId.trim().length ? layerId.trim() : 'layer'
  return `scatter:${normalizedLayer}:${instanceId}`
}

export function composeScatterMatrix(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Object3D,
  target?: THREE.Matrix4,
): THREE.Matrix4 {
  groundMesh.updateMatrixWorld(true)
  localPositionHelper.set(
    instance.localPosition?.x ?? 0,
    instance.localPosition?.y ?? 0,
    instance.localPosition?.z ?? 0,
  )
  localRotationHelper.set(
    instance.localRotation?.x ?? 0,
    instance.localRotation?.y ?? 0,
    instance.localRotation?.z ?? 0,
    'XYZ',
  )
  quaternionHelper.setFromEuler(localRotationHelper)
  localScaleHelper.set(
    instance.localScale?.x ?? 1,
    instance.localScale?.y ?? 1,
    instance.localScale?.z ?? 1,
  )
  instanceMatrixHelper.compose(localPositionHelper, quaternionHelper, localScaleHelper)
  const output = target ?? new THREE.Matrix4()
  return output.copy(groundMesh.matrixWorld).multiply(instanceMatrixHelper)
}

export function getScatterInstanceWorldPosition(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Object3D,
  target?: THREE.Vector3,
): THREE.Vector3 {
  const matrix = composeScatterMatrix(instance, groundMesh, groundMatrixHelper)
  const output = target ?? new THREE.Vector3()
  return output.setFromMatrixPosition(matrix)
}

export function bindScatterInstance(
  instance: TerrainScatterInstance,
  matrix: THREE.Matrix4,
  assetId: string,
): boolean {
  const nodeId = buildScatterNodeId(instance.layerId, instance.id)
  const binding = allocateModelInstance(assetId, nodeId)
  if (!binding) {
    return false
  }
  updateModelInstanceMatrix(nodeId, matrix)
  instance.binding = {
    nodeId,
    slots: binding.slots.map((slot) => ({ handleId: slot.handleId, instanceIndex: slot.index })),
  }
  return true
}

export function releaseScatterInstance(instance: TerrainScatterInstance): void {
  const nodeId = instance.binding?.nodeId
  if (!nodeId) {
    return
  }
  releaseModelInstance(nodeId)
  instance.binding = null
}

export function updateScatterInstanceMatrix(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Object3D,
  target?: THREE.Matrix4,
): THREE.Matrix4 | null {
  const nodeId = instance.binding?.nodeId
  if (!nodeId) {
    return null
  }
  const matrix = composeScatterMatrix(instance, groundMesh, target)
  updateModelInstanceMatrix(nodeId, matrix)
  return matrix
}

export function resetScatterInstanceBinding(instance: TerrainScatterInstance): void {
  if (instance.binding?.nodeId) {
    releaseModelInstance(instance.binding.nodeId)
  }
  instance.binding = null
}
