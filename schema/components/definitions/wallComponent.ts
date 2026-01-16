import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { WallDynamicMesh, SceneNodeComponentState, SceneNode } from '../../index'

export const WALL_COMPONENT_TYPE = 'wall'
export const WALL_DEFAULT_HEIGHT = 3
export const WALL_DEFAULT_WIDTH = 0.2
export const WALL_DEFAULT_THICKNESS = 0.2
export const WALL_MIN_HEIGHT = 0.5
export const WALL_MIN_WIDTH = 0.1
export const WALL_MIN_THICKNESS = 0.05
export const WALL_DEFAULT_SMOOTHING = 0.05

export interface WallComponentProps {
  height: number
  width: number
  thickness: number
  smoothing: number
  /**
   * When enabled, the wall is rendered as an invisible "air wall".
   * The mesh structure should still exist for rigidbody collision generation.
   */
  isAirWall: boolean
  bodyAssetId?: string | null
  jointAssetId?: string | null
  endCapAssetId?: string | null
}

export function clampWallProps(props: Partial<WallComponentProps> | null | undefined): WallComponentProps {
  const height = Number.isFinite(props?.height)
    ? Math.max(WALL_MIN_HEIGHT, props!.height!)
    : WALL_DEFAULT_HEIGHT
  const width = Number.isFinite(props?.width)
    ? Math.max(WALL_MIN_WIDTH, props!.width!)
    : WALL_DEFAULT_WIDTH
  const thickness = Number.isFinite(props?.thickness)
    ? Math.max(WALL_MIN_THICKNESS, props!.thickness!)
    : WALL_DEFAULT_THICKNESS
  const smoothingRaw = (props as WallComponentProps | undefined)?.smoothing
  const smoothingValue = typeof smoothingRaw === 'number' ? smoothingRaw : Number(smoothingRaw)
  const smoothing = Number.isFinite(smoothingValue)
    ? Math.min(1, Math.max(0, smoothingValue))
    : WALL_DEFAULT_SMOOTHING

  const normalizeAssetId = (value: unknown): string | null => {
    return typeof value === 'string' && value.trim().length ? value : null
  }

  const isAirWall = (props as WallComponentProps | undefined)?.isAirWall
  const normalizedIsAirWall = Boolean(isAirWall)

  return {
    height,
    width,
    thickness,
    smoothing,
    isAirWall: normalizedIsAirWall,
    bodyAssetId: normalizeAssetId((props as WallComponentProps | undefined)?.bodyAssetId),
    jointAssetId: normalizeAssetId((props as WallComponentProps | undefined)?.jointAssetId),
    endCapAssetId: normalizeAssetId((props as WallComponentProps | undefined)?.endCapAssetId),
  }
}

export function resolveWallComponentPropsFromMesh(mesh: WallDynamicMesh | undefined | null): WallComponentProps {
  if (!mesh?.segments?.length) {
    return {
      height: WALL_DEFAULT_HEIGHT,
      width: WALL_DEFAULT_WIDTH,
      thickness: WALL_DEFAULT_THICKNESS,
      smoothing: WALL_DEFAULT_SMOOTHING,
      isAirWall: false,
      bodyAssetId: null,
      jointAssetId: null,
      endCapAssetId: null,
    }
  }
  const base = mesh.segments[0]
  return clampWallProps({
    height: base?.height,
    width: (base as { width?: number })?.width,
    thickness: base?.thickness,
    smoothing: WALL_DEFAULT_SMOOTHING,
    isAirWall: false,
  })
}

export function cloneWallComponentProps(props: WallComponentProps): WallComponentProps {
  return {
    height: props.height,
    width: props.width,
    thickness: props.thickness,
    smoothing: props.smoothing,
    isAirWall: Boolean(props.isAirWall),
    bodyAssetId: props.bodyAssetId ?? null,
    jointAssetId: props.jointAssetId ?? null,
    endCapAssetId: props.endCapAssetId ?? null,
  }
}

class WallComponent extends Component<WallComponentProps> {
  constructor(context: ComponentRuntimeContext<WallComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }

  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const wallComponentDefinition: ComponentDefinition<WallComponentProps> = {
  type: WALL_COMPONENT_TYPE,
  label: 'Wall',
  icon: 'mdi-wall',
  order: 50,
  inspector: [
    {
      id: 'rendering',
      label: 'Rendering',
      fields: [
        { kind: 'boolean', key: 'isAirWall', label: 'Air Wall (invisible)' },
      ],
    },
    {
      id: 'dimensions',
      label: 'Dimensions',
      fields: [
        { kind: 'number', key: 'height', label: 'Height (m)', min: WALL_MIN_HEIGHT, step: 0.1 },
        { kind: 'number', key: 'width', label: 'Width (m)', min: WALL_MIN_WIDTH, step: 0.05 },
        { kind: 'number', key: 'thickness', label: 'Thickness (m)', min: WALL_MIN_THICKNESS, step: 0.05 },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    return node.dynamicMesh?.type === 'Wall'
  },
  createDefaultProps(node: SceneNode) {
    return resolveWallComponentPropsFromMesh(node.dynamicMesh?.type === 'Wall' ? node.dynamicMesh : null)
  },
  createInstance(context) {
    return new WallComponent(context)
  },
}

componentManager.registerDefinition(wallComponentDefinition)

export function createWallComponentState(
  node: SceneNode,
  overrides?: Partial<WallComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<WallComponentProps> {
  const defaults = wallComponentDefinition.createDefaultProps(node)
  const merged = clampWallProps({
    height: overrides?.height ?? defaults.height,
    width: overrides?.width ?? defaults.width,
    thickness: overrides?.thickness ?? defaults.thickness,
    smoothing: overrides?.smoothing ?? defaults.smoothing,
    isAirWall: overrides?.isAirWall ?? defaults.isAirWall,
    bodyAssetId: overrides?.bodyAssetId ?? defaults.bodyAssetId,
    jointAssetId: overrides?.jointAssetId ?? defaults.jointAssetId,
    endCapAssetId: overrides?.endCapAssetId ?? defaults.endCapAssetId,
  })
  return {
    id: options.id ?? '',
    type: WALL_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { wallComponentDefinition }
