import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const LOD_COMPONENT_TYPE = 'lod'
export const LOD_LEVEL_KIND_MODEL = 'model'
export const LOD_LEVEL_KIND_BILLBOARD = 'billboard'
export const LOD_FACE_CAMERA_FORWARD_AXIS_X = 'x'
export const LOD_FACE_CAMERA_FORWARD_AXIS_Y = 'y'
export const LOD_FACE_CAMERA_FORWARD_AXIS_Z = 'z'

export type LodLevelKind = typeof LOD_LEVEL_KIND_MODEL | typeof LOD_LEVEL_KIND_BILLBOARD
export type LodFaceCameraForwardAxis =
  | typeof LOD_FACE_CAMERA_FORWARD_AXIS_X
  | typeof LOD_FACE_CAMERA_FORWARD_AXIS_Y
  | typeof LOD_FACE_CAMERA_FORWARD_AXIS_Z

export interface LodLevelDefinition {
  /** Switch to this level when camera distance >= distance (meters). */
  distance: number
  /** Render target kind for this LOD level. Billboard is only supported on the final level. */
  kind?: LodLevelKind
  /** When true on the final level, orient the rendered target toward the camera. */
  faceCamera?: boolean
  /** Local positive axis that should face the camera when faceCamera is enabled on the final model level. */
  forwardAxis?: LodFaceCameraForwardAxis
  /** Optional model/mesh asset override for this level. */
  modelAssetId: string | null
  /** Optional image/texture asset used when kind === 'billboard'. */
  billboardAssetId?: string | null
}

export interface LodComponentProps {
  /** When true, instances can be culled via frustum checks (implementation is renderer-specific). */
  enableCulling: boolean
  /** Authoring order for LOD levels. Use clampLodComponentProps for sorted runtime reads. */
  levels: LodLevelDefinition[]
}

export interface LodRenderTarget {
  kind: LodLevelKind
  assetId: string | null
  faceCamera: boolean
  forwardAxis: LodFaceCameraForwardAxis
}

export const LOD_DEFAULT_ENABLE_CULLING = true

const DEFAULT_LEVELS: LodLevelDefinition[] = [
  { distance: 0, kind: LOD_LEVEL_KIND_MODEL, forwardAxis: LOD_FACE_CAMERA_FORWARD_AXIS_X, modelAssetId: null, billboardAssetId: null },
  { distance: 50, kind: LOD_LEVEL_KIND_MODEL, forwardAxis: LOD_FACE_CAMERA_FORWARD_AXIS_X, modelAssetId: null, billboardAssetId: null },
  { distance: 200, kind: LOD_LEVEL_KIND_MODEL, forwardAxis: LOD_FACE_CAMERA_FORWARD_AXIS_X, modelAssetId: null, billboardAssetId: null },
]

function normalizeAssetId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function clampDistance(value: unknown, fallback: number): number {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) {
    return fallback
  }
  return Math.max(0, raw)
}

function normalizeKind(value: unknown): LodLevelKind {
  return value === LOD_LEVEL_KIND_BILLBOARD ? LOD_LEVEL_KIND_BILLBOARD : LOD_LEVEL_KIND_MODEL
}

function normalizeFaceCamera(value: unknown): boolean {
  return value === true
}

function normalizeForwardAxis(value: unknown): LodFaceCameraForwardAxis {
  if (
    value === LOD_FACE_CAMERA_FORWARD_AXIS_X
    || value === LOD_FACE_CAMERA_FORWARD_AXIS_Y
    || value === LOD_FACE_CAMERA_FORWARD_AXIS_Z
  ) {
    return value
  }
  return LOD_FACE_CAMERA_FORWARD_AXIS_X
}

export function getLodLevelKind(level: Partial<LodLevelDefinition> | null | undefined): LodLevelKind {
  return normalizeKind(level?.kind)
}

export function isLodBillboardLevel(level: Partial<LodLevelDefinition> | null | undefined): boolean {
  return getLodLevelKind(level) === LOD_LEVEL_KIND_BILLBOARD
}

export function getLodLevelModelAssetId(level: Partial<LodLevelDefinition> | null | undefined): string | null {
  return normalizeAssetId(level?.modelAssetId)
}

export function getLodLevelBillboardAssetId(level: Partial<LodLevelDefinition> | null | undefined): string | null {
  return normalizeAssetId(level?.billboardAssetId)
}

export function getLodLevelAssetId(level: Partial<LodLevelDefinition> | null | undefined): string | null {
  return isLodBillboardLevel(level) ? getLodLevelBillboardAssetId(level) : getLodLevelModelAssetId(level)
}

export function resolveLodRenderTarget(level: Partial<LodLevelDefinition> | null | undefined): LodRenderTarget {
  const kind = getLodLevelKind(level)
  return {
    kind,
    assetId: kind === LOD_LEVEL_KIND_BILLBOARD ? getLodLevelBillboardAssetId(level) : getLodLevelModelAssetId(level),
    faceCamera: normalizeFaceCamera(level?.faceCamera),
    forwardAxis: normalizeForwardAxis(level?.forwardAxis),
  }
}

