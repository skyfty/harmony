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
  suspensionDamping: number
  suspensionCompression: number
  frictionSlip: number
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
const DEFAULT_WHEEL_COUNT = 4
const DEFAULT_WHEEL_TEMPLATE: Omit<VehicleWheelProps, 'id'> = {
  nodeId: null,
  radius: DEFAULT_RADIUS,
  suspensionRestLength: DEFAULT_SUSPENSION_REST_LENGTH,
  suspensionStiffness: DEFAULT_SUSPENSION_STIFFNESS,
  suspensionDamping: DEFAULT_SUSPENSION_DAMPING,
  suspensionCompression: DEFAULT_SUSPENSION_COMPRESSION,
  frictionSlip: DEFAULT_FRICTION_SLIP,
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

type LegacyWheelProps = {
  radius?: unknown
  suspensionRestLength?: unknown
  suspensionStiffness?: unknown
  suspensionDamping?: unknown
  suspensionCompression?: unknown
  frictionSlip?: unknown
  rollInfluence?: unknown
}

type LegacyComponentVectors = {
  directionLocal?: unknown
  axleLocal?: unknown
}

type VehicleComponentPropsInput = (Partial<VehicleComponentProps> & LegacyWheelProps & LegacyComponentVectors) | null | undefined

function clampWheelNodeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function buildDefaultWheelList(template: Omit<VehicleWheelProps, 'id'>, count = DEFAULT_WHEEL_COUNT): VehicleWheelProps[] {
  return Array.from({ length: Math.max(1, count) }, (_value, index) => ({
    id: `wheel-${index + 1}`,
    ...template,
  }))
}

function clampWheelEntry(
  entry: Partial<VehicleWheelProps> | null | undefined,
  template: Omit<VehicleWheelProps, 'id'>,
): VehicleWheelProps {
  const source = entry ?? {}
  const provisionalId = typeof source.id === 'string' ? source.id.trim() : ''
  return {
    id: provisionalId,
    nodeId: clampWheelNodeId(source.nodeId),
    radius: clampPositive(source.radius, template.radius, { min: 0.01 }),
    suspensionRestLength: clampPositive(source.suspensionRestLength, template.suspensionRestLength, { min: 0 }),
    suspensionStiffness: clampPositive(source.suspensionStiffness, template.suspensionStiffness, { min: 0 }),
    suspensionDamping: clampPositive(source.suspensionDamping, template.suspensionDamping, { min: 0 }),
    suspensionCompression: clampPositive(source.suspensionCompression, template.suspensionCompression, { min: 0 }),
    frictionSlip: clampPositive(source.frictionSlip, template.frictionSlip, { min: 0 }),
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
    suspensionDamping: clampPositive(props?.suspensionDamping, DEFAULT_SUSPENSION_DAMPING, { min: 0 }),
    suspensionCompression: clampPositive(props?.suspensionCompression, DEFAULT_SUSPENSION_COMPRESSION, { min: 0 }),
    frictionSlip: clampPositive(props?.frictionSlip, DEFAULT_FRICTION_SLIP, { min: 0 }),
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
  const normalized = entries.map((entry) => clampWheelEntry(entry as Partial<VehicleWheelProps>, template))
  const list = normalized.length ? normalized : buildDefaultWheelList(template)
  return ensureWheelIds(list)
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
      suspensionDamping: wheel.suspensionDamping,
      suspensionCompression: wheel.suspensionCompression,
      frictionSlip: wheel.frictionSlip,
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
