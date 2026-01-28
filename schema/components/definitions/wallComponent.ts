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

export type WallCornerModelRule = {
  /** Asset id of the lower wall body corner/joint model to be instanced. */
  bodyAssetId: string | null
  /** Asset id of the upper wall head corner/joint model to be instanced. */
  headAssetId: string | null
  /**
   * Target interior corner angle (degrees). Straight = 180°.
   * Runtime picks the closest match within tolerance.
   * Special-case: if the actual interior angle is straight (≈180°) and a 180° rule exists, it is used (tolerance is ignored).
   */
  angle: number
  /** Tolerance range (degrees). Model is only selected if actual interior angle is within ±tolerance of target angle. */
  tolerance: number
}

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
  /** Lower wall body model asset id (required to enable model mode). */
  bodyAssetId?: string | null
  /** Upper wall head model asset id (optional; only valid when bodyAssetId is set). */
  headAssetId?: string | null
  /** Lower wall end-cap model asset id (optional; only valid when bodyAssetId is set; not used for closed loops). */
  bodyEndCapAssetId?: string | null
  /** Upper wall head end-cap model asset id (optional; only valid when bodyEndCapAssetId is set; not used for closed loops). */
  headEndCapAssetId?: string | null
  /**
   * Optional corner model overrides. At runtime the system will pick a model
   * based on the interior corner angle between adjacent wall segments.
   */
  cornerModels?: WallCornerModelRule[]
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

  const normalizeAngle = (value: unknown, fallback: number): number => {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num)) {
      return fallback
    }
    return Math.max(0, Math.min(180, num))
  }

  const normalizeTolerance = (value: unknown, fallback: number): number => {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num)) {
      return fallback
    }
    return Math.max(0, Math.min(90, num))
  }

  const rawCornerModels = (props as WallComponentProps | undefined)?.cornerModels
  const cornerModels = Array.isArray(rawCornerModels)
    ? rawCornerModels
      .map((entry) => {
        const bodyAssetId = normalizeAssetId((entry as WallCornerModelRule | undefined)?.bodyAssetId)
        const headAssetId = bodyAssetId
          ? normalizeAssetId((entry as WallCornerModelRule | undefined)?.headAssetId)
          : null
        const angle = normalizeAngle((entry as WallCornerModelRule | undefined)?.angle, 90)
        const tolerance = normalizeTolerance((entry as WallCornerModelRule | undefined)?.tolerance, 5)
        return { bodyAssetId, headAssetId, angle, tolerance } satisfies WallCornerModelRule
      })
    : []

  const isAirWall = (props as WallComponentProps | undefined)?.isAirWall
  const normalizedIsAirWall = Boolean(isAirWall)

  const bodyAssetId = normalizeAssetId((props as WallComponentProps | undefined)?.bodyAssetId)
  const headAssetId = bodyAssetId
    ? normalizeAssetId((props as WallComponentProps | undefined)?.headAssetId)
    : null

  const bodyEndCapAssetId = bodyAssetId
    ? normalizeAssetId((props as WallComponentProps | undefined)?.bodyEndCapAssetId)
    : null
  const headEndCapAssetId = bodyEndCapAssetId
    ? normalizeAssetId((props as WallComponentProps | undefined)?.headEndCapAssetId)
    : null

  return {
    height,
    width,
    thickness,
    smoothing,
    isAirWall: normalizedIsAirWall,
    bodyAssetId,
    headAssetId,
    bodyEndCapAssetId,
    headEndCapAssetId,
    cornerModels,
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
      headAssetId: null,
      bodyEndCapAssetId: null,
      headEndCapAssetId: null,
      cornerModels: [],
    }
  }
  const base = mesh.segments[0]
  return clampWallProps({
    height: base?.height,
    width: (base as { width?: number })?.width,
    thickness: base?.thickness,
    smoothing: WALL_DEFAULT_SMOOTHING,
    isAirWall: false,
    cornerModels: [],
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
    headAssetId: props.headAssetId ?? null,
    bodyEndCapAssetId: props.bodyEndCapAssetId ?? null,
    headEndCapAssetId: props.headEndCapAssetId ?? null,
    cornerModels: Array.isArray(props.cornerModels)
      ? props.cornerModels.map((entry) => ({
        bodyAssetId: typeof entry?.bodyAssetId === 'string' ? entry.bodyAssetId : null,
        headAssetId: typeof entry?.headAssetId === 'string' ? entry.headAssetId : null,
        angle: typeof (entry as any)?.angle === 'number' ? (entry as any).angle : Number((entry as any)?.angle),
        tolerance: typeof (entry as any)?.tolerance === 'number' ? (entry as any).tolerance : Number((entry as any)?.tolerance),
      }))
      : [],
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
    headAssetId: overrides?.headAssetId ?? defaults.headAssetId,
    bodyEndCapAssetId: overrides?.bodyEndCapAssetId ?? defaults.bodyEndCapAssetId,
    headEndCapAssetId: overrides?.headEndCapAssetId ?? defaults.headEndCapAssetId,
    cornerModels: overrides?.cornerModels ?? (defaults as WallComponentProps).cornerModels,
  })
  return {
    id: options.id ?? '',
    type: WALL_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { wallComponentDefinition }