function sanitizeLodLevelDefinition(
  level: Partial<LodLevelDefinition> | null | undefined,
  index: number,
): LodLevelDefinition {
  return {
    distance: clampDistance(level?.distance, index === 0 ? 0 : DEFAULT_LEVELS[Math.min(index, DEFAULT_LEVELS.length - 1)]!.distance),
    kind: normalizeKind(level?.kind),
    faceCamera: normalizeFaceCamera(level?.faceCamera),
    forwardAxis: normalizeForwardAxis(level?.forwardAxis),
    modelAssetId: normalizeAssetId(level?.modelAssetId),
    billboardAssetId: normalizeAssetId(level?.billboardAssetId),
  }
}

export function normalizeLodComponentPropsForEditing(
  props: Partial<LodComponentProps> | null | undefined,
): LodComponentProps {
  const enableCulling = props?.enableCulling !== false
  const sourceLevels = Array.isArray(props?.levels) ? props.levels : DEFAULT_LEVELS
  const levels = sourceLevels
    .map((level, index) => sanitizeLodLevelDefinition(level as Partial<LodLevelDefinition> | null | undefined, index))
    .filter((level) => Number.isFinite(level.distance))

  return {
    enableCulling,
    levels: (levels.length ? levels : [sanitizeLodLevelDefinition(DEFAULT_LEVELS[0], 0)]).map((level) => ({ ...level })),
  }
}

export function clampLodComponentProps(props: Partial<LodComponentProps> | null | undefined): LodComponentProps {
  const normalized = normalizeLodComponentPropsForEditing(props)
  const sanitizedLevels = normalized.levels
    .filter((level) => Number.isFinite(level.distance))
    .sort((a, b) => a.distance - b.distance)

  const ensuredLevels = (sanitizedLevels.length ? sanitizedLevels : [DEFAULT_LEVELS[0]!]).map((level, index, levels) => {
    const isLastLevel = index === levels.length - 1
    const isBillboard = level.kind === LOD_LEVEL_KIND_BILLBOARD && isLastLevel
    if (isBillboard) {
      return {
        distance: level.distance,
        kind: LOD_LEVEL_KIND_BILLBOARD,
        faceCamera: level.faceCamera === true,
        forwardAxis: LOD_FACE_CAMERA_FORWARD_AXIS_Z,
        modelAssetId: null,
        billboardAssetId: level.billboardAssetId ?? null,
      } satisfies LodLevelDefinition
    }
    return {
      distance: level.distance,
      kind: LOD_LEVEL_KIND_MODEL,
      faceCamera: isLastLevel ? level.faceCamera === true : false,
      forwardAxis: isLastLevel ? normalizeForwardAxis(level.forwardAxis) : LOD_FACE_CAMERA_FORWARD_AXIS_X,
      modelAssetId: level.modelAssetId ?? null,
      billboardAssetId: null,
    } satisfies LodLevelDefinition
  })

  return {
    enableCulling: normalized.enableCulling,
    levels: ensuredLevels,
  }
}

export function cloneLodComponentProps(props: LodComponentProps): LodComponentProps {
  return {
    enableCulling: props.enableCulling,
    levels: props.levels.map((level) => ({
      distance: level.distance,
      kind: getLodLevelKind(level),
      faceCamera: level.faceCamera === true,
      forwardAxis: normalizeForwardAxis(level.forwardAxis),
      modelAssetId: level.modelAssetId,
      billboardAssetId: getLodLevelBillboardAssetId(level),
    })),
  }
}

class LodComponent extends Component<LodComponentProps> {
  constructor(context: ComponentRuntimeContext<LodComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }

  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const lodComponentDefinition: ComponentDefinition<LodComponentProps> = {
  type: LOD_COMPONENT_TYPE,
  label: 'LOD',
  icon: 'mdi-layers',
  order: 90,
  canAttach(node: SceneNode) {
    return typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length > 0
  },
  createDefaultProps(node: SceneNode) {
    const defaults = clampLodComponentProps(null)
    const base = typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length
      ? node.sourceAssetId.trim()
      : null
    const levels = defaults.levels.map((level, index) => {
      if (index !== 0) {
        return level
      }
      return {
        ...level,
        kind: LOD_LEVEL_KIND_MODEL as LodLevelKind,
        modelAssetId: level.modelAssetId ?? base,
        billboardAssetId: null,
      }
    })
    return {
      ...defaults,
      levels,
    }
  },
  createInstance(context) {
    return new LodComponent(context)
  },
}

componentManager.registerDefinition(lodComponentDefinition)

export function createLodComponentState(
  node: SceneNode,
  overrides?: Partial<LodComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<LodComponentProps> {
  const defaults = lodComponentDefinition.createDefaultProps(node)
  const merged = clampLodComponentProps({
    enableCulling: overrides?.enableCulling ?? defaults.enableCulling,
    levels: overrides?.levels ?? defaults.levels,
  })
  return {
    id: options.id ?? '',
    type: LOD_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { lodComponentDefinition }
