import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const PURE_PURSUIT_COMPONENT_TYPE = 'purePursuit'

export const DEFAULT_PURE_PURSUIT_LOOKAHEAD_BASE_METERS = 2.2
export const MIN_PURE_PURSUIT_LOOKAHEAD_BASE_METERS = 0.1
export const MAX_PURE_PURSUIT_LOOKAHEAD_BASE_METERS = 50

export const DEFAULT_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN = 0.35
export const MIN_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN = 0
export const MAX_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN = 10

export const DEFAULT_PURE_PURSUIT_LOOKAHEAD_MIN_METERS = 1.2
export const MIN_PURE_PURSUIT_LOOKAHEAD_MIN_METERS = 0.05
export const MAX_PURE_PURSUIT_LOOKAHEAD_MIN_METERS = 50

export const DEFAULT_PURE_PURSUIT_LOOKAHEAD_MAX_METERS = 7
export const MIN_PURE_PURSUIT_LOOKAHEAD_MAX_METERS = 0.1
export const MAX_PURE_PURSUIT_LOOKAHEAD_MAX_METERS = 200

export const DEFAULT_PURE_PURSUIT_SPEED_KP = 1.1
export const MIN_PURE_PURSUIT_SPEED_KP = 0
export const MAX_PURE_PURSUIT_SPEED_KP = 50

export const DEFAULT_PURE_PURSUIT_SPEED_KI = 0.35
export const MIN_PURE_PURSUIT_SPEED_KI = 0
export const MAX_PURE_PURSUIT_SPEED_KI = 50

export const DEFAULT_PURE_PURSUIT_SPEED_INTEGRAL_MAX = 3
export const MIN_PURE_PURSUIT_SPEED_INTEGRAL_MAX = 0
export const MAX_PURE_PURSUIT_SPEED_INTEGRAL_MAX = 100

export const DEFAULT_PURE_PURSUIT_MIN_SPEED_MPS = 0.6
export const MIN_PURE_PURSUIT_MIN_SPEED_MPS = 0
export const MAX_PURE_PURSUIT_MIN_SPEED_MPS = 50

export const DEFAULT_PURE_PURSUIT_CURVATURE_SPEED_FACTOR = 1.4
export const MIN_PURE_PURSUIT_CURVATURE_SPEED_FACTOR = 0
export const MAX_PURE_PURSUIT_CURVATURE_SPEED_FACTOR = 50

export const DEFAULT_PURE_PURSUIT_COAST_DECEL_FORCE_FACTOR = 0.18
export const MIN_PURE_PURSUIT_COAST_DECEL_FORCE_FACTOR = 0
export const MAX_PURE_PURSUIT_COAST_DECEL_FORCE_FACTOR = 1

export const DEFAULT_PURE_PURSUIT_COAST_DEADBAND_MPS = 0.12
export const MIN_PURE_PURSUIT_COAST_DEADBAND_MPS = 0
export const MAX_PURE_PURSUIT_COAST_DEADBAND_MPS = 5

export const DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS = 0.35
export const MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS = 0.05
export const MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS = 20

export const DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS = 1.25
export const MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS = 0.05
export const MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS = 50

export const DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR = 0.2
export const MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR = 0
export const MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR = 10

export const DEFAULT_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS = 2.5
export const MIN_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS = 0
export const MAX_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS = 100

export const DEFAULT_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR = 0.9
export const MIN_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR = 0
export const MAX_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR = 10

export const DEFAULT_PURE_PURSUIT_DOCKING_ENABLED = true
export const DEFAULT_PURE_PURSUIT_DOCK_START_DISTANCE_METERS = 2.5
export const MIN_PURE_PURSUIT_DOCK_START_DISTANCE_METERS = 0
export const MAX_PURE_PURSUIT_DOCK_START_DISTANCE_METERS = 50

export const DEFAULT_PURE_PURSUIT_DOCK_MAX_SPEED_MPS = 0.9
export const MIN_PURE_PURSUIT_DOCK_MAX_SPEED_MPS = 0
export const MAX_PURE_PURSUIT_DOCK_MAX_SPEED_MPS = 20

export const DEFAULT_PURE_PURSUIT_DOCK_VELOCITY_KP = 6
export const MIN_PURE_PURSUIT_DOCK_VELOCITY_KP = 0
export const MAX_PURE_PURSUIT_DOCK_VELOCITY_KP = 100

export const DEFAULT_PURE_PURSUIT_DOCK_YAW_ENABLED = false
export const DEFAULT_PURE_PURSUIT_DOCK_YAW_SLERP_RATE = 10
export const MIN_PURE_PURSUIT_DOCK_YAW_SLERP_RATE = 0
export const MAX_PURE_PURSUIT_DOCK_YAW_SLERP_RATE = 200

