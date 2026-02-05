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

export type WallForwardAxis = '+x' | '-x' | '+z' | '-z'

export type WallJointTrimMode = 'auto' | 'manual'

export type WallJointTrimManual = {
  /** Inset distance applied at the start side of an interior joint (meters). */
  start: number
  /** Inset distance applied at the end side of an interior joint (meters). */
  end: number
}

export type WallModelOrientation = {
  /** Local forward axis of the model (horizontal only). */
  forwardAxis: WallForwardAxis
  /** Extra yaw offset in degrees, applied around +Y. */
  yawDeg: number
}

export type WallCornerModelRule = {
  /** Asset id of the lower wall body corner/joint model to be instanced. */
  bodyAssetId: string | null
  /** Local positional offset (meters) applied to the body corner instance, in the model's local frame (Option A). */
  bodyOffsetLocal: { x: number; y: number; z: number }
  /** Local forward axis for the body corner model. */
  bodyForwardAxis: WallForwardAxis
  /** Extra yaw offset in degrees for the body corner model. */
  bodyYawDeg: number
  /** Asset id of the upper wall head corner/joint model to be instanced. */
  headAssetId: string | null
  /** Local positional offset (meters) applied to the head corner instance, in the model's local frame (Option A). */
  headOffsetLocal: { x: number; y: number; z: number }
  /** Local forward axis for the head corner model. */
  headForwardAxis: WallForwardAxis
  /** Extra yaw offset in degrees for the head corner model. */
  headYawDeg: number
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
  /** Joint trim strategy used to avoid overlaps between body tiles and corner models. */
  jointTrimMode: WallJointTrimMode
  /** Manual trim distances (used when jointTrimMode === 'manual'). */
  jointTrimManual: WallJointTrimManual
  /**
   * When enabled, the wall is rendered as an invisible "air wall".
   * The mesh structure should still exist for rigidbody collision generation.
   */
  isAirWall: boolean
  /** Lower wall body model asset id (required to enable model mode). */
  bodyAssetId: string | null
  /** Orientation overrides for the body model. */
  bodyOrientation: WallModelOrientation
  /** Upper wall head model asset id (optional; only valid when bodyAssetId is set). */
  headAssetId: string | null
  /** Orientation overrides for the head model. */
  headOrientation: WallModelOrientation
  /** Lower wall end-cap model asset id (optional; only valid when bodyAssetId is set; not used for closed loops). */
  bodyEndCapAssetId: string | null
  /** Orientation overrides for the body end-cap model. */
  bodyEndCapOrientation: WallModelOrientation
  /** Upper wall head end-cap model asset id (optional; only valid when bodyEndCapAssetId is set; not used for closed loops). */
  headEndCapAssetId: string | null
  /** Orientation overrides for the head end-cap model. */
  headEndCapOrientation: WallModelOrientation
  /**
   * Optional corner model overrides. At runtime the system will pick a model
   * based on the interior corner angle between adjacent wall segments.
   */
  cornerModels: WallCornerModelRule[]
}

