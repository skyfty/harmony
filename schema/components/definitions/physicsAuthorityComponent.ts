import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const PHYSICS_AUTHORITY_COMPONENT_TYPE = 'physicsAuthority'

export type PhysicsAuthorityActorType = 'auto' | 'vehicle' | 'character'

export interface PhysicsAuthorityComponentProps {
  enabled: boolean
  actorType: PhysicsAuthorityActorType
  allowClientPrediction: boolean
  inputSendIntervalMs: number | null
  snapshotLerpMs: number
  snapThreshold: number
  inputLeaseMs: number
  syncLinearVelocity: boolean
  syncAngularVelocity: boolean
  syncSleeping: boolean
}

const DEFAULT_PROPS: PhysicsAuthorityComponentProps = {
  enabled: true,
  actorType: 'auto',
  allowClientPrediction: true,
  inputSendIntervalMs: 33,
  snapshotLerpMs: 120,
  snapThreshold: 1.5,
  inputLeaseMs: 3000,
  syncLinearVelocity: true,
  syncAngularVelocity: true,
  syncSleeping: true,
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

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

function clampNullableInteger(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }
  return Math.round(Math.min(max, Math.max(min, numeric)))
}

function clampActorType(value: unknown): PhysicsAuthorityActorType {
  return value === 'vehicle' || value === 'character' ? value : 'auto'
}

export function clampPhysicsAuthorityComponentProps(
  props: Partial<PhysicsAuthorityComponentProps> | null | undefined,
): PhysicsAuthorityComponentProps {
  return {
    enabled: clampBoolean(props?.enabled, DEFAULT_PROPS.enabled),
    actorType: clampActorType(props?.actorType),
    allowClientPrediction: clampBoolean(props?.allowClientPrediction, DEFAULT_PROPS.allowClientPrediction),
    inputSendIntervalMs: clampNullableInteger(props?.inputSendIntervalMs, 16, 5000),
    snapshotLerpMs: clampNumber(props?.snapshotLerpMs, DEFAULT_PROPS.snapshotLerpMs, 16, 5000),
    snapThreshold: clampNumber(props?.snapThreshold, DEFAULT_PROPS.snapThreshold, 0.01, 1000),
    inputLeaseMs: clampNumber(props?.inputLeaseMs, DEFAULT_PROPS.inputLeaseMs, 250, 30000),
    syncLinearVelocity: clampBoolean(props?.syncLinearVelocity, DEFAULT_PROPS.syncLinearVelocity),
    syncAngularVelocity: clampBoolean(props?.syncAngularVelocity, DEFAULT_PROPS.syncAngularVelocity),
    syncSleeping: clampBoolean(props?.syncSleeping, DEFAULT_PROPS.syncSleeping),
  }
}

class PhysicsAuthorityComponent extends Component<PhysicsAuthorityComponentProps> {
  constructor(context: ComponentRuntimeContext<PhysicsAuthorityComponentProps>) {
    super(context)
  }
}

const physicsAuthorityComponentDefinition: ComponentDefinition<PhysicsAuthorityComponentProps> = {
  type: PHYSICS_AUTHORITY_COMPONENT_TYPE,
  label: 'Physics Authority',
  icon: 'mdi-physics',
  order: 302,
  inspector: [
    {
      id: 'authority',
      label: 'Authority',
      fields: [
        { kind: 'boolean', key: 'enabled', label: 'Enabled' },
        { kind: 'select', key: 'actorType', label: 'Actor Type', options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Vehicle', value: 'vehicle' },
          { label: 'Character', value: 'character' },
        ] },
        { kind: 'boolean', key: 'allowClientPrediction', label: 'Client Prediction' },
        { kind: 'number', key: 'inputSendIntervalMs', label: 'Input Interval (ms)', min: 16, max: 5000, step: 16 },
        { kind: 'number', key: 'snapshotLerpMs', label: 'Snapshot Lerp (ms)', min: 16, max: 5000, step: 16 },
        { kind: 'number', key: 'snapThreshold', label: 'Snap Threshold', min: 0.01, max: 1000, step: 0.05 },
        { kind: 'number', key: 'inputLeaseMs', label: 'Lease (ms)', min: 250, max: 30000, step: 50 },
        { kind: 'boolean', key: 'syncLinearVelocity', label: 'Sync Linear Velocity' },
        { kind: 'boolean', key: 'syncAngularVelocity', label: 'Sync Angular Velocity' },
        { kind: 'boolean', key: 'syncSleeping', label: 'Sync Sleeping' },
      ],
    },
  ],
  canAttach(node: SceneNode): boolean {
    const nodeType = node.nodeType?.toLowerCase?.() ?? ''
    return nodeType !== 'light' && nodeType !== 'environment'
  },
  createDefaultProps(): PhysicsAuthorityComponentProps {
    return { ...DEFAULT_PROPS }
  },
  createInstance(context) {
    return new PhysicsAuthorityComponent(context)
  },
}

componentManager.registerDefinition(physicsAuthorityComponentDefinition)

export function createPhysicsAuthorityComponentState(
  _node: SceneNode,
  overrides?: Partial<PhysicsAuthorityComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<PhysicsAuthorityComponentProps> {
  const props = clampPhysicsAuthorityComponentProps({ ...DEFAULT_PROPS, ...overrides })
  return {
    id: options.id ?? '',
    type: PHYSICS_AUTHORITY_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { physicsAuthorityComponentDefinition }
