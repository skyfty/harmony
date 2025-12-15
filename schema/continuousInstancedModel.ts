import { Matrix4, Vector3, Quaternion, type Object3D } from 'three'
import type { SceneNode, Vector3Like } from './index'
import {
  allocateModelInstance,
  allocateModelInstanceBinding,
  ensureInstancedMeshesRegistered,
  getModelInstanceBindingsForNode,
  releaseModelInstanceBinding,
  updateModelInstanceBindingMatrix,
  updateModelInstanceMatrix,
} from './modelObjectCache'

export const CONTINUOUS_INSTANCED_MODEL_USERDATA_KEY = 'continuousInstancedModel'

export type ContinuousInstancedModelUserDataV1 = {
  version: 1
  spacing: number
  count: number
}

type InstancedBoundsPayload = { min: [number, number, number]; max: [number, number, number] }

function isInstancedBoundsPayload(value: unknown): value is InstancedBoundsPayload {
  if (!value || typeof value !== 'object') {
    return false
  }
  const payload = value as Partial<InstancedBoundsPayload>
  return Array.isArray(payload.min) && payload.min.length === 3 && Array.isArray(payload.max) && payload.max.length === 3
}

export function computeDefaultInstancedSpacing(boundsCandidate: unknown): number {
  if (isInstancedBoundsPayload(boundsCandidate)) {
    const sizeX = Math.abs(boundsCandidate.max[0] - boundsCandidate.min[0])
    const sizeZ = Math.abs(boundsCandidate.max[2] - boundsCandidate.min[2])
    const size = Math.max(sizeX, sizeZ)
    if (Number.isFinite(size) && size > 1e-4) {
      return size
    }
  }
  return 1
}

export function getContinuousInstancedModelUserData(node: SceneNode): ContinuousInstancedModelUserDataV1 | null {
  const userData = node.userData as Record<string, unknown> | null | undefined
  if (!userData) {
    return null
  }
  const raw = userData[CONTINUOUS_INSTANCED_MODEL_USERDATA_KEY] as Partial<ContinuousInstancedModelUserDataV1> | undefined
  if (!raw || raw.version !== 1) {
    return null
  }
  const spacing = typeof raw.spacing === 'number' ? raw.spacing : NaN
  const count = typeof raw.count === 'number' ? raw.count : NaN
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return null
  }
  if (!Number.isFinite(count) || count < 1) {
    return null
  }
  return { version: 1, spacing, count: Math.floor(count) }
}

export function buildContinuousInstancedModelUserDataPatch(params: {
  previousUserData: SceneNode['userData']
  spacing: number
  count: number
}): SceneNode['userData'] {
  const base = (params.previousUserData && typeof params.previousUserData === 'object')
    ? ({ ...(params.previousUserData as Record<string, unknown>) } as Record<string, unknown>)
    : ({} as Record<string, unknown>)

  base[CONTINUOUS_INSTANCED_MODEL_USERDATA_KEY] = {
    version: 1,
    spacing: params.spacing,
    count: Math.max(1, Math.floor(params.count)),
  } satisfies ContinuousInstancedModelUserDataV1

  return base
}

function committedBindingId(nodeId: string, index: number): string {
  if (index === 0) {
    return nodeId
  }
  return `inst:${nodeId}:${index}`
}

function previewBindingId(nodeId: string, index: number): string {
  return `inst-preview:${nodeId}:${index}`
}

const tempBase = new Matrix4()
const tempInstance = new Matrix4()
const tempTranslation = new Matrix4()
const tempVec = new Vector3()
const tempPos = new Vector3()
const tempScale = new Vector3()
const tempQuat = new Quaternion()