export const DEFAULT_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS = 0.5
export const MIN_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS = 0.001
export const MAX_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS = 5

export const DEFAULT_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS = 0.15
export const MIN_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS = 0
export const MAX_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS = 20

export interface PurePursuitComponentProps {
  lookaheadBaseMeters: number
  lookaheadSpeedGain: number
  lookaheadMinMeters: number
  lookaheadMaxMeters: number
  speedKp: number
  speedKi: number
  speedIntegralMax: number
  minSpeedMps: number
  curvatureSpeedFactor: number
  coastDecelForceFactor: number
  coastDeadbandMps: number

  arrivalDistanceMinMeters: number
  arrivalDistanceMaxMeters: number
  arrivalDistanceSpeedFactor: number
  brakeDistanceMinMeters: number
  brakeDistanceSpeedFactor: number

  dockingEnabled: boolean
  dockStartDistanceMeters: number
  dockMaxSpeedMps: number
  dockVelocityKp: number
  dockYawEnabled: boolean
  dockYawSlerpRate: number
  dockStopEpsilonMeters: number
  dockStopSpeedEpsilonMps: number
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false
  }
  return fallback
}

export function clampPurePursuitComponentProps(
  props: Partial<PurePursuitComponentProps> | null | undefined,
): PurePursuitComponentProps {
  const raw = (props ?? {}) as Partial<PurePursuitComponentProps>

  const lookaheadMinMeters = clampNumber(
    raw.lookaheadMinMeters,
    DEFAULT_PURE_PURSUIT_LOOKAHEAD_MIN_METERS,
    MIN_PURE_PURSUIT_LOOKAHEAD_MIN_METERS,
    MAX_PURE_PURSUIT_LOOKAHEAD_MIN_METERS,
  )
  const lookaheadMaxMeters = clampNumber(
    raw.lookaheadMaxMeters,
    DEFAULT_PURE_PURSUIT_LOOKAHEAD_MAX_METERS,
    MIN_PURE_PURSUIT_LOOKAHEAD_MAX_METERS,
    MAX_PURE_PURSUIT_LOOKAHEAD_MAX_METERS,
  )
  const normalizedLookaheadMin = Math.min(lookaheadMinMeters, lookaheadMaxMeters)
  const normalizedLookaheadMax = Math.max(lookaheadMinMeters, lookaheadMaxMeters)

  const arrivalMinMeters = clampNumber(
    raw.arrivalDistanceMinMeters,
    DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS,
    MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS,
    MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS,
  )
  const arrivalMaxMeters = clampNumber(
    raw.arrivalDistanceMaxMeters,
    DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS,
    MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS,
    MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS,
  )
  const normalizedArrivalMin = Math.min(arrivalMinMeters, arrivalMaxMeters)
  const normalizedArrivalMax = Math.max(arrivalMinMeters, arrivalMaxMeters)

  return {
    lookaheadBaseMeters: clampNumber(
      raw.lookaheadBaseMeters,
      DEFAULT_PURE_PURSUIT_LOOKAHEAD_BASE_METERS,
      MIN_PURE_PURSUIT_LOOKAHEAD_BASE_METERS,
      MAX_PURE_PURSUIT_LOOKAHEAD_BASE_METERS,
    ),
    lookaheadSpeedGain: clampNumber(
      raw.lookaheadSpeedGain,
      DEFAULT_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN,
      MIN_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN,
      MAX_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN,
    ),
    lookaheadMinMeters: normalizedLookaheadMin,
    lookaheadMaxMeters: normalizedLookaheadMax,
    speedKp: clampNumber(raw.speedKp, DEFAULT_PURE_PURSUIT_SPEED_KP, MIN_PURE_PURSUIT_SPEED_KP, MAX_PURE_PURSUIT_SPEED_KP),
    speedKi: clampNumber(raw.speedKi, DEFAULT_PURE_PURSUIT_SPEED_KI, MIN_PURE_PURSUIT_SPEED_KI, MAX_PURE_PURSUIT_SPEED_KI),
    speedIntegralMax: clampNumber(
      raw.speedIntegralMax,
      DEFAULT_PURE_PURSUIT_SPEED_INTEGRAL_MAX,
      MIN_PURE_PURSUIT_SPEED_INTEGRAL_MAX,
      MAX_PURE_PURSUIT_SPEED_INTEGRAL_MAX,
    ),
    minSpeedMps: clampNumber(raw.minSpeedMps, DEFAULT_PURE_PURSUIT_MIN_SPEED_MPS, MIN_PURE_PURSUIT_MIN_SPEED_MPS, MAX_PURE_PURSUIT_MIN_SPEED_MPS),
    curvatureSpeedFactor: clampNumber(
      raw.curvatureSpeedFactor,
      DEFAULT_PURE_PURSUIT_CURVATURE_SPEED_FACTOR,
      MIN_PURE_PURSUIT_CURVATURE_SPEED_FACTOR,
      MAX_PURE_PURSUIT_CURVATURE_SPEED_FACTOR,
    ),
    coastDecelForceFactor: clampNumber(
      raw.coastDecelForceFactor,
      DEFAULT_PURE_PURSUIT_COAST_DECEL_FORCE_FACTOR,
      MIN_PURE_PURSUIT_COAST_DECEL_FORCE_FACTOR,
      MAX_PURE_PURSUIT_COAST_DECEL_FORCE_FACTOR,
    ),
    coastDeadbandMps: clampNumber(
      raw.coastDeadbandMps,
      DEFAULT_PURE_PURSUIT_COAST_DEADBAND_MPS,
      MIN_PURE_PURSUIT_COAST_DEADBAND_MPS,
      MAX_PURE_PURSUIT_COAST_DEADBAND_MPS,
    ),

    arrivalDistanceMinMeters: normalizedArrivalMin,
    arrivalDistanceMaxMeters: normalizedArrivalMax,
    arrivalDistanceSpeedFactor: clampNumber(
      raw.arrivalDistanceSpeedFactor,
      DEFAULT_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR,
      MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR,
      MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR,
    ),
    brakeDistanceMinMeters: clampNumber(
      raw.brakeDistanceMinMeters,
      DEFAULT_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS,
      MIN_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS,
      MAX_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS,
    ),
    brakeDistanceSpeedFactor: clampNumber(
      raw.brakeDistanceSpeedFactor,
      DEFAULT_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR,
      MIN_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR,
      MAX_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR,
    ),

    dockingEnabled: clampBoolean(raw.dockingEnabled, DEFAULT_PURE_PURSUIT_DOCKING_ENABLED),
    dockStartDistanceMeters: clampNumber(
      raw.dockStartDistanceMeters,
      DEFAULT_PURE_PURSUIT_DOCK_START_DISTANCE_METERS,
      MIN_PURE_PURSUIT_DOCK_START_DISTANCE_METERS,
      MAX_PURE_PURSUIT_DOCK_START_DISTANCE_METERS,
    ),
    dockMaxSpeedMps: clampNumber(
      raw.dockMaxSpeedMps,
      DEFAULT_PURE_PURSUIT_DOCK_MAX_SPEED_MPS,
      MIN_PURE_PURSUIT_DOCK_MAX_SPEED_MPS,
      MAX_PURE_PURSUIT_DOCK_MAX_SPEED_MPS,
    ),
    dockVelocityKp: clampNumber(
      raw.dockVelocityKp,
      DEFAULT_PURE_PURSUIT_DOCK_VELOCITY_KP,
      MIN_PURE_PURSUIT_DOCK_VELOCITY_KP,
      MAX_PURE_PURSUIT_DOCK_VELOCITY_KP,
    ),
    dockYawEnabled: clampBoolean(raw.dockYawEnabled, DEFAULT_PURE_PURSUIT_DOCK_YAW_ENABLED),
    dockYawSlerpRate: clampNumber(
      raw.dockYawSlerpRate,
      DEFAULT_PURE_PURSUIT_DOCK_YAW_SLERP_RATE,
      MIN_PURE_PURSUIT_DOCK_YAW_SLERP_RATE,
      MAX_PURE_PURSUIT_DOCK_YAW_SLERP_RATE,
    ),
    dockStopEpsilonMeters: clampNumber(
      raw.dockStopEpsilonMeters,
      DEFAULT_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS,
      MIN_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS,
      MAX_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS,
    ),
    dockStopSpeedEpsilonMps: clampNumber(
      raw.dockStopSpeedEpsilonMps,
      DEFAULT_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS,
      MIN_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS,
      MAX_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS,
    ),
  }
}

