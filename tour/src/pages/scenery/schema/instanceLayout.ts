import { Box3, Matrix4, Vector3 } from 'three'
import type { Vector3Like } from './index'
import {
  buildInstancedTilingLocalMatrices,
  computeBoxExtentsAlongBasis,
  computeInstancedTilingBasis,
  type InstancedTilingMode,
} from './instancedMeshTiling'

export const INSTANCE_LAYOUT_DEFAULT_COUNT = 1
export const INSTANCE_LAYOUT_DEFAULT_SPACING = 0
export const INSTANCE_LAYOUT_DEFAULT_MODE: InstancedTilingMode = 'axis'
export const INSTANCE_LAYOUT_DEFAULT_FORWARD: Vector3Like = { x: 0, y: 0, z: 1 }
export const INSTANCE_LAYOUT_DEFAULT_UP: Vector3Like = { x: 0, y: 1, z: 0 }
export const INSTANCE_LAYOUT_DEFAULT_ROLL_DEGREES = 0

// NOTE: modelObjectCache uses a fixed InstancedMesh capacity of 2048.
export const INSTANCE_LAYOUT_MAX_INSTANCES = 2048

export type SceneNodeInstanceLayoutMode = 'single' | 'grid'

export interface SceneNodeInstanceLayoutBase {
  /** Optional template assetId used to render instances. When omitted, fallback to node.sourceAssetId. */
  templateAssetId?: string | null
}

export interface SceneNodeInstanceLayoutSingle extends SceneNodeInstanceLayoutBase {
  mode: 'single'
}

export interface SceneNodeInstanceLayoutGrid extends SceneNodeInstanceLayoutBase {
  mode: 'grid'

  /** Instance counts along X/Y/Z (positive direction only). */
  countX: number
  countY: number
  countZ: number

  /** Spacing offsets along X/Y/Z. Can be negative. */
  spacingX: number
  spacingY: number
  spacingZ: number

  /** 'axis' = world-aligned 3D grid; 'vector' = 3D grid using a tilted orthonormal basis. */
  basisMode: InstancedTilingMode

  /** Only for basisMode='vector': local forward direction of the grid (tilt direction). */
  forwardLocal: Vector3Like
  /** Only for basisMode='vector': local up hint to stabilize roll. */
  upLocal: Vector3Like

  /** Only for basisMode='vector': extra roll around forward axis (degrees). */
  rollDegrees: number

  /**
   * Sparse list of erased instance indices for grid mode.
   * Note: index 0 (the base node binding) is reserved and cannot be erased.
   */
  erasedIndices: number[]
}

export type SceneNodeInstanceLayout = SceneNodeInstanceLayoutSingle | SceneNodeInstanceLayoutGrid

function clampCount(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : INSTANCE_LAYOUT_DEFAULT_COUNT
  return Math.max(1, Math.floor(numeric))
}

function clampSpacing(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : INSTANCE_LAYOUT_DEFAULT_SPACING
  return numeric
}

function clampVec3(value: unknown, fallback: Vector3Like): Vector3Like {
  const source = value as Vector3Like | null | undefined
  const x = typeof source?.x === 'number' && Number.isFinite(source.x) ? source.x : fallback.x
  const y = typeof source?.y === 'number' && Number.isFinite(source.y) ? source.y : fallback.y
  const z = typeof source?.z === 'number' && Number.isFinite(source.z) ? source.z : fallback.z
  return { x, y, z }
}

function normalizeTemplateAssetId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function clampErasedIndices(value: unknown, maxCount: number): number[] {
  if (!Array.isArray(value) || maxCount <= 1) {
    return []
  }
  const seen = new Set<number>()
  for (const entry of value) {
    const raw = typeof entry === 'number' ? entry : Number(entry)
    if (!Number.isFinite(raw)) {
      continue
    }
    const index = Math.floor(raw)
    // Reserve index 0 for the base node binding.
    if (index < 1 || index >= maxCount) {
      continue
    }
    seen.add(index)
    if (seen.size >= INSTANCE_LAYOUT_MAX_INSTANCES) {
      break
    }
  }
  return Array.from(seen.values()).sort((a, b) => a - b)
}

