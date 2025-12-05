import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const VEHICLE_COMPONENT_TYPE = 'vehicle'

export type VehicleVector3Tuple = [number, number, number]

export interface VehicleWheelProps {
  id: string
  nodeId: string | null
  radius: number
  suspensionRestLength: number
  suspensionStiffness: number
  dampingRelaxation: number
  dampingCompression: number
  frictionSlip: number
  maxSuspensionTravel: number
  maxSuspensionForce: number
  useCustomSlidingRotationalSpeed: boolean
  customSlidingRotationalSpeed: number
  isFrontWheel: boolean
  rollInfluence: number
  directionLocal: VehicleVector3Tuple
  axleLocal: VehicleVector3Tuple
}

export interface VehicleComponentProps {
  indexRightAxis: number
  indexUpAxis: number
  indexForwardAxis: number
  wheels: VehicleWheelProps[]
}

export const DEFAULT_RIGHT_AXIS = 0
export const DEFAULT_UP_AXIS = 1
export const DEFAULT_FORWARD_AXIS = 2
export const DEFAULT_RADIUS = 0.5
export const DEFAULT_DIRECTION: VehicleVector3Tuple = [0, -1, 0]
export const DEFAULT_AXLE: VehicleVector3Tuple = [-1, 0, 0]
export const DEFAULT_SUSPENSION_REST_LENGTH = 0.3
export const DEFAULT_SUSPENSION_STIFFNESS = 25000
export const DEFAULT_DAMPING_RELAXATION = 2.3
export const DEFAULT_DAMPING_COMPRESSION = 4.5
export const DEFAULT_FRICTION_SLIP = 3.0
export const DEFAULT_ROLL_INFLUENCE = 0.01
export const DEFAULT_MAX_SUSPENSION_TRAVEL = 0.4
export const DEFAULT_MAX_SUSPENSION_FORCE = 100000
export const DEFAULT_USE_CUSTOM_SLIDING_ROTATIONAL_SPEED = false
export const DEFAULT_CUSTOM_SLIDING_ROTATIONAL_SPEED = -30
export const DEFAULT_IS_FRONT_WHEEL = true
export const DEFAULT_WHEEL_TEMPLATE: Omit<VehicleWheelProps, 'id'> = {
  nodeId: null,
  radius: DEFAULT_RADIUS,
  suspensionRestLength: DEFAULT_SUSPENSION_REST_LENGTH,
  suspensionStiffness: DEFAULT_SUSPENSION_STIFFNESS,
  dampingRelaxation: DEFAULT_DAMPING_RELAXATION,
  dampingCompression: DEFAULT_DAMPING_COMPRESSION,
  frictionSlip: DEFAULT_FRICTION_SLIP,
  maxSuspensionTravel: DEFAULT_MAX_SUSPENSION_TRAVEL,
  maxSuspensionForce: DEFAULT_MAX_SUSPENSION_FORCE,
  useCustomSlidingRotationalSpeed: DEFAULT_USE_CUSTOM_SLIDING_ROTATIONAL_SPEED,
  customSlidingRotationalSpeed: DEFAULT_CUSTOM_SLIDING_ROTATIONAL_SPEED,
  isFrontWheel: DEFAULT_IS_FRONT_WHEEL,
  rollInfluence: DEFAULT_ROLL_INFLUENCE,
  directionLocal: DEFAULT_DIRECTION,
  axleLocal: DEFAULT_AXLE,
}

function clampAxisIndex(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const normalized = Math.round(value)
  if (normalized < 0 || normalized > 2) {
    return fallback
  }
  return normalized
}

function clampPositive(value: unknown, fallback: number, options: { min?: number } = {}): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  const { min = 0 } = options
  if (numeric < min) {
    return min
  }
  return numeric
}

function clampNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return numeric
}

function clampVectorTuple(value: unknown, fallback: VehicleVector3Tuple): VehicleVector3Tuple {
  if (Array.isArray(value) && value.length === 3) {
    return value.map((entry, index) => (typeof entry === 'number' && Number.isFinite(entry) ? entry : fallback[index])) as VehicleVector3Tuple
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return [record.x, record.y, record.z].map((entry, index) => (
      typeof entry === 'number' && Number.isFinite(entry) ? entry : fallback[index]
    )) as VehicleVector3Tuple
  }
  return [...fallback]
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }
  return fallback
}

type LegacyWheelProps = {
  radius?: unknown
  suspensionRestLength?: unknown
  suspensionStiffness?: unknown
  suspensionDamping?: unknown
  suspensionCompression?: unknown
  dampingRelaxation?: unknown
  dampingCompression?: unknown
  frictionSlip?: unknown
  rollInfluence?: unknown
  maxSuspensionTravel?: unknown
  maxSuspensionForce?: unknown
  useCustomSlidingRotationalSpeed?: unknown
  customSlidingRotationalSpeed?: unknown
  isFrontWheel?: unknown
}

