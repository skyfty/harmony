import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const LOD_COMPONENT_TYPE = 'lod'

export interface LodLevelDefinition {
  /** Switch to this level when camera distance >= distance (meters). */
  distance: number
  /** Optional model/mesh asset override for this level. */
  modelAssetId: string | null
}

export interface LodComponentProps {
  /** When true, instances can be culled via frustum checks (implementation is renderer-specific). */
  enableCulling: boolean
  /** LOD levels sorted by ascending distance. */
  levels: LodLevelDefinition[]
}

export const LOD_DEFAULT_ENABLE_CULLING = true

const DEFAULT_LEVELS: LodLevelDefinition[] = [
  { distance: 0, modelAssetId: null },
  { distance: 50, modelAssetId: null },
  { distance: 200, modelAssetId: null },
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

export function clampLodComponentProps(props: Partial<LodComponentProps> | null | undefined): LodComponentProps {
  const enableCulling = props?.enableCulling !== false
  const sourceLevels = Array.isArray(props?.levels) ? props!.levels : DEFAULT_LEVELS

  const sanitizedLevels = sourceLevels
    .map((level, index) => {
      const record = level as Partial<LodLevelDefinition> | null | undefined
      return {
        distance: clampDistance(record?.distance, index === 0 ? 0 : DEFAULT_LEVELS[Math.min(index, DEFAULT_LEVELS.length - 1)]!.distance),
        modelAssetId: normalizeAssetId(record?.modelAssetId),
      } satisfies LodLevelDefinition
    })
    .filter((level) => Number.isFinite(level.distance))
    .sort((a, b) => a.distance - b.distance)

  const ensuredLevels = sanitizedLevels.length ? sanitizedLevels : [{ distance: 0, modelAssetId: null }]

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
      modelAssetId: level.modelAssetId,
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
        modelAssetId: level.modelAssetId ?? base,
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
