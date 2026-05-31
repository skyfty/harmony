import type { SceneNode, SceneNodeComponentState } from '../../index'
import { MULTIUSER_NODE_ID } from '../../core'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const NETWORK_SYNC_COMPONENT_TYPE = 'networkSync'
export const NETWORK_SYNC_MODE = 'transform' as const
export const NETWORK_SYNC_OWNERSHIP_MODE = 'lease' as const

export interface NetworkSyncComponentProps {
  enabled: boolean
  mode: 'transform'
  syncPosition: boolean
  syncRotation: boolean
  syncScale: boolean
  ownership: 'lease'
  leaseMs: number
  sendIntervalMs: number | null
  teleportThreshold: number
  syncPhysics: boolean
}

const DEFAULT_LEASE_MS = 3000
const DEFAULT_TELEPORT_THRESHOLD = 2

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
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
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

export function clampNetworkSyncComponentProps(
  props: Partial<NetworkSyncComponentProps> | null | undefined,
): NetworkSyncComponentProps {
  return {
    enabled: clampBoolean(props?.enabled, true),
    mode: NETWORK_SYNC_MODE,
    syncPosition: clampBoolean(props?.syncPosition, true),
    syncRotation: clampBoolean(props?.syncRotation, true),
    syncScale: clampBoolean(props?.syncScale, false),
    ownership: NETWORK_SYNC_OWNERSHIP_MODE,
    leaseMs: Math.round(clampNumber(props?.leaseMs, DEFAULT_LEASE_MS, 250, 30000)),
    sendIntervalMs: clampNullableInteger(props?.sendIntervalMs, 33, 5000),
    teleportThreshold: clampNumber(props?.teleportThreshold, DEFAULT_TELEPORT_THRESHOLD, 0.05, 1000),
    syncPhysics: false,
  }
}

class NetworkSyncComponent extends Component<NetworkSyncComponentProps> {
  constructor(context: ComponentRuntimeContext<NetworkSyncComponentProps>) {
    super(context)
  }
}

const networkSyncComponentDefinition: ComponentDefinition<NetworkSyncComponentProps> = {
  type: NETWORK_SYNC_COMPONENT_TYPE,
  label: 'Network Sync',
  icon: 'mdi-lan-connect',
  order: 301,
  inspector: [
    {
      id: 'network-sync',
      label: 'Network Sync',
      fields: [
        { kind: 'boolean', key: 'enabled', label: 'Enabled' },
        { kind: 'boolean', key: 'syncPosition', label: 'Sync Position' },
        { kind: 'boolean', key: 'syncRotation', label: 'Sync Rotation' },
        { kind: 'boolean', key: 'syncScale', label: 'Sync Scale' },
        { kind: 'number', key: 'leaseMs', label: 'Lease (ms)', min: 250, max: 30000, step: 50 },
        { kind: 'number', key: 'sendIntervalMs', label: 'Send Interval (ms)', min: 33, max: 5000, step: 33 },
        { kind: 'number', key: 'teleportThreshold', label: 'Teleport Threshold', min: 0.05, max: 1000, step: 0.05 },
      ],
    },
  ],
  canAttach(node: SceneNode): boolean {
    if (!node || node.id === MULTIUSER_NODE_ID) {
      return false
    }
    const nodeType = node.nodeType?.toLowerCase?.() ?? ''
    return nodeType !== 'light' && nodeType !== 'environment'
  },
  createDefaultProps(): NetworkSyncComponentProps {
    return clampNetworkSyncComponentProps(null)
  },
  createInstance(context) {
    return new NetworkSyncComponent(context)
  },
}

componentManager.registerDefinition(networkSyncComponentDefinition)

export function createNetworkSyncComponentState(
  node: SceneNode,
  overrides?: Partial<NetworkSyncComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<NetworkSyncComponentProps> {
  const defaults = networkSyncComponentDefinition.createDefaultProps(node)
  const props = clampNetworkSyncComponentProps({ ...defaults, ...overrides })
  return {
    id: options.id ?? '',
    type: NETWORK_SYNC_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { networkSyncComponentDefinition }