type LegacyComponentVectors = {
  directionLocal?: unknown
  axleLocal?: unknown
}

type VehicleComponentPropsInput = (Partial<VehicleComponentProps> & LegacyWheelProps & LegacyComponentVectors) | null | undefined

type VehicleWheelEntryInput = (Partial<VehicleWheelProps> & LegacyWheelProps) | null | undefined

function clampWheelNodeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function clampWheelEntry(
  entry: VehicleWheelEntryInput,
  template: Omit<VehicleWheelProps, 'id'>,
): VehicleWheelProps {
  const source = (entry ?? {}) as VehicleWheelEntryInput & LegacyWheelProps
  const provisionalId = typeof source.id === 'string' ? source.id.trim() : ''
  const dampingRelaxationSource = source.dampingRelaxation ?? source.suspensionDamping
  const dampingCompressionSource = source.dampingCompression ?? source.suspensionCompression
  return {
    id: provisionalId,
    nodeId: clampWheelNodeId(source.nodeId),
    radius: clampPositive(source.radius, template.radius, { min: 0.01 }),
    suspensionRestLength: clampPositive(source.suspensionRestLength, template.suspensionRestLength, { min: 0 }),
    suspensionStiffness: clampPositive(source.suspensionStiffness, template.suspensionStiffness, { min: 0 }),
    dampingRelaxation: clampPositive(dampingRelaxationSource, template.dampingRelaxation, { min: 0 }),
    dampingCompression: clampPositive(dampingCompressionSource, template.dampingCompression, { min: 0 }),
    frictionSlip: clampPositive(source.frictionSlip, template.frictionSlip, { min: 0 }),
    maxSuspensionTravel: clampPositive(source.maxSuspensionTravel, template.maxSuspensionTravel, { min: 0 }),
    maxSuspensionForce: clampPositive(source.maxSuspensionForce, template.maxSuspensionForce, { min: 0 }),
    useCustomSlidingRotationalSpeed: clampBoolean(
      source.useCustomSlidingRotationalSpeed,
      template.useCustomSlidingRotationalSpeed,
    ),
    customSlidingRotationalSpeed: clampNumber(
      source.customSlidingRotationalSpeed,
      template.customSlidingRotationalSpeed,
    ),
    isFrontWheel: clampBoolean(source.isFrontWheel, template.isFrontWheel),
    rollInfluence: clampPositive(source.rollInfluence, template.rollInfluence, { min: 0 }),
    directionLocal: clampVectorTuple(source.directionLocal, template.directionLocal),
    axleLocal: clampVectorTuple(source.axleLocal, template.axleLocal),
  }
}

function ensureWheelIds(wheels: VehicleWheelProps[]): VehicleWheelProps[] {
  const used = new Set<string>()
  return wheels.map((wheel, index) => {
    let baseId = wheel.id && wheel.id.trim().length ? wheel.id.trim() : `wheel-${index + 1}`
    let candidate = baseId
    let suffix = 1
    while (used.has(candidate)) {
      candidate = `${baseId}-${suffix}`
      suffix += 1
    }
    used.add(candidate)
    return { ...wheel, id: candidate }
  })
}

function resolveLegacyWheelTemplate(
  props: LegacyWheelProps | null | undefined,
  vectors: { directionLocal: VehicleVector3Tuple; axleLocal: VehicleVector3Tuple },
): Omit<VehicleWheelProps, 'id'> {
  return {
    ...DEFAULT_WHEEL_TEMPLATE,
    radius: clampPositive(props?.radius, DEFAULT_RADIUS, { min: 0.01 }),
    suspensionRestLength: clampPositive(props?.suspensionRestLength, DEFAULT_SUSPENSION_REST_LENGTH, { min: 0 }),
    suspensionStiffness: clampPositive(props?.suspensionStiffness, DEFAULT_SUSPENSION_STIFFNESS, { min: 0 }),
    dampingRelaxation: clampPositive(
      props?.dampingRelaxation ?? props?.suspensionDamping,
      DEFAULT_DAMPING_RELAXATION,
      { min: 0 },
    ),
    dampingCompression: clampPositive(
      props?.dampingCompression ?? props?.suspensionCompression,
      DEFAULT_DAMPING_COMPRESSION,
      { min: 0 },
    ),
    frictionSlip: clampPositive(props?.frictionSlip, DEFAULT_FRICTION_SLIP, { min: 0 }),
    maxSuspensionTravel: clampPositive(props?.maxSuspensionTravel, DEFAULT_MAX_SUSPENSION_TRAVEL, { min: 0 }),
    maxSuspensionForce: clampPositive(props?.maxSuspensionForce, DEFAULT_MAX_SUSPENSION_FORCE, { min: 0 }),
    useCustomSlidingRotationalSpeed: clampBoolean(
      props?.useCustomSlidingRotationalSpeed,
      DEFAULT_USE_CUSTOM_SLIDING_ROTATIONAL_SPEED,
    ),
    customSlidingRotationalSpeed: clampNumber(
      props?.customSlidingRotationalSpeed,
      DEFAULT_CUSTOM_SLIDING_ROTATIONAL_SPEED,
    ),
    isFrontWheel: clampBoolean(props?.isFrontWheel, DEFAULT_IS_FRONT_WHEEL),
    rollInfluence: clampPositive(props?.rollInfluence, DEFAULT_ROLL_INFLUENCE, { min: 0 }),
    directionLocal: vectors.directionLocal,
    axleLocal: vectors.axleLocal,
  }
}