export function clonePurePursuitComponentProps(props: PurePursuitComponentProps): PurePursuitComponentProps {
  return {
    lookaheadBaseMeters: props.lookaheadBaseMeters,
    lookaheadSpeedGain: props.lookaheadSpeedGain,
    lookaheadMinMeters: props.lookaheadMinMeters,
    lookaheadMaxMeters: props.lookaheadMaxMeters,
    speedKp: props.speedKp,
    speedKi: props.speedKi,
    speedIntegralMax: props.speedIntegralMax,
    minSpeedMps: props.minSpeedMps,
    curvatureSpeedFactor: props.curvatureSpeedFactor,
    coastDecelForceFactor: props.coastDecelForceFactor,
    coastDeadbandMps: props.coastDeadbandMps,

    arrivalDistanceMinMeters: props.arrivalDistanceMinMeters,
    arrivalDistanceMaxMeters: props.arrivalDistanceMaxMeters,
    arrivalDistanceSpeedFactor: props.arrivalDistanceSpeedFactor,
    brakeDistanceMinMeters: props.brakeDistanceMinMeters,
    brakeDistanceSpeedFactor: props.brakeDistanceSpeedFactor,

    dockingEnabled: props.dockingEnabled,
    dockStartDistanceMeters: props.dockStartDistanceMeters,
    dockMaxSpeedMps: props.dockMaxSpeedMps,
    dockVelocityKp: props.dockVelocityKp,
    dockYawEnabled: props.dockYawEnabled,
    dockYawSlerpRate: props.dockYawSlerpRate,
    dockStopEpsilonMeters: props.dockStopEpsilonMeters,
    dockStopSpeedEpsilonMps: props.dockStopSpeedEpsilonMps,
  }
}

