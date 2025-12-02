import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const VEHICLE_COMPONENT_TYPE = 'vehicle'

export type VehicleVector3Tuple = [number, number, number]

export interface VehicleComponentProps {
  indexRightAxis: number
  indexUpAxis: number
  indexForwardAxis: number
  radius: number
  directionLocal: VehicleVector3Tuple
  axleLocal: VehicleVector3Tuple
  suspensionRestLength: number
  suspensionStiffness: number
  suspensionDamping: number
  suspensionCompression: number
  frictionSlip: number
  rollInfluence: number
}

const DEFAULT_RIGHT_AXIS = 0
const DEFAULT_UP_AXIS = 1
const DEFAULT_FORWARD_AXIS = 2
const DEFAULT_RADIUS = 0.5
const DEFAULT_DIRECTION: VehicleVector3Tuple = [0, -1, 0]
const DEFAULT_AXLE: VehicleVector3Tuple = [1, 0, 0]
const DEFAULT_SUSPENSION_REST_LENGTH = 0.3
const DEFAULT_SUSPENSION_STIFFNESS = 20
const DEFAULT_SUSPENSION_DAMPING = 2
const DEFAULT_SUSPENSION_COMPRESSION = 4
const DEFAULT_FRICTION_SLIP = 5
const DEFAULT_ROLL_INFLUENCE = 0.01

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

export function clampVehicleComponentProps(
  props: Partial<VehicleComponentProps> | null | undefined,
): VehicleComponentProps {
  return {
    indexRightAxis: clampAxisIndex(props?.indexRightAxis, DEFAULT_RIGHT_AXIS),
    indexUpAxis: clampAxisIndex(props?.indexUpAxis, DEFAULT_UP_AXIS),
    indexForwardAxis: clampAxisIndex(props?.indexForwardAxis, DEFAULT_FORWARD_AXIS),
    radius: clampPositive(props?.radius, DEFAULT_RADIUS, { min: 0.01 }),
    directionLocal: clampVectorTuple(props?.directionLocal, DEFAULT_DIRECTION),
    axleLocal: clampVectorTuple(props?.axleLocal, DEFAULT_AXLE),
    suspensionRestLength: clampPositive(props?.suspensionRestLength, DEFAULT_SUSPENSION_REST_LENGTH, { min: 0 }),
    suspensionStiffness: clampPositive(props?.suspensionStiffness, DEFAULT_SUSPENSION_STIFFNESS, { min: 0 }),
    suspensionDamping: clampPositive(props?.suspensionDamping, DEFAULT_SUSPENSION_DAMPING, { min: 0 }),
    suspensionCompression: clampPositive(props?.suspensionCompression, DEFAULT_SUSPENSION_COMPRESSION, { min: 0 }),
    frictionSlip: clampPositive(props?.frictionSlip, DEFAULT_FRICTION_SLIP, { min: 0 }),
    rollInfluence: clampPositive(props?.rollInfluence, DEFAULT_ROLL_INFLUENCE, { min: 0 }),
  }
}

export function cloneVehicleComponentProps(props: VehicleComponentProps): VehicleComponentProps {
  return {
    indexRightAxis: props.indexRightAxis,
    indexUpAxis: props.indexUpAxis,
    indexForwardAxis: props.indexForwardAxis,
    radius: props.radius,
    directionLocal: [...props.directionLocal] as VehicleVector3Tuple,
    axleLocal: [...props.axleLocal] as VehicleVector3Tuple,
    suspensionRestLength: props.suspensionRestLength,
    suspensionStiffness: props.suspensionStiffness,
    suspensionDamping: props.suspensionDamping,
    suspensionCompression: props.suspensionCompression,
    frictionSlip: props.frictionSlip,
    rollInfluence: props.rollInfluence,
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
    {
      id: 'wheel-info',
      label: 'Wheel Info',
      fields: [
        { kind: 'number', key: 'radius', label: 'Radius (m)', min: 0.01, step: 0.05 },
        { kind: 'number', key: 'suspensionRestLength', label: 'Suspension Rest (m)', min: 0, step: 0.01 },
        { kind: 'number', key: 'suspensionStiffness', label: 'Suspension Stiffness', min: 0, step: 1 },
        { kind: 'number', key: 'suspensionDamping', label: 'Damping', min: 0, step: 0.1 },
        { kind: 'number', key: 'suspensionCompression', label: 'Compression', min: 0, step: 0.1 },
        { kind: 'number', key: 'frictionSlip', label: 'Friction Slip', min: 0, step: 0.1 },
        { kind: 'number', key: 'rollInfluence', label: 'Roll Influence', min: 0, step: 0.001 },
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
