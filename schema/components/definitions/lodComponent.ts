import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const LOD_COMPONENT_TYPE = 'lod'
export const LOD_LEVEL_KIND_MODEL = 'model'
export const LOD_LEVEL_KIND_BILLBOARD = 'billboard'

export type LodLevelKind = typeof LOD_LEVEL_KIND_MODEL | typeof LOD_LEVEL_KIND_BILLBOARD

export interface LodLevelDefinition {
  /** Switch to this level when camera distance >= distance (meters). */
  distance: number
  /** Render target kind for this LOD level. Billboard is only supported on the final level. */
  kind?: LodLevelKind
  /** Optional model/mesh asset override for this level. */
  modelAssetId: string | null
  /** Optional image/texture asset used when kind === 'billboard'. */
  billboardAssetId?: string | null
}

export interface LodComponentProps {
  /** When true, instances can be culled via frustum checks (implementation is renderer-specific). */
  enableCulling: boolean
  /** LOD levels sorted by ascending distance. */
  levels: LodLevelDefinition[]
}

export interface LodRenderTarget {
  kind: LodLevelKind
  assetId: string | null
}

export const LOD_DEFAULT_ENABLE_CULLING = true

const DEFAULT_LEVELS: LodLevelDefinition[] = [
  { distance: 0, kind: LOD_LEVEL_KIND_MODEL, modelAssetId: null, billboardAssetId: null },
  { distance: 50, kind: LOD_LEVEL_KIND_MODEL, modelAssetId: null, billboardAssetId: null },
  { distance: 200, kind: LOD_LEVEL_KIND_MODEL, modelAssetId: null, billboardAssetId: null },
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
  }
}

export function clampLodComponentProps(props: Partial<LodComponentProps> | null | undefined): LodComponentProps {
  const enableCulling = props?.enableCulling !== false
  const sourceLevels = Array.isArray(props?.levels) ? props!.levels : DEFAULT_LEVELS

  const sanitizedLevels = sourceLevels
    .map((level, index) => {
      const record = level as Partial<LodLevelDefinition> | null | undefined
      return {
        distance: clampDistance(record?.distance, index === 0 ? 0 : DEFAULT_LEVELS[Math.min(index, DEFAULT_LEVELS.length - 1)]!.distance),
        kind: normalizeKind(record?.kind),
        modelAssetId: normalizeAssetId(record?.modelAssetId),
        billboardAssetId: normalizeAssetId(record?.billboardAssetId),
      } satisfies LodLevelDefinition
    })
    .filter((level) => Number.isFinite(level.distance))
    .sort((a, b) => a.distance - b.distance)

  const ensuredLevels = (sanitizedLevels.length ? sanitizedLevels : [DEFAULT_LEVELS[0]!]).map((level, index, levels) => {
    const isLastLevel = index === levels.length - 1
    const isBillboard = level.kind === LOD_LEVEL_KIND_BILLBOARD && isLastLevel
    if (isBillboard) {
      return {
        distance: level.distance,
        kind: LOD_LEVEL_KIND_BILLBOARD,
        modelAssetId: null,
        billboardAssetId: level.billboardAssetId ?? null,
      } satisfies LodLevelDefinition
    }
    return {
      distance: level.distance,
      kind: LOD_LEVEL_KIND_MODEL,
      modelAssetId: level.modelAssetId ?? null,
      billboardAssetId: null,
    } satisfies LodLevelDefinition
  })

  return {
    enableCulling,
    levels: ensuredLevels,
  }
}

export function cloneLodComponentProps(props: LodComponentProps): LodComponentProps {
  return {
    enableCulling: props.enableCulling,
    levels: props.levels.map((level) => ({
      distance: level.distance,
      kind: getLodLevelKind(level),
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