class PurePursuitComponent extends Component<PurePursuitComponentProps> {
  constructor(context: ComponentRuntimeContext<PurePursuitComponentProps>) {
    super(context)
  }
}

const purePursuitComponentDefinition: ComponentDefinition<PurePursuitComponentProps> = {
  type: PURE_PURSUIT_COMPONENT_TYPE,
  label: 'Regulated Pursuit',
  icon: 'mdi-crosshairs-gps',
  order: 171,
  inspector: [
    {
      id: 'lookahead',
      label: 'Lookahead',
      fields: [
        { kind: 'number', key: 'lookaheadBaseMeters', label: 'Base Lookahead (m)', min: MIN_PURE_PURSUIT_LOOKAHEAD_BASE_METERS, max: MAX_PURE_PURSUIT_LOOKAHEAD_BASE_METERS, step: 0.1, precision: 2 },
        { kind: 'number', key: 'lookaheadSpeedGain', label: 'Speed Gain', min: MIN_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN, max: MAX_PURE_PURSUIT_LOOKAHEAD_SPEED_GAIN, step: 0.05, precision: 2 },
        { kind: 'number', key: 'lookaheadMinMeters', label: 'Min Lookahead (m)', min: MIN_PURE_PURSUIT_LOOKAHEAD_MIN_METERS, max: MAX_PURE_PURSUIT_LOOKAHEAD_MIN_METERS, step: 0.1, precision: 2 },
        { kind: 'number', key: 'lookaheadMaxMeters', label: 'Max Lookahead (m)', min: MIN_PURE_PURSUIT_LOOKAHEAD_MAX_METERS, max: MAX_PURE_PURSUIT_LOOKAHEAD_MAX_METERS, step: 0.1, precision: 2 },
      ],
    },
    {
      id: 'speed',
      label: 'Speed Control',
      fields: [
        { kind: 'number', key: 'minSpeedMps', label: 'Min Speed (m/s)', min: MIN_PURE_PURSUIT_MIN_SPEED_MPS, max: MAX_PURE_PURSUIT_MIN_SPEED_MPS, step: 0.1, precision: 2 },
        { kind: 'number', key: 'curvatureSpeedFactor', label: 'Curvature Slowdown', min: MIN_PURE_PURSUIT_CURVATURE_SPEED_FACTOR, max: MAX_PURE_PURSUIT_CURVATURE_SPEED_FACTOR, step: 0.05, precision: 2 },
        { kind: 'number', key: 'coastDecelForceFactor', label: 'Coast Decel Force', min: MIN_PURE_PURSUIT_COAST_DECEL_FORCE_FACTOR, max: MAX_PURE_PURSUIT_COAST_DECEL_FORCE_FACTOR, step: 0.01, precision: 2 },
        { kind: 'number', key: 'coastDeadbandMps', label: 'Coast Deadband (m/s)', min: MIN_PURE_PURSUIT_COAST_DEADBAND_MPS, max: MAX_PURE_PURSUIT_COAST_DEADBAND_MPS, step: 0.01, precision: 2 },
        { kind: 'number', key: 'speedKp', label: 'Speed Kp', min: MIN_PURE_PURSUIT_SPEED_KP, max: MAX_PURE_PURSUIT_SPEED_KP, step: 0.05, precision: 2 },
        { kind: 'number', key: 'speedKi', label: 'Speed Ki', min: MIN_PURE_PURSUIT_SPEED_KI, max: MAX_PURE_PURSUIT_SPEED_KI, step: 0.05, precision: 2 },
        { kind: 'number', key: 'speedIntegralMax', label: 'Integral Clamp', min: MIN_PURE_PURSUIT_SPEED_INTEGRAL_MAX, max: MAX_PURE_PURSUIT_SPEED_INTEGRAL_MAX, step: 0.1, precision: 2 },
      ],
    },
    {
      id: 'approach',
      label: 'Approach & Brake',
      fields: [
        { kind: 'number', key: 'arrivalDistanceMinMeters', label: 'Approach Min (m)', min: MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS, max: MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MIN_METERS, step: 0.05, precision: 2 },
        { kind: 'number', key: 'arrivalDistanceMaxMeters', label: 'Approach Max (m)', min: MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS, max: MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_MAX_METERS, step: 0.05, precision: 2 },
        { kind: 'number', key: 'arrivalDistanceSpeedFactor', label: 'Approach Speed Gain', min: MIN_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR, max: MAX_PURE_PURSUIT_ARRIVAL_DISTANCE_SPEED_FACTOR, step: 0.05, precision: 2 },
        { kind: 'number', key: 'brakeDistanceMinMeters', label: 'Brake Min (m)', min: MIN_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS, max: MAX_PURE_PURSUIT_BRAKE_DISTANCE_MIN_METERS, step: 0.05, precision: 2 },
        { kind: 'number', key: 'brakeDistanceSpeedFactor', label: 'Brake Speed Gain', min: MIN_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR, max: MAX_PURE_PURSUIT_BRAKE_DISTANCE_SPEED_FACTOR, step: 0.05, precision: 2 },
      ],
    },
    {
      id: 'docking',
      label: 'Docking',
      fields: [
        { kind: 'boolean', key: 'dockingEnabled', label: 'Docking Enabled' },
        { kind: 'number', key: 'dockStartDistanceMeters', label: 'Dock Start (m)', min: MIN_PURE_PURSUIT_DOCK_START_DISTANCE_METERS, max: MAX_PURE_PURSUIT_DOCK_START_DISTANCE_METERS, step: 0.05, precision: 2 },
        { kind: 'number', key: 'dockMaxSpeedMps', label: 'Dock Max Speed (m/s)', min: MIN_PURE_PURSUIT_DOCK_MAX_SPEED_MPS, max: MAX_PURE_PURSUIT_DOCK_MAX_SPEED_MPS, step: 0.05, precision: 2 },
        { kind: 'number', key: 'dockVelocityKp', label: 'Dock Velocity Kp', min: MIN_PURE_PURSUIT_DOCK_VELOCITY_KP, max: MAX_PURE_PURSUIT_DOCK_VELOCITY_KP, step: 0.05, precision: 2 },
        { kind: 'boolean', key: 'dockYawEnabled', label: 'Dock Yaw Enabled' },
        { kind: 'number', key: 'dockYawSlerpRate', label: 'Dock Yaw Rate', min: MIN_PURE_PURSUIT_DOCK_YAW_SLERP_RATE, max: MAX_PURE_PURSUIT_DOCK_YAW_SLERP_RATE, step: 0.1, precision: 2 },
        { kind: 'number', key: 'dockStopEpsilonMeters', label: 'Dock Stop Epsilon (m)', min: MIN_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS, max: MAX_PURE_PURSUIT_DOCK_STOP_EPSILON_METERS, step: 0.01, precision: 3 },
        { kind: 'number', key: 'dockStopSpeedEpsilonMps', label: 'Dock Stop Speed (m/s)', min: MIN_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS, max: MAX_PURE_PURSUIT_DOCK_STOP_SPEED_EPSILON_MPS, step: 0.01, precision: 3 },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType?.toLowerCase?.() ?? ''
    if (nodeType === 'light' || nodeType === 'environment') {
      return false
    }
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return clampPurePursuitComponentProps(null)
  },
  createInstance(context) {
    return new PurePursuitComponent(context)
  },
}

componentManager.registerDefinition(purePursuitComponentDefinition)

export function createPurePursuitComponentState(
  node: SceneNode,
  overrides?: Partial<PurePursuitComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<PurePursuitComponentProps> {
  const defaults = purePursuitComponentDefinition.createDefaultProps(node)
  const props = clampPurePursuitComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: PURE_PURSUIT_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { purePursuitComponentDefinition }