export function clampSceneNodeInstanceLayout(raw: unknown): SceneNodeInstanceLayout {
  const source = raw as Partial<SceneNodeInstanceLayout> | null | undefined
  const modeRaw = typeof (source as any)?.mode === 'string' ? String((source as any).mode) : 'single'
  const mode: SceneNodeInstanceLayoutMode = modeRaw === 'grid' ? 'grid' : 'single'

  const templateAssetId = normalizeTemplateAssetId((source as any)?.templateAssetId)

  if (mode === 'single') {
    return { mode: 'single', templateAssetId }
  }

  const basisModeRaw = typeof (source as any)?.basisMode === 'string' ? String((source as any).basisMode) : INSTANCE_LAYOUT_DEFAULT_MODE
  const basisMode: InstancedTilingMode = basisModeRaw === 'vector' ? 'vector' : 'axis'

  const rollDegreesRaw = typeof (source as any)?.rollDegrees === 'number' && Number.isFinite((source as any).rollDegrees)
    ? (source as any).rollDegrees
    : INSTANCE_LAYOUT_DEFAULT_ROLL_DEGREES

  const countX = clampCount((source as any)?.countX)
  const countY = clampCount((source as any)?.countY)
  const countZ = clampCount((source as any)?.countZ)
  const rawCount = countX * countY * countZ
  const maxCount = !Number.isFinite(rawCount) || rawCount <= 0
    ? 1
    : Math.max(1, Math.min(INSTANCE_LAYOUT_MAX_INSTANCES, Math.floor(rawCount)))

  const erasedIndices = clampErasedIndices((source as any)?.erasedIndices, maxCount)

  return {
    mode: 'grid',
    templateAssetId,
    countX,
    countY,
    countZ,
    spacingX: clampSpacing((source as any)?.spacingX),
    spacingY: clampSpacing((source as any)?.spacingY),
    spacingZ: clampSpacing((source as any)?.spacingZ),
    basisMode,
    forwardLocal: clampVec3((source as any)?.forwardLocal, INSTANCE_LAYOUT_DEFAULT_FORWARD),
    upLocal: clampVec3((source as any)?.upLocal, INSTANCE_LAYOUT_DEFAULT_UP),
    rollDegrees: rollDegreesRaw,
    erasedIndices,
  }
}

export function resolveInstanceLayoutTemplateAssetId(layout: SceneNodeInstanceLayout | null | undefined, nodeSourceAssetId: string | null | undefined): string | null {
  const template = typeof layout?.templateAssetId === 'string' ? layout.templateAssetId.trim() : ''
  if (template) {
    return template
  }
  const fallback = typeof nodeSourceAssetId === 'string' ? nodeSourceAssetId.trim() : ''
  return fallback || null
}

export function getInstanceLayoutCount(layout: SceneNodeInstanceLayout): number {
  if (layout.mode === 'grid') {
    const count = layout.countX * layout.countY * layout.countZ
    if (!Number.isFinite(count) || count <= 0) {
      return 1
    }
    return Math.max(1, Math.min(INSTANCE_LAYOUT_MAX_INSTANCES, Math.floor(count)))
  }
  return 1
}

export function getInstanceLayoutBindingId(nodeId: string, instanceIndex: number): string {
  if (instanceIndex <= 0) {
    return nodeId
  }
  return `${nodeId}:instance:${instanceIndex}`
}

export function buildInstanceLayoutSignature(
  layout: SceneNodeInstanceLayout,
  templateAssetId: string,
  extents?: { x: number; y: number; z: number } | null,
): string {
  if (layout.mode === 'single') {
    return `${templateAssetId}|single`
  }
  const erased = `erased:${layout.erasedIndices.join(',')}`
  const basis = [layout.basisMode, `${layout.forwardLocal.x},${layout.forwardLocal.y},${layout.forwardLocal.z}`, `${layout.upLocal.x},${layout.upLocal.y},${layout.upLocal.z}`, `${layout.rollDegrees}`].join(':')
  const counts = `${layout.countX},${layout.countY},${layout.countZ}`
  const spacing = `${layout.spacingX},${layout.spacingY},${layout.spacingZ}`
  const ex = extents ? `${extents.x},${extents.y},${extents.z}` : 'noextents'
  // NOTE: grid layouts are centered around the node origin.
  return `${templateAssetId}|grid|centered|${counts}|${spacing}|${basis}|${erased}|${ex}`
}

