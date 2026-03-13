import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { WallDynamicMesh, SceneNodeComponentState, SceneNode } from '../../index'

export const WALL_COMPONENT_TYPE = 'wall'
export const WALL_DEFAULT_HEIGHT = 3
export const WALL_DEFAULT_WIDTH = 0.2
export const WALL_DEFAULT_THICKNESS = 0.2
export const WALL_MIN_HEIGHT = 0.0
export const WALL_MIN_WIDTH = 0.0
export const WALL_MIN_THICKNESS = 0.0
export const WALL_DEFAULT_SMOOTHING = 0.05

export type WallForwardAxis = '+x' | '-x' | '+z' | '-z'

export type WallJointTrim = {
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

export type WallOffsetLocal = {
  x: number
  y: number
  z: number
}

export type WallUvAxis = 'auto' | 'u' | 'v'
export type WallRenderMode = 'stretch' | 'repeatInstances'

export type WallCornerModelRule = {
  /** Asset id of the lower wall body corner/joint model to be instanced. */
  bodyAssetId: string | null
  /** Local positional offset (meters) applied to the body corner instance, in the model's local frame (Option A). */
  bodyOffsetLocal: WallOffsetLocal
  /** Local forward axis for the body corner model. */
  bodyForwardAxis: WallForwardAxis
  /** Extra yaw offset in degrees for the body corner model. */
  bodyYawDeg: number
  /** Asset id of the upper wall head corner/joint model to be instanced. */
  headAssetId: string | null
  /** Local positional offset (meters) applied to the head corner instance, in the model's local frame (Option A). */
  headOffsetLocal: WallOffsetLocal
  /** Local forward axis for the head corner model. */
  headForwardAxis: WallForwardAxis
  /** Extra yaw offset in degrees for the head corner model. */
  headYawDeg: number
  /** Asset id of the lower wall foot corner/joint model to be instanced. */
  footAssetId: string | null
  /** Local positional offset (meters) applied to the foot corner instance, in the model's local frame (Option A). */
  footOffsetLocal: WallOffsetLocal
  /** Local forward axis for the foot corner model. */
  footForwardAxis: WallForwardAxis
  /** Extra yaw offset in degrees for the foot corner model. */
  footYawDeg: number
  /**
   * Target interior corner angle (degrees). Straight = 180°.
   * Runtime picks the closest match within tolerance.
   * Special-case: if the actual interior angle is straight (≈180°) and a 180° rule exists, it is used (tolerance is ignored).
   */
  angle: number
  /** Tolerance range (degrees). Model is only selected if actual interior angle is within ±tolerance of target angle. */
  tolerance: number
  /** Per-angle joint trim distances applied to segments connected by this corner rule. */
  jointTrim: WallJointTrim
}

export interface WallComponentProps {
  height: number
  width: number
  thickness: number
  smoothing: number
  /** Material config id used for the wall body mesh (editor-defined). */
  bodyMaterialConfigId: string | null
  /**
   * When enabled, the wall is rendered as an invisible "air wall".
   * The mesh structure should still exist for rigidbody collision generation.
   */
  isAirWall: boolean
  /** Wall render mode for model placement. */
  wallRenderMode: WallRenderMode
  /** Lower wall body model asset id (required to enable model mode). */
  bodyAssetId: string | null
  /** Orientation overrides for the body model. */
  bodyOrientation: WallModelOrientation
  /** UV repeat axis for the body model stretch-tiling. */
  bodyUvAxis: WallUvAxis
  /** Upper wall head model asset id (optional; rendered independently when set). */
  headAssetId: string | null
  /** Orientation overrides for the head model. */
  headOrientation: WallModelOrientation
  /** UV repeat axis for the head model stretch-tiling. */
  headUvAxis: WallUvAxis
  /** Lower wall foot model asset id (optional; rendered independently when set). */
  footAssetId: string | null
  /** Orientation overrides for the foot model. */
  footOrientation: WallModelOrientation
  /** UV repeat axis for the foot model stretch-tiling. */
  footUvAxis: WallUvAxis
  /** Lower wall end-cap model asset id (optional; rendered independently when set; not used for closed loops). */
  bodyEndCapAssetId: string | null
  /** Local positional offset (meters) applied to the body end-cap instance, in the model's local frame. */
  bodyEndCapOffsetLocal: WallOffsetLocal
  /** Orientation overrides for the body end-cap model. */
  bodyEndCapOrientation: WallModelOrientation
  /** Upper wall head end-cap model asset id (optional; rendered independently when set; not used for closed loops). */
  headEndCapAssetId: string | null
  /** Local positional offset (meters) applied to the head end-cap instance, in the model's local frame. */
  headEndCapOffsetLocal: WallOffsetLocal
  /** Orientation overrides for the head end-cap model. */
  headEndCapOrientation: WallModelOrientation
  /** Lower wall foot end-cap model asset id (optional; rendered independently when set; not used for closed loops). */
  footEndCapAssetId: string | null
  /** Local positional offset (meters) applied to the foot end-cap instance, in the model's local frame. */
  footEndCapOffsetLocal: WallOffsetLocal
  /** Orientation overrides for the foot end-cap model. */
  footEndCapOrientation: WallModelOrientation
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

  const optionalMaterialConfigId = (key: keyof WallComponentProps): string | null => {
    const raw = (props as any)?.[key]
    if (raw == null) {
      return null
    }
    if (typeof raw !== 'string') {
      return null
    }
    const trimmed = raw.trim()
    return trimmed.length ? trimmed : null
  }

  const requiredForwardAxis = (value: unknown, label: string): WallForwardAxis => {
    if (value === '+x' || value === '-x' || value === '+z' || value === '-z') {
      return value
    }
    throw new Error(`WallComponentProps missing/invalid forwardAxis: ${label}`)
  }

  const requiredUvAxis = (value: unknown, label: string): WallUvAxis => {
    if (value === 'auto' || value === 'u' || value === 'v') {
      return value
    }
    throw new Error(`WallComponentProps missing/invalid uvAxis: ${label}`)
  }

  const requiredRenderMode = (value: unknown, label: string): WallRenderMode => {
    if (value === 'stretch' || value === 'repeatInstances') {
      return value
    }
    throw new Error(`WallComponentProps missing/invalid render mode: ${label}`)
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

  const requiredJointTrim = (value: unknown, label: string): WallJointTrim => {
    if (!value || typeof value !== 'object') {
      throw new Error(`WallComponentProps missing/invalid ${label}`)
    }
    const record = value as Record<string, unknown>
    const rawStart = typeof record.start === 'number' ? record.start : Number(record.start)
    const rawEnd = typeof record.end === 'number' ? record.end : Number(record.end)
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      throw new Error(`WallComponentProps missing/invalid ${label}.start/end`)
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

  const normalizeOffsetLocal = (value: unknown): WallOffsetLocal => {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    const read = (key: 'x' | 'y' | 'z'): number => {
      const raw = record ? record[key] : 0
      const num = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(num) ? num : 0
    }
    return { x: read('x'), y: read('y'), z: read('z') }
  }

  const rawCornerModels = (props as any)?.cornerModels
  if (!Array.isArray(rawCornerModels)) {
    throw new Error('WallComponentProps missing/invalid cornerModels')
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
    const footAssetId = parseRuleAssetId(record.footAssetId, 'footAssetId')
    return {
      bodyAssetId,
      headAssetId,
      footAssetId,
      bodyOffsetLocal: normalizeOffsetLocal(record.bodyOffsetLocal),
      headOffsetLocal: normalizeOffsetLocal(record.headOffsetLocal),
      footOffsetLocal: normalizeOffsetLocal(record.footOffsetLocal),
      bodyForwardAxis: requiredForwardAxis(record.bodyForwardAxis, `cornerModels[${index}].bodyForwardAxis`),
      bodyYawDeg: requiredYawDeg(record.bodyYawDeg, `cornerModels[${index}].bodyYawDeg`),
      headForwardAxis: requiredForwardAxis(record.headForwardAxis, `cornerModels[${index}].headForwardAxis`),
      headYawDeg: requiredYawDeg(record.headYawDeg, `cornerModels[${index}].headYawDeg`),
      footForwardAxis: requiredForwardAxis(record.footForwardAxis, `cornerModels[${index}].footForwardAxis`),
      footYawDeg: requiredYawDeg(record.footYawDeg, `cornerModels[${index}].footYawDeg`),
      angle: normalizeAngle(record.angle),
      tolerance: normalizeTolerance(record.tolerance),
      jointTrim: requiredJointTrim(record.jointTrim, `cornerModels[${index}].jointTrim`),
    } satisfies WallCornerModelRule
  })

  const normalizedIsAirWall = requiredBoolean('isAirWall')

  const bodyAssetId = requiredAssetIdOrNull('bodyAssetId')
  const headAssetId = requiredAssetIdOrNull('headAssetId')
  const footAssetId = requiredAssetIdOrNull('footAssetId')

  const bodyEndCapAssetId = requiredAssetIdOrNull('bodyEndCapAssetId')
  const bodyEndCapOffsetLocal = normalizeOffsetLocal((props as any).bodyEndCapOffsetLocal)
  const headEndCapAssetId = requiredAssetIdOrNull('headEndCapAssetId')
  const headEndCapOffsetLocal = normalizeOffsetLocal((props as any).headEndCapOffsetLocal)
  const footEndCapAssetId = requiredAssetIdOrNull('footEndCapAssetId')
  const footEndCapOffsetLocal = normalizeOffsetLocal((props as any).footEndCapOffsetLocal)

  const bodyOrientation = requiredOrientation((props as any).bodyOrientation, 'bodyOrientation')
  const bodyUvAxis = requiredUvAxis((props as any).bodyUvAxis, 'bodyUvAxis')
  const headOrientation = requiredOrientation((props as any).headOrientation, 'headOrientation')
  const headUvAxis = requiredUvAxis((props as any).headUvAxis, 'headUvAxis')
  const footOrientation = requiredOrientation((props as any).footOrientation, 'footOrientation')
  const footUvAxis = requiredUvAxis((props as any).footUvAxis, 'footUvAxis')
  const bodyEndCapOrientation = requiredOrientation((props as any).bodyEndCapOrientation, 'bodyEndCapOrientation')
  const headEndCapOrientation = requiredOrientation((props as any).headEndCapOrientation, 'headEndCapOrientation')
  const footEndCapOrientation = requiredOrientation((props as any).footEndCapOrientation, 'footEndCapOrientation')

  return {
    height,
    width,
    thickness,
    smoothing,
    bodyMaterialConfigId: optionalMaterialConfigId('bodyMaterialConfigId'),
    isAirWall: normalizedIsAirWall,
    wallRenderMode: requiredRenderMode((props as any).wallRenderMode, 'wallRenderMode'),
    bodyAssetId,
    bodyOrientation,
    bodyUvAxis,
    headAssetId,
    headOrientation,
    headUvAxis,
    footAssetId,
    footOrientation,
    footUvAxis,
    bodyEndCapAssetId,
    bodyEndCapOffsetLocal,
    bodyEndCapOrientation,
    headEndCapAssetId,
    headEndCapOffsetLocal,
    headEndCapOrientation,
    footEndCapAssetId,
    footEndCapOffsetLocal,
    footEndCapOrientation,
    cornerModels,
  }
}

export function resolveWallComponentPropsFromMesh(mesh: WallDynamicMesh | undefined | null): WallComponentProps {
  if (!mesh?.chains?.length) {
    return {
      height: WALL_DEFAULT_HEIGHT,
      width: WALL_DEFAULT_WIDTH,
      thickness: WALL_DEFAULT_THICKNESS,
      smoothing: WALL_DEFAULT_SMOOTHING,
      bodyMaterialConfigId: null,
      isAirWall: false,
      wallRenderMode: 'stretch',
      bodyAssetId: null,
      bodyOrientation: { forwardAxis: '+z', yawDeg: 0 },
      bodyUvAxis: 'auto',
      headAssetId: null,
      headOrientation: { forwardAxis: '+z', yawDeg: 0 },
      headUvAxis: 'auto',
      footAssetId: null,
      footOrientation: { forwardAxis: '+z', yawDeg: 0 },
      footUvAxis: 'auto',
      bodyEndCapAssetId: null,
      bodyEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
      bodyEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
      headEndCapAssetId: null,
      headEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
      headEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
      footEndCapAssetId: null,
      footEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
      footEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
      cornerModels: [],
    }
  }
  const base = mesh.dimensions
  return clampWallProps({
    height: base?.height,
    width: base?.width,
    thickness: base?.thickness,
    smoothing: WALL_DEFAULT_SMOOTHING,
    bodyMaterialConfigId: typeof mesh.bodyMaterialConfigId === 'string' && mesh.bodyMaterialConfigId.trim().length
      ? mesh.bodyMaterialConfigId.trim()
      : null,
    isAirWall: false,
    wallRenderMode: 'stretch',
    bodyAssetId: null,
    headAssetId: null,
    footAssetId: null,
    bodyUvAxis: 'auto',
    headUvAxis: 'auto',
    footUvAxis: 'auto',
    bodyEndCapAssetId: null,
    bodyEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
    headEndCapAssetId: null,
    headEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
    footEndCapAssetId: null,
    footEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
    bodyOrientation: { forwardAxis: '+z', yawDeg: 0 },
    headOrientation: { forwardAxis: '+z', yawDeg: 0 },
    footOrientation: { forwardAxis: '+z', yawDeg: 0 },
    bodyEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
    headEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
    footEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
    cornerModels: [],
  })
}

function normalizeWallBodyMaterialConfigId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function resolveWallBodyMaterialConfigIdForRender(
  mesh: Pick<WallDynamicMesh, 'bodyMaterialConfigId'> | undefined | null,
  props: Pick<WallComponentProps, 'bodyMaterialConfigId'> | Partial<Pick<WallComponentProps, 'bodyMaterialConfigId'>> | undefined | null,
): string | null {
  return normalizeWallBodyMaterialConfigId(props?.bodyMaterialConfigId)
    ?? normalizeWallBodyMaterialConfigId(mesh?.bodyMaterialConfigId)
    ?? null
}

export function cloneWallComponentProps(props: WallComponentProps): WallComponentProps {
  return {
    height: props.height,
    width: props.width,
    thickness: props.thickness,
    smoothing: props.smoothing,
    bodyMaterialConfigId: props.bodyMaterialConfigId ?? null,
    isAirWall: Boolean(props.isAirWall),
    wallRenderMode: props.wallRenderMode === 'repeatInstances' ? 'repeatInstances' : 'stretch',
    bodyAssetId: props.bodyAssetId ?? null,
    bodyOrientation: {
      forwardAxis: props.bodyOrientation.forwardAxis,
      yawDeg: props.bodyOrientation.yawDeg,
    },
    bodyUvAxis: props.bodyUvAxis === 'v' ? 'v' : props.bodyUvAxis === 'u' ? 'u' : 'auto',
    headAssetId: props.headAssetId ?? null,
    headOrientation: {
      forwardAxis: props.headOrientation.forwardAxis,
      yawDeg: props.headOrientation.yawDeg,
    },
    headUvAxis: props.headUvAxis === 'v' ? 'v' : props.headUvAxis === 'u' ? 'u' : 'auto',
    footAssetId: props.footAssetId ?? null,
    footOrientation: {
      forwardAxis: props.footOrientation.forwardAxis,
      yawDeg: props.footOrientation.yawDeg,
    },
    footUvAxis: props.footUvAxis === 'v' ? 'v' : props.footUvAxis === 'u' ? 'u' : 'auto',
    bodyEndCapAssetId: props.bodyEndCapAssetId ?? null,
    bodyEndCapOffsetLocal: {
      x: Number((props as any)?.bodyEndCapOffsetLocal?.x) || 0,
      y: Number((props as any)?.bodyEndCapOffsetLocal?.y) || 0,
      z: Number((props as any)?.bodyEndCapOffsetLocal?.z) || 0,
    },
    bodyEndCapOrientation: {
      forwardAxis: props.bodyEndCapOrientation.forwardAxis,
      yawDeg: props.bodyEndCapOrientation.yawDeg,
    },
    headEndCapAssetId: props.headEndCapAssetId ?? null,
    headEndCapOffsetLocal: {
      x: Number((props as any)?.headEndCapOffsetLocal?.x) || 0,
      y: Number((props as any)?.headEndCapOffsetLocal?.y) || 0,
      z: Number((props as any)?.headEndCapOffsetLocal?.z) || 0,
    },
    headEndCapOrientation: {
      forwardAxis: props.headEndCapOrientation.forwardAxis,
      yawDeg: props.headEndCapOrientation.yawDeg,
    },
    footEndCapAssetId: props.footEndCapAssetId ?? null,
    footEndCapOffsetLocal: {
      x: Number((props as any)?.footEndCapOffsetLocal?.x) || 0,
      y: Number((props as any)?.footEndCapOffsetLocal?.y) || 0,
      z: Number((props as any)?.footEndCapOffsetLocal?.z) || 0,
    },
    footEndCapOrientation: {
      forwardAxis: props.footEndCapOrientation.forwardAxis,
      yawDeg: props.footEndCapOrientation.yawDeg,
    },
    cornerModels: Array.isArray(props.cornerModels)
      ? props.cornerModels.map((entry) => ({
        bodyAssetId: typeof entry?.bodyAssetId === 'string' ? entry.bodyAssetId : null,
        headAssetId: typeof entry?.headAssetId === 'string' ? entry.headAssetId : null,
        footAssetId: typeof entry?.footAssetId === 'string' ? entry.footAssetId : null,
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
        footOffsetLocal: {
          x: Number((entry as any)?.footOffsetLocal?.x) || 0,
          y: Number((entry as any)?.footOffsetLocal?.y) || 0,
          z: Number((entry as any)?.footOffsetLocal?.z) || 0,
        },
        bodyForwardAxis: entry.bodyForwardAxis,
        bodyYawDeg: entry.bodyYawDeg,
        headForwardAxis: entry.headForwardAxis,
        headYawDeg: entry.headYawDeg,
        footForwardAxis: entry.footForwardAxis,
        footYawDeg: entry.footYawDeg,
        angle: typeof (entry as any)?.angle === 'number' ? (entry as any).angle : Number((entry as any)?.angle),
        tolerance: typeof (entry as any)?.tolerance === 'number' ? (entry as any).tolerance : Number((entry as any)?.tolerance),
        jointTrim: {
          start: Math.max(0, Number((entry as any)?.jointTrim?.start) || 0),
          end: Math.max(0, Number((entry as any)?.jointTrim?.end) || 0),
        },
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
    bodyMaterialConfigId: overrides?.bodyMaterialConfigId ?? defaults.bodyMaterialConfigId,
    isAirWall: overrides?.isAirWall ?? defaults.isAirWall,
    wallRenderMode: overrides?.wallRenderMode ?? defaults.wallRenderMode,
    bodyAssetId: overrides?.bodyAssetId ?? defaults.bodyAssetId,
    bodyOrientation: (overrides as any)?.bodyOrientation ?? defaults.bodyOrientation,
    bodyUvAxis: (overrides as any)?.bodyUvAxis ?? defaults.bodyUvAxis,
    headAssetId: overrides?.headAssetId ?? defaults.headAssetId,
    headOrientation: (overrides as any)?.headOrientation ?? defaults.headOrientation,
    headUvAxis: (overrides as any)?.headUvAxis ?? defaults.headUvAxis,
    footAssetId: overrides?.footAssetId ?? defaults.footAssetId,
    footOrientation: (overrides as any)?.footOrientation ?? defaults.footOrientation,
    footUvAxis: (overrides as any)?.footUvAxis ?? defaults.footUvAxis,
    bodyEndCapAssetId: overrides?.bodyEndCapAssetId ?? defaults.bodyEndCapAssetId,
    bodyEndCapOffsetLocal: (overrides as any)?.bodyEndCapOffsetLocal ?? defaults.bodyEndCapOffsetLocal,
    bodyEndCapOrientation: (overrides as any)?.bodyEndCapOrientation ?? defaults.bodyEndCapOrientation,
    headEndCapAssetId: overrides?.headEndCapAssetId ?? defaults.headEndCapAssetId,
    headEndCapOffsetLocal: (overrides as any)?.headEndCapOffsetLocal ?? defaults.headEndCapOffsetLocal,
    headEndCapOrientation: (overrides as any)?.headEndCapOrientation ?? defaults.headEndCapOrientation,
    footEndCapAssetId: overrides?.footEndCapAssetId ?? defaults.footEndCapAssetId,
    footEndCapOffsetLocal: (overrides as any)?.footEndCapOffsetLocal ?? defaults.footEndCapOffsetLocal,
    footEndCapOrientation: (overrides as any)?.footEndCapOrientation ?? defaults.footEndCapOrientation,
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
