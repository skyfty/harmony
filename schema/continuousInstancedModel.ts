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

export type ContinuousInstancedModelUserDataCount = {
  spacing: number
  count: number
}

export type ContinuousInstancedModelUserDataPositions = {
  spacing: number
  positions: Vector3Like[]
}

export type ContinuousInstancedModelUserData = ContinuousInstancedModelUserDataCount | ContinuousInstancedModelUserDataPositions

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

export function getContinuousInstancedModelUserData(node: SceneNode): ContinuousInstancedModelUserData | null {
  const userData = node.userData as Record<string, unknown> | null | undefined
  if (!userData) {
    return null
  }
  const raw = userData[CONTINUOUS_INSTANCED_MODEL_USERDATA_KEY] as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const spacing = typeof (raw as { spacing?: unknown }).spacing === 'number' ? (raw as { spacing: number }).spacing : NaN
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return null
  }

  // Prefer explicit positions data (supports per-instance deletion).
  const positionsCandidate = (raw as { positions?: unknown }).positions
  if (Array.isArray(positionsCandidate) && positionsCandidate.length >= 1) {
    const normalized: Vector3Like[] = []
    for (const entry of positionsCandidate) {
      const candidate = entry as Partial<Vector3Like> | null | undefined
      const x = typeof candidate?.x === 'number' ? candidate.x : NaN
      const y = typeof candidate?.y === 'number' ? candidate.y : NaN
      const z = typeof candidate?.z === 'number' ? candidate.z : NaN
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return null
      }
      normalized.push({ x, y, z })
    }
    return { spacing, positions: normalized }
  }

  // Legacy payloads may still include version=1/count. We accept count without requiring a version.
  const count = typeof (raw as { count?: unknown }).count === 'number' ? (raw as { count: number }).count : NaN
  if (!Number.isFinite(count) || count < 1) {
    return null
  }
  return { spacing, count: Math.floor(count) }
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
    spacing: params.spacing,
    count: Math.max(1, Math.floor(params.count)),
  } satisfies ContinuousInstancedModelUserDataCount

  return base
}

export function buildContinuousInstancedModelUserDataPatchV2(params: {
  previousUserData: SceneNode['userData']
  spacing: number
  positions: Vector3Like[]
}): SceneNode['userData'] {
  const base = (params.previousUserData && typeof params.previousUserData === 'object')
    ? ({ ...(params.previousUserData as Record<string, unknown>) } as Record<string, unknown>)
    : ({} as Record<string, unknown>)

  const spacing = Number.isFinite(params.spacing) && params.spacing > 0 ? params.spacing : 1
  const positions = Array.isArray(params.positions) && params.positions.length
    ? params.positions.map((p) => ({ x: p.x, y: p.y, z: p.z } as Vector3Like))
    : [{ x: 0, y: 0, z: 0 } as Vector3Like]

  base[CONTINUOUS_INSTANCED_MODEL_USERDATA_KEY] = {
    spacing,
    positions,
  } satisfies ContinuousInstancedModelUserDataPositions

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

  if ('positions' in definition) {
    ensureInstancedMeshesRegistered(assetId)

    // Ensure instance 0 exists and stays mapped to nodeId
    allocateModelInstance(assetId, nodeId)

    const count = definition.positions.length
    const existingBindings = getModelInstanceBindingsForNode(nodeId)
    const liveCommitted = new Set<string>()
    for (let i = 1; i < count; i += 1) {
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

    for (let i = 0; i < count; i += 1) {
      const bindingId = committedBindingId(nodeId, i)
      if (i > 0) {
        allocateModelInstanceBinding(assetId, bindingId, nodeId)
      }
      const pos = definition.positions[i]!
      tempVec.set(pos.x, pos.y, pos.z)
      tempTranslation.makeTranslation(tempVec.x, tempVec.y, tempVec.z)
      tempInstance.multiplyMatrices(tempBase, tempTranslation)
      if (bindingId === nodeId) {
        updateModelInstanceMatrix(nodeId, tempInstance)
      } else {
        updateModelInstanceBindingMatrix(bindingId, tempInstance)
      }
    }

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

export function syncInstancedModelCommittedLocalMatrices(params: {
  nodeId: string
  assetId: string
  object: Object3D
  localMatrices: Matrix4[]
  bindingIdPrefix: string
  useNodeIdForIndex0?: boolean
}): void {
  const { nodeId, assetId, object, localMatrices, bindingIdPrefix } = params
  if (!nodeId || !assetId) {
    return
  }
  if (!Array.isArray(localMatrices) || localMatrices.length === 0) {
    return
  }

  const useNodeIdForIndex0 = params.useNodeIdForIndex0 !== false

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

  const count = localMatrices.length

  // Release stale bindings under the provided prefix.
  const existingBindings = getModelInstanceBindingsForNode(nodeId)
  const liveBindings = new Set<string>()
  for (let i = 0; i < count; i += 1) {
    if (useNodeIdForIndex0 && i === 0) {
      continue
    }
    liveBindings.add(`${bindingIdPrefix}${i}`)
  }

  existingBindings.forEach((binding) => {
    if (useNodeIdForIndex0 && binding.bindingId === nodeId) {
      return
    }
    if (!binding.bindingId.startsWith(bindingIdPrefix)) {
      return
    }
    if (!liveBindings.has(binding.bindingId)) {
      releaseModelInstanceBinding(binding.bindingId)
    }
  })

  for (let i = 0; i < count; i += 1) {
    const local = localMatrices[i]
    if (!local) {
      continue
    }

    if (useNodeIdForIndex0 && i === 0) {
      allocateModelInstance(assetId, nodeId)
      tempInstance.multiplyMatrices(tempBase, local)
      updateModelInstanceMatrix(nodeId, tempInstance)
      continue
    }

    const bindingId = `${bindingIdPrefix}${i}`
    allocateModelInstanceBinding(assetId, bindingId, nodeId)
    tempInstance.multiplyMatrices(tempBase, local)
    updateModelInstanceBindingMatrix(bindingId, tempInstance)
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