export function syncContinuousInstancedModelCommitted(params: {
  node: SceneNode
  object: Object3D
  assetId: string
}): void {
  const { node, object, assetId } = params
  const nodeId = node.id
  if (!nodeId || !assetId) {
    return
  }

  const definition = getContinuousInstancedModelUserData(node)
  object.updateMatrixWorld(true)
  const isVisible = object.visible !== false
  // Preserve shear when visible; only decompose/compose when hiding (scale=0).
  if (isVisible) {
    tempBase.copy(object.matrixWorld)
  } else {
    ;(object.matrixWorld as Matrix4).decompose(tempPos, tempQuat, tempScale)
    tempScale.setScalar(0)
    tempBase.compose(tempPos, tempQuat, tempScale)
  }

  if (!definition) {
    updateModelInstanceMatrix(nodeId, tempBase)
    return
  }

  ensureInstancedMeshesRegistered(assetId)

  // Ensure instance 0 exists and stays mapped to nodeId
  allocateModelInstance(assetId, nodeId)

  // Release stale committed bindings (indices >= 1)
  const existingBindings = getModelInstanceBindingsForNode(nodeId)
  const liveCommitted = new Set<string>()
  for (let i = 1; i < definition.count; i += 1) {
    liveCommitted.add(committedBindingId(nodeId, i))
  }
  existingBindings.forEach((binding) => {
    if (binding.bindingId === nodeId) {
      return
    }
    if (binding.bindingId.startsWith(`inst:${nodeId}:`) && !liveCommitted.has(binding.bindingId)) {
      releaseModelInstanceBinding(binding.bindingId)
    }
  })

  for (let i = 0; i < definition.count; i += 1) {
    const bindingId = committedBindingId(nodeId, i)
    if (i > 0) {
      allocateModelInstanceBinding(assetId, bindingId, nodeId)
    }

    tempVec.set(0, 0, i * definition.spacing)
    tempTranslation.makeTranslation(tempVec.x, tempVec.y, tempVec.z)
    tempInstance.multiplyMatrices(tempBase, tempTranslation)

    if (bindingId === nodeId) {
      updateModelInstanceMatrix(nodeId, tempInstance)
    } else {
      updateModelInstanceBindingMatrix(bindingId, tempInstance)
    }
  }
}

export function syncContinuousInstancedModelPreviewRange(params: {
  nodeId: string
  assetId: string
  object: Object3D
  spacing: number
  startIndex: number
  endIndexExclusive: number
  previousEndIndexExclusive?: number
}): void {
  const { nodeId, assetId, object, spacing, startIndex, endIndexExclusive } = params
  if (!nodeId || !assetId) {
    return
  }
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return
  }

  const prevEnd = Math.max(startIndex, params.previousEndIndexExclusive ?? startIndex)
  const nextEnd = Math.max(startIndex, endIndexExclusive)

  // Release trimmed preview bindings
  for (let i = nextEnd; i < prevEnd; i += 1) {
    releaseModelInstanceBinding(previewBindingId(nodeId, i))
  }

  if (nextEnd <= startIndex) {
    return
  }

  ensureInstancedMeshesRegistered(assetId)
  object.updateMatrixWorld(true)
  const isVisible = object.visible !== false
  if (isVisible) {
    tempBase.copy(object.matrixWorld)
  } else {
    ;(object.matrixWorld as Matrix4).decompose(tempPos, tempQuat, tempScale)
    tempScale.setScalar(0)
    tempBase.compose(tempPos, tempQuat, tempScale)
  }

  for (let i = startIndex; i < nextEnd; i += 1) {
    const bindingId = previewBindingId(nodeId, i)
    allocateModelInstanceBinding(assetId, bindingId, nodeId)

    tempVec.set(0, 0, i * spacing)
    tempTranslation.makeTranslation(tempVec.x, tempVec.y, tempVec.z)
    tempInstance.multiplyMatrices(tempBase, tempTranslation)

    updateModelInstanceBindingMatrix(bindingId, tempInstance)
  }
}

export function clearContinuousInstancedModelPreview(nodeId: string, startIndex: number, endIndexExclusive: number): void {
  for (let i = startIndex; i < endIndexExclusive; i += 1) {
    releaseModelInstanceBinding(previewBindingId(nodeId, i))
  }
}

export function buildLinearLocalPositions(count: number, spacing: number): Vector3Like[] {
  const safeCount = Math.max(1, Math.floor(count))
  const safeSpacing = Number.isFinite(spacing) && spacing > 0 ? spacing : 1
  const positions: Vector3Like[] = []
  for (let i = 0; i < safeCount; i += 1) {
    positions.push({ x: 0, y: 0, z: i * safeSpacing })
  }
  return positions
}
