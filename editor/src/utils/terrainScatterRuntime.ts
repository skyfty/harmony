import * as THREE from 'three'
import type { TerrainScatterInstance } from '@schema/terrain-scatter'
import {
  allocateBillboardInstance,
  getBillboardAspectRatio,
  releaseBillboardInstance,
  updateBillboardInstanceMatrix,
} from '@schema/instancedBillboardCache'
import { allocateModelInstance, releaseModelInstance, updateModelInstanceMatrix } from '@schema/modelObjectCache'

const localPositionHelper = new THREE.Vector3()
const localRotationHelper = new THREE.Euler()
const localScaleHelper = new THREE.Vector3()
const quaternionHelper = new THREE.Quaternion()
const instanceMatrixHelper = new THREE.Matrix4()
const groundMatrixHelper = new THREE.Matrix4()
const billboardScaleHelper = new THREE.Vector3()

export type ScatterRuntimeTarget = {
  kind: 'model' | 'billboard'
  assetId: string
  sourceModelHeight?: number | null
}

export function normalizeScatterRuntimeTarget(target: string | ScatterRuntimeTarget): ScatterRuntimeTarget {
  if (typeof target === 'string') {
    return {
      kind: 'model',
      assetId: target,
      sourceModelHeight: null,
    }
  }
  return {
    kind: target.kind === 'billboard' ? 'billboard' : 'model',
    assetId: target.assetId,
    sourceModelHeight: target.sourceModelHeight ?? null,
  }
}

export function getScatterRuntimeTargetKey(target: string | ScatterRuntimeTarget): string {
  const normalized = normalizeScatterRuntimeTarget(target)
  return `${normalized.kind}:${normalized.assetId}`
}

export function buildScatterNodeId(layerId: string | null | undefined, instanceId: string): string {
  const normalizedLayer = typeof layerId === 'string' && layerId.trim().length ? layerId.trim() : 'layer'
  return `scatter:${normalizedLayer}:${instanceId}`
}

export function composeScatterMatrix(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Object3D,
  target?: THREE.Matrix4,
  groundWorldMatrix?: THREE.Matrix4,
): THREE.Matrix4 {
  const sourceGroundMatrix = groundWorldMatrix ?? (() => {
    groundMesh.updateMatrixWorld(true)
    return groundMesh.matrixWorld
  })()
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
  return output.copy(sourceGroundMatrix).multiply(instanceMatrixHelper)
}

export function composeScatterBillboardMatrix(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Object3D,
  sourceModelHeight: number,
  aspectRatio: number,
  target?: THREE.Matrix4,
  groundWorldMatrix?: THREE.Matrix4,
): THREE.Matrix4 {
  const sourceGroundMatrix = groundWorldMatrix ?? (() => {
    groundMesh.updateMatrixWorld(true)
    return groundMesh.matrixWorld
  })()
  localPositionHelper.set(
    instance.localPosition?.x ?? 0,
    instance.localPosition?.y ?? 0,
    instance.localPosition?.z ?? 0,
  )
  const scale = instance.localScale
  const uniformScale = Math.max(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
  const safeScale = Number.isFinite(uniformScale) && uniformScale > 0 ? uniformScale : 1
  const safeHeight = Number.isFinite(sourceModelHeight) && sourceModelHeight > 0 ? sourceModelHeight : 1
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  const height = safeHeight * safeScale
  const width = height * safeAspect
  billboardScaleHelper.set(width, height, 1)
  instanceMatrixHelper.compose(localPositionHelper, quaternionHelper.identity(), billboardScaleHelper)
  const output = target ?? new THREE.Matrix4()
  return output.copy(sourceGroundMatrix).multiply(instanceMatrixHelper)
}

export function getScatterInstanceWorldPosition(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Object3D,
  target?: THREE.Vector3,
  groundWorldMatrix?: THREE.Matrix4,
): THREE.Vector3 {
  const matrix = composeScatterMatrix(instance, groundMesh, groundMatrixHelper, groundWorldMatrix)
  const output = target ?? new THREE.Vector3()
  return output.setFromMatrixPosition(matrix)
}

export function bindScatterInstance(
  instance: TerrainScatterInstance,
  matrix: THREE.Matrix4,
  target: string | ScatterRuntimeTarget,
): boolean {
  const normalizedTarget = normalizeScatterRuntimeTarget(target)
  const nodeId = buildScatterNodeId(instance.layerId, instance.id)
  const binding = normalizedTarget.kind === 'billboard'
    ? allocateBillboardInstance(normalizedTarget.assetId, nodeId)
    : allocateModelInstance(normalizedTarget.assetId, nodeId)
  if (!binding) {
    return false
  }
  if (normalizedTarget.kind === 'billboard') {
    updateBillboardInstanceMatrix(nodeId, matrix)
  } else {
    updateModelInstanceMatrix(nodeId, matrix)
  }
  instance.binding = {
    nodeId,
    kind: normalizedTarget.kind,
    slots: 'slots' in binding
      ? binding.slots.map((slot) => ({ handleId: slot.handleId, instanceIndex: slot.index }))
      : [{ handleId: binding.slot.handleId, instanceIndex: binding.slot.index }],
  }
  return true
}

export function releaseScatterInstance(instance: TerrainScatterInstance): void {
  const nodeId = instance.binding?.nodeId
  if (!nodeId) {
    return
  }
  if (instance.binding?.kind === 'billboard') {
    releaseBillboardInstance(nodeId)
  } else {
    releaseModelInstance(nodeId)
  }
  instance.binding = null
}

export function updateScatterInstanceMatrix(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Object3D,
  target?: THREE.Matrix4,
  groundWorldMatrix?: THREE.Matrix4,
): THREE.Matrix4 | null {
  const nodeId = instance.binding?.nodeId
  if (!nodeId) {
    return null
  }
  const bindingKind = instance.binding?.kind === 'billboard' ? 'billboard' : 'model'
  const matrix = bindingKind === 'billboard'
    ? composeScatterBillboardMatrix(
        instance,
        groundMesh,
        instance.metadata?.billboardSourceModelHeight as number ?? 1,
        getBillboardAspectRatio(String(instance.metadata?.billboardAssetId ?? '')) ?? 1,
        target,
        groundWorldMatrix,
      )
    : composeScatterMatrix(instance, groundMesh, target, groundWorldMatrix)
  if (bindingKind === 'billboard') {
    updateBillboardInstanceMatrix(nodeId, matrix)
  } else {
    updateModelInstanceMatrix(nodeId, matrix)
  }
  return matrix
}

export function resetScatterInstanceBinding(instance: TerrainScatterInstance): void {
  if (instance.binding?.nodeId) {
    if (instance.binding.kind === 'billboard') {
      releaseBillboardInstance(instance.binding.nodeId)
    } else {
      releaseModelInstance(instance.binding.nodeId)
    }
  }
  instance.binding = null
}