export function clampWallProps(props: Partial<WallComponentProps> | null | undefined): WallComponentProps {
  const requiredNumber = (key: keyof WallComponentProps): number => {
    const raw = (props as any)?.[key]
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(value)) {
      throw new Error(`WallComponentProps missing/invalid number: ${String(key)}`)
    }
    return value
  }

  const requiredBoolean = (key: keyof WallComponentProps): boolean => {
    const raw = (props as any)?.[key]
    if (typeof raw !== 'boolean') {
      throw new Error(`WallComponentProps missing/invalid boolean: ${String(key)}`)
    }
    return raw
  }

  const requiredAssetIdOrNull = (key: keyof WallComponentProps): string | null => {
    const raw = (props as any)?.[key]
    if (raw === null) {
      return null
    }
    if (typeof raw !== 'string' || !raw.trim().length) {
      throw new Error(`WallComponentProps missing/invalid asset id: ${String(key)}`)
    }
    return raw.trim()
  }

  const requiredForwardAxis = (value: unknown, label: string): WallForwardAxis => {
    if (value === '+x' || value === '-x' || value === '+z' || value === '-z') {
      return value
    }
    throw new Error(`WallComponentProps missing/invalid forwardAxis: ${label}`)
  }

  const requiredYawDeg = (value: unknown, label: string): number => {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num)) {
      throw new Error(`WallComponentProps missing/invalid yawDeg: ${label}`)
    }
    // Keep yaw in a reasonable range for UI sanity.
    return Math.max(-180, Math.min(180, num))
  }

  const requiredOrientation = (value: unknown, label: string): WallModelOrientation => {
    if (!value || typeof value !== 'object') {
      throw new Error(`WallComponentProps missing/invalid orientation: ${label}`)
    }
    const record = value as Record<string, unknown>
    return {
      forwardAxis: requiredForwardAxis(record.forwardAxis, `${label}.forwardAxis`),
      yawDeg: requiredYawDeg(record.yawDeg, `${label}.yawDeg`),
    }
  }

  const height = Math.max(WALL_MIN_HEIGHT, requiredNumber('height'))
  const width = Math.max(WALL_MIN_WIDTH, requiredNumber('width'))
  const thickness = Math.max(WALL_MIN_THICKNESS, requiredNumber('thickness'))
  const smoothing = Math.min(1, Math.max(0, requiredNumber('smoothing')))

  const requiredJointTrimMode = (value: unknown): WallJointTrimMode => {
    if (value === 'auto' || value === 'manual') {
      return value
    }
    throw new Error('WallComponentProps missing/invalid jointTrimMode')
  }

  const requiredJointTrimManual = (value: unknown): WallJointTrimManual => {
    if (!value || typeof value !== 'object') {
      throw new Error('WallComponentProps missing/invalid jointTrimManual')
    }
    const record = value as Record<string, unknown>
    const rawStart = typeof record.start === 'number' ? record.start : Number(record.start)
    const rawEnd = typeof record.end === 'number' ? record.end : Number(record.end)
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      throw new Error('WallComponentProps missing/invalid jointTrimManual.start/end')
    }
    return {
      start: Math.max(0, rawStart),
      end: Math.max(0, rawEnd),
    }
  }

  const normalizeAngle = (value: unknown): number => {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num)) {
      throw new Error('WallComponentProps missing/invalid cornerModels.angle')
    }
    return Math.max(0, Math.min(180, num))
  }

  const normalizeTolerance = (value: unknown): number => {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num)) {
      throw new Error('WallComponentProps missing/invalid cornerModels.tolerance')
    }
    return Math.max(0, Math.min(90, num))
  }

  const rawCornerModels = (props as any)?.cornerModels
  if (!Array.isArray(rawCornerModels)) {
    throw new Error('WallComponentProps missing/invalid cornerModels')
  }

  const normalizeCornerOffsetLocal = (value: unknown): { x: number; y: number; z: number } => {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    const read = (key: 'x' | 'y' | 'z'): number => {
      const raw = record ? record[key] : 0
      const num = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(num) ? num : 0
    }
    return { x: read('x'), y: read('y'), z: read('z') }
  }

  const cornerModels = rawCornerModels.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`WallComponentProps cornerModels[${index}] invalid`)
    }
    const record = entry as Record<string, unknown>

    const parseRuleAssetId = (value: unknown, label: string): string | null => {
      if (value === null) {
        return null
      }
      if (typeof value !== 'string' || !value.trim().length) {
        throw new Error(`WallComponentProps cornerModels[${index}] missing/invalid ${label}`)
      }
      return value.trim()
    }

    const bodyAssetId = parseRuleAssetId(record.bodyAssetId, 'bodyAssetId')
    const headAssetId = parseRuleAssetId(record.headAssetId, 'headAssetId')
    return {
      bodyAssetId,
      headAssetId,
      bodyOffsetLocal: normalizeCornerOffsetLocal(record.bodyOffsetLocal),
      headOffsetLocal: normalizeCornerOffsetLocal(record.headOffsetLocal),
      bodyForwardAxis: requiredForwardAxis(record.bodyForwardAxis, `cornerModels[${index}].bodyForwardAxis`),
      bodyYawDeg: requiredYawDeg(record.bodyYawDeg, `cornerModels[${index}].bodyYawDeg`),
      headForwardAxis: requiredForwardAxis(record.headForwardAxis, `cornerModels[${index}].headForwardAxis`),
      headYawDeg: requiredYawDeg(record.headYawDeg, `cornerModels[${index}].headYawDeg`),
      angle: normalizeAngle(record.angle),
      tolerance: normalizeTolerance(record.tolerance),
    } satisfies WallCornerModelRule
  })

  const normalizedIsAirWall = requiredBoolean('isAirWall')

  const jointTrimMode = requiredJointTrimMode((props as any)?.jointTrimMode)
  const jointTrimManual = requiredJointTrimManual((props as any)?.jointTrimManual)

  const bodyAssetId = requiredAssetIdOrNull('bodyAssetId')
  const headAssetId = bodyAssetId ? requiredAssetIdOrNull('headAssetId') : null

  const bodyEndCapAssetId = bodyAssetId ? requiredAssetIdOrNull('bodyEndCapAssetId') : null
  const headEndCapAssetId = bodyEndCapAssetId ? requiredAssetIdOrNull('headEndCapAssetId') : null

  const bodyOrientation = requiredOrientation((props as any).bodyOrientation, 'bodyOrientation')
  const headOrientation = requiredOrientation((props as any).headOrientation, 'headOrientation')
  const bodyEndCapOrientation = requiredOrientation((props as any).bodyEndCapOrientation, 'bodyEndCapOrientation')
  const headEndCapOrientation = requiredOrientation((props as any).headEndCapOrientation, 'headEndCapOrientation')

  return {
    height,
    width,
    thickness,
    smoothing,
    jointTrimMode,
    jointTrimManual,
    isAirWall: normalizedIsAirWall,
    bodyAssetId,
    bodyOrientation,
    headAssetId,
    headOrientation,
    bodyEndCapAssetId,
    bodyEndCapOrientation,
    headEndCapAssetId,
    headEndCapOrientation,
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
      jointTrimMode: 'auto',
      jointTrimManual: { start: 0, end: 0 },
      isAirWall: false,
      bodyAssetId: null,
      bodyOrientation: { forwardAxis: '+z', yawDeg: 0 },
      headAssetId: null,
      headOrientation: { forwardAxis: '+z', yawDeg: 0 },
      bodyEndCapAssetId: null,
      bodyEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
      headEndCapAssetId: null,
      headEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
      cornerModels: [],
    }
  }
  const base = mesh.segments[0]
  return clampWallProps({
    height: base?.height,
    width: (base as { width?: number })?.width,
    thickness: base?.thickness,
    smoothing: WALL_DEFAULT_SMOOTHING,
    jointTrimMode: 'auto',
    jointTrimManual: { start: 0, end: 0 },
    isAirWall: false,
    bodyAssetId: null,
    headAssetId: null,
    bodyEndCapAssetId: null,
    headEndCapAssetId: null,
    bodyOrientation: { forwardAxis: '+z', yawDeg: 0 },
    headOrientation: { forwardAxis: '+z', yawDeg: 0 },
    bodyEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
    headEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
    cornerModels: [],
  })
}