export function computeInstanceLayoutGridCenterOffsetLocal(
  layout: SceneNodeInstanceLayout,
  templateBoundingBox: Box3 | null | undefined,
): Vector3 | null {
  if (layout.mode !== 'grid') {
    return null
  }
  const box = templateBoundingBox
  if (!box || box.isEmpty()) {
    return null
  }

  const basis = computeInstancedTilingBasis({
    mode: layout.basisMode,
    forwardLocal: layout.forwardLocal,
    upLocal: layout.upLocal,
    rollDegrees: layout.rollDegrees,
  })

  const extents = computeBoxExtentsAlongBasis(box, basis)
  const stepX = extents.x + layout.spacingX
  const stepY = extents.y + layout.spacingY
  const stepZ = extents.z + layout.spacingZ

  const maxX = Math.max(0, Math.floor(layout.countX) - 1) * (Number.isFinite(stepX) ? stepX : 0)
  const maxY = Math.max(0, Math.floor(layout.countY) - 1) * (Number.isFinite(stepY) ? stepY : 0)
  const maxZ = Math.max(0, Math.floor(layout.countZ) - 1) * (Number.isFinite(stepZ) ? stepZ : 0)

  const offset = new Vector3()
    .addScaledVector(basis.xAxis, maxX * 0.5)
    .addScaledVector(basis.yAxis, maxY * 0.5)
    .addScaledVector(basis.zAxis, maxZ * 0.5)

  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y) || !Number.isFinite(offset.z)) {
    return null
  }

  if (offset.lengthSq() < 1e-12) {
    return new Vector3(0, 0, 0)
  }

  return offset
}

export function buildInstanceLayoutLocalMatrices(layout: SceneNodeInstanceLayout, templateBoundingBox: Box3 | null | undefined): {
  signature: string
  count: number
  localMatrices: Matrix4[]
} {
  const templateAssetId = resolveInstanceLayoutTemplateAssetId(layout, null) ?? ''

  if (layout.mode === 'single') {
    return {
      signature: buildInstanceLayoutSignature(layout, templateAssetId, null),
      count: 1,
      localMatrices: [new Matrix4()],
    }
  }

  const basis = computeInstancedTilingBasis({
    mode: layout.basisMode,
    forwardLocal: layout.forwardLocal,
    upLocal: layout.upLocal,
    rollDegrees: layout.rollDegrees,
  })

  const box = templateBoundingBox
  if (!box) {
    const single: SceneNodeInstanceLayoutSingle = { mode: 'single', templateAssetId: layout.templateAssetId ?? null }
    return {
      signature: buildInstanceLayoutSignature(single, templateAssetId, null),
      count: 1,
      localMatrices: [new Matrix4()],
    }
  }

  const extents = computeBoxExtentsAlongBasis(box, basis)
  const stepX = extents.x + layout.spacingX
  const stepY = extents.y + layout.spacingY
  const stepZ = extents.z + layout.spacingZ

  const rawCount = layout.countX * layout.countY * layout.countZ
  const count = !Number.isFinite(rawCount) || rawCount <= 0
    ? 1
    : Math.max(1, Math.min(INSTANCE_LAYOUT_MAX_INSTANCES, Math.floor(rawCount)))

  const localMatrices = buildInstancedTilingLocalMatrices({
    countX: layout.countX,
    countY: layout.countY,
    countZ: layout.countZ,
    stepX,
    stepY,
    stepZ,
    basis,
  }).slice(0, count)

  // Center the entire grid around the node origin.
  const centerOffset = computeInstanceLayoutGridCenterOffsetLocal(layout, box)
  if (centerOffset && centerOffset.lengthSq() > 1e-12) {
    const tmp = new Vector3()
    for (const matrix of localMatrices) {
      tmp.setFromMatrixPosition(matrix).sub(centerOffset)
      matrix.setPosition(tmp)
    }
  }

  return {
    signature: buildInstanceLayoutSignature(layout, templateAssetId, extents),
    count,
    localMatrices,
  }
}