function clampWheelList(
  value: unknown,
  template: Omit<VehicleWheelProps, 'id'>,
): VehicleWheelProps[] {
  const entries = Array.isArray(value) ? value : []
  const normalized = entries.map((entry) => clampWheelEntry(entry as VehicleWheelEntryInput, template))
  return ensureWheelIds(normalized)
}

export function clampVehicleComponentProps(
  props: VehicleComponentPropsInput,
): VehicleComponentProps {
  const legacyVectors = {
    directionLocal: clampVectorTuple(props?.directionLocal, DEFAULT_DIRECTION),
    axleLocal: clampVectorTuple(props?.axleLocal, DEFAULT_AXLE),
  }
  const wheelTemplate = resolveLegacyWheelTemplate(props ?? null, legacyVectors)
  return {
    indexRightAxis: clampAxisIndex(props?.indexRightAxis, DEFAULT_RIGHT_AXIS),
    indexUpAxis: clampAxisIndex(props?.indexUpAxis, DEFAULT_UP_AXIS),
    indexForwardAxis: clampAxisIndex(props?.indexForwardAxis, DEFAULT_FORWARD_AXIS),
    wheels: clampWheelList(props?.wheels, wheelTemplate),
  }
}

export function cloneVehicleComponentProps(props: VehicleComponentProps): VehicleComponentProps {
  return {
    indexRightAxis: props.indexRightAxis,
    indexUpAxis: props.indexUpAxis,
    indexForwardAxis: props.indexForwardAxis,
    wheels: props.wheels.map((wheel) => ({
      id: wheel.id,
      nodeId: wheel.nodeId ?? null,
      radius: wheel.radius,
      suspensionRestLength: wheel.suspensionRestLength,
      suspensionStiffness: wheel.suspensionStiffness,
      dampingRelaxation: wheel.dampingRelaxation,
      dampingCompression: wheel.dampingCompression,
      frictionSlip: wheel.frictionSlip,
      maxSuspensionTravel: wheel.maxSuspensionTravel,
      maxSuspensionForce: wheel.maxSuspensionForce,
      useCustomSlidingRotationalSpeed: wheel.useCustomSlidingRotationalSpeed,
      customSlidingRotationalSpeed: wheel.customSlidingRotationalSpeed,
      isFrontWheel: wheel.isFrontWheel,
      rollInfluence: wheel.rollInfluence,
      directionLocal: [...wheel.directionLocal] as VehicleVector3Tuple,
      axleLocal: [...wheel.axleLocal] as VehicleVector3Tuple,
    })),
  }
}

class VehicleComponent extends Component<VehicleComponentProps> {
  constructor(context: ComponentRuntimeContext<VehicleComponentProps>) {
    super(context)
  }
}

const vehicleComponentDefinition: ComponentDefinition<VehicleComponentProps> = {
  type: VEHICLE_COMPONENT_TYPE,
  label: 'Vehicle',
  icon: 'mdi-car-sports',
  order: 155,
  inspector: [
    {
      id: 'raycast',
      label: 'Raycast',
      fields: [
        { kind: 'number', key: 'indexRightAxis', label: 'Right Axis', min: 0, max: 2, step: 1, precision: 0 },
        { kind: 'number', key: 'indexUpAxis', label: 'Up Axis', min: 0, max: 2, step: 1, precision: 0 },
        { kind: 'number', key: 'indexForwardAxis', label: 'Forward Axis', min: 0, max: 2, step: 1, precision: 0 },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType?.toLowerCase?.() ?? ''
    return nodeType !== 'light' && nodeType !== 'sky' && nodeType !== 'environment'
  },
  createDefaultProps(_node: SceneNode) {
    return clampVehicleComponentProps(null)
  },
  createInstance(context) {
    return new VehicleComponent(context)
  },
}

componentManager.registerDefinition(vehicleComponentDefinition)

export function createVehicleComponentState(
  node: SceneNode,
  overrides?: Partial<VehicleComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<VehicleComponentProps> {
  const defaults = vehicleComponentDefinition.createDefaultProps(node)
  const props = clampVehicleComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: VEHICLE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { vehicleComponentDefinition }