export function cloneWallComponentProps(props: WallComponentProps): WallComponentProps {
  return {
    height: props.height,
    width: props.width,
    thickness: props.thickness,
    smoothing: props.smoothing,
    jointTrimMode: props.jointTrimMode,
    jointTrimManual: {
      start: props.jointTrimManual.start,
      end: props.jointTrimManual.end,
    },
    isAirWall: Boolean(props.isAirWall),
    bodyAssetId: props.bodyAssetId ?? null,
    bodyOrientation: {
      forwardAxis: props.bodyOrientation.forwardAxis,
      yawDeg: props.bodyOrientation.yawDeg,
    },
    headAssetId: props.headAssetId ?? null,
    headOrientation: {
      forwardAxis: props.headOrientation.forwardAxis,
      yawDeg: props.headOrientation.yawDeg,
    },
    bodyEndCapAssetId: props.bodyEndCapAssetId ?? null,
    bodyEndCapOrientation: {
      forwardAxis: props.bodyEndCapOrientation.forwardAxis,
      yawDeg: props.bodyEndCapOrientation.yawDeg,
    },
    headEndCapAssetId: props.headEndCapAssetId ?? null,
    headEndCapOrientation: {
      forwardAxis: props.headEndCapOrientation.forwardAxis,
      yawDeg: props.headEndCapOrientation.yawDeg,
    },
    cornerModels: Array.isArray(props.cornerModels)
      ? props.cornerModels.map((entry) => ({
        bodyAssetId: typeof entry?.bodyAssetId === 'string' ? entry.bodyAssetId : null,
        headAssetId: typeof entry?.headAssetId === 'string' ? entry.headAssetId : null,
        bodyOffsetLocal: {
          x: Number((entry as any)?.bodyOffsetLocal?.x) || 0,
          y: Number((entry as any)?.bodyOffsetLocal?.y) || 0,
          z: Number((entry as any)?.bodyOffsetLocal?.z) || 0,
        },
        headOffsetLocal: {
          x: Number((entry as any)?.headOffsetLocal?.x) || 0,
          y: Number((entry as any)?.headOffsetLocal?.y) || 0,
          z: Number((entry as any)?.headOffsetLocal?.z) || 0,
        },
        bodyForwardAxis: entry.bodyForwardAxis,
        bodyYawDeg: entry.bodyYawDeg,
        headForwardAxis: entry.headForwardAxis,
        headYawDeg: entry.headYawDeg,
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
    jointTrimMode: (overrides as any)?.jointTrimMode ?? defaults.jointTrimMode,
    jointTrimManual: (overrides as any)?.jointTrimManual ?? defaults.jointTrimManual,
    isAirWall: overrides?.isAirWall ?? defaults.isAirWall,
    bodyAssetId: overrides?.bodyAssetId ?? defaults.bodyAssetId,
    bodyOrientation: (overrides as any)?.bodyOrientation ?? defaults.bodyOrientation,
    headAssetId: overrides?.headAssetId ?? defaults.headAssetId,
    headOrientation: (overrides as any)?.headOrientation ?? defaults.headOrientation,
    bodyEndCapAssetId: overrides?.bodyEndCapAssetId ?? defaults.bodyEndCapAssetId,
    bodyEndCapOrientation: (overrides as any)?.bodyEndCapOrientation ?? defaults.bodyEndCapOrientation,
    headEndCapAssetId: overrides?.headEndCapAssetId ?? defaults.headEndCapAssetId,
    headEndCapOrientation: (overrides as any)?.headEndCapOrientation ?? defaults.headEndCapOrientation,
    cornerModels: overrides?.cornerModels ?? defaults.cornerModels,
  })
  return {
    id: options.id ?? '',
    type: WALL_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { wallComponentDefinition }