export function computeInstanceLayoutLocalBoundingBox(
  layout: SceneNodeInstanceLayout,
  templateBoundingBox: Box3 | null | undefined,
): Box3 | null {
  const box = templateBoundingBox
  if (!box || box.isEmpty()) {
    return null
  }

  if (layout.mode === 'single') {
    return box.clone()
  }

  const basis = computeInstancedTilingBasis({
    mode: layout.basisMode,
    forwardLocal: layout.forwardLocal,
    upLocal: layout.upLocal,
    rollDegrees: layout.rollDegrees,
  })

  const extents = computeBoxExtentsAlongBasis(box, basis)
  const stepX = extents.x + layout.spacingX
  const stepY = extents.y + layout.spacingY
  const stepZ = extents.z + layout.spacingZ

  const maxX = Math.max(0, Math.floor(layout.countX) - 1) * (Number.isFinite(stepX) ? stepX : 0)
  const maxY = Math.max(0, Math.floor(layout.countY) - 1) * (Number.isFinite(stepY) ? stepY : 0)
  const maxZ = Math.max(0, Math.floor(layout.countZ) - 1) * (Number.isFinite(stepZ) ? stepZ : 0)

  const xAxis = basis.xAxis
  const yAxis = basis.yAxis
  const zAxis = basis.zAxis

  const minOffset = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const maxOffset = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  const offset = new Vector3()

  const options = [0, 1]
  for (const ax of options) {
    for (const ay of options) {
      for (const az of options) {
        offset
          .set(0, 0, 0)
          .addScaledVector(xAxis, ax ? maxX : 0)
          .addScaledVector(yAxis, ay ? maxY : 0)
          .addScaledVector(zAxis, az ? maxZ : 0)
        minOffset.min(offset)
        maxOffset.max(offset)
      }
    }
  }

  // Grid layouts are centered around the node origin.
  const centerOffset = new Vector3()
    .addScaledVector(xAxis, maxX * 0.5)
    .addScaledVector(yAxis, maxY * 0.5)
    .addScaledVector(zAxis, maxZ * 0.5)
  if (Number.isFinite(centerOffset.x) && Number.isFinite(centerOffset.y) && Number.isFinite(centerOffset.z)) {
    minOffset.sub(centerOffset)
    maxOffset.sub(centerOffset)
  }

  return new Box3(
    new Vector3(box.min.x + minOffset.x, box.min.y + minOffset.y, box.min.z + minOffset.z),
    new Vector3(box.max.x + maxOffset.x, box.max.y + maxOffset.y, box.max.z + maxOffset.z),
  )
}

/**
 * Calls `onMatrix` for each instance matrix.
 *
 * Important: `worldMatrix` is reused between calls. Consume it immediately.
 */
export function forEachInstanceWorldMatrix(params: {
  nodeId: string
  baseMatrixWorld: Matrix4
  layout: SceneNodeInstanceLayout
  templateBoundingBox: Box3 | null | undefined
  cache?: {
    signature: string | null
    locals: Matrix4[]
  }
  onMatrix: (bindingId: string, worldMatrix: Matrix4, instanceIndex: number) => void
}): { signature: string; instanceCount: number; locals: Matrix4[] } {
  const { nodeId, baseMatrixWorld, layout, templateBoundingBox, cache, onMatrix } = params

  const { signature, count, localMatrices } = buildInstanceLayoutLocalMatrices(layout, templateBoundingBox)

  // Reuse cached locals if signature matches.
  const locals = cache && cache.signature === signature ? cache.locals : localMatrices

  const erased = layout.mode === 'grid' && layout.erasedIndices.length
    ? new Set<number>(layout.erasedIndices)
    : null

  const temp = new Matrix4()
  let activeCount = 0
  for (let index = 0; index < count; index += 1) {
    if (erased?.has(index)) {
      continue
    }
    const local = locals[index]
    if (!local) {
      continue
    }
    temp.multiplyMatrices(baseMatrixWorld, local)
    onMatrix(getInstanceLayoutBindingId(nodeId, index), temp, index)
    activeCount += 1
  }

  return { signature, instanceCount: activeCount, locals }
}
