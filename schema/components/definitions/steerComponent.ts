import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import { VEHICLE_COMPONENT_TYPE, type VehicleComponentProps } from './vehicleComponent'

export const STEER_COMPONENT_TYPE = 'steer'

export interface SteerComponentEntry {
  id: string
  key: string
  nodeId: string | null
}

export interface SteerComponentProps {
  entries: SteerComponentEntry[]
  defaultEntryId: string | null
}

export interface SteerResolvedEntry extends SteerComponentEntry {
  ownerNodeId: string
  targetNode: SceneNode
  vehicleComponent: SceneNodeComponentState<VehicleComponentProps>
}

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function sanitizeNodeId(value: unknown): string | null {
  const trimmed = sanitizeString(value)
  return trimmed.length ? trimmed : null
}

function cloneEntry(entry: SteerComponentEntry): SteerComponentEntry {
  return {
    id: sanitizeString(entry.id),
    key: sanitizeString(entry.key),
    nodeId: sanitizeNodeId(entry.nodeId),
  }
}

function sanitizeDefaultEntryId(value: unknown): string | null {
  return sanitizeNodeId(value)
}

function visitSceneNodes(nodes: SceneNode[] | undefined, visit: (node: SceneNode) => void): void {
  if (!nodes?.length) {
    return
  }
  nodes.forEach((node) => {
    visit(node)
    if (node.children?.length) {
      visitSceneNodes(node.children, visit)
    }
  })
}

function buildSceneNodeMap(nodes: SceneNode[] | undefined): Map<string, SceneNode> {
  const map = new Map<string, SceneNode>()
  visitSceneNodes(nodes, (node) => {
    if (node?.id) {
      map.set(node.id, node)
    }
  })
  return map
}

function resolveVehicleComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<VehicleComponentProps> | null {
  const component = node?.components?.[VEHICLE_COMPONENT_TYPE] as
    | SceneNodeComponentState<VehicleComponentProps>
    | undefined
  if (!component?.enabled) {
    return null
  }
  return component
}

export function clampSteerComponentProps(
  props: Partial<SteerComponentProps> | null | undefined,
): SteerComponentProps {
  const source = Array.isArray(props?.entries) ? props.entries : []
  const entries = source.map((entry) => {
    const record = entry && typeof entry === 'object'
      ? (entry as Partial<SteerComponentEntry>)
      : {}
    return {
      id: sanitizeString(record.id),
      key: sanitizeString(record.key),
      nodeId: sanitizeNodeId(record.nodeId),
    }
  })
  const defaultEntryId = sanitizeDefaultEntryId(props?.defaultEntryId)
  return {
    entries,
    defaultEntryId: defaultEntryId && entries.some((entry) => entry.id === defaultEntryId)
      ? defaultEntryId
      : null,
  }
}

export function cloneSteerComponentProps(props: SteerComponentProps): SteerComponentProps {
  return {
    entries: Array.isArray(props.entries) ? props.entries.map(cloneEntry) : [],
    defaultEntryId: sanitizeDefaultEntryId(props.defaultEntryId),
  }
}

export function collectSteerResolvedEntries(nodes: SceneNode[] | undefined): SteerResolvedEntry[] {
  if (!nodes?.length) {
    return []
  }
  const nodeMap = buildSceneNodeMap(nodes)
  const resolved: SteerResolvedEntry[] = []
  visitSceneNodes(nodes, (node) => {
    const component = node.components?.[STEER_COMPONENT_TYPE] as
      | SceneNodeComponentState<SteerComponentProps>
      | undefined
    if (!component?.enabled) {
      return
    }
    const props = clampSteerComponentProps(component.props)
    props.entries.forEach((entry) => {
      if (!entry.key || !entry.nodeId) {
        return
      }
      const targetNode = nodeMap.get(entry.nodeId)
      const vehicleComponent = resolveVehicleComponent(targetNode)
      if (!targetNode || !vehicleComponent) {
        return
      }
      resolved.push({
        ...cloneEntry(entry),
        ownerNodeId: node.id,
        targetNode,
        vehicleComponent,
      })
    })
  })
  return resolved
}

export function buildSteerResolvedEntryMap(nodes: SceneNode[] | undefined): Map<string, SteerResolvedEntry[]> {
  const map = new Map<string, SteerResolvedEntry[]>()
  collectSteerResolvedEntries(nodes).forEach((entry) => {
    const bucket = map.get(entry.key)
    if (bucket) {
      bucket.push(entry)
      return
    }
    map.set(entry.key, [entry])
  })
  return map
}

export function findDefaultSteerResolvedEntry(nodes: SceneNode[] | undefined): SteerResolvedEntry | null {
  if (!nodes?.length) {
    return null
  }
  const nodeMap = buildSceneNodeMap(nodes)
  let resolvedEntry: SteerResolvedEntry | null = null
  visitSceneNodes(nodes, (node) => {
    if (resolvedEntry) {
      return
    }
    const component = node.components?.[STEER_COMPONENT_TYPE] as
      | SceneNodeComponentState<SteerComponentProps>
      | undefined
    if (!component?.enabled) {
      return
    }
    const props = clampSteerComponentProps(component.props)
    if (!props.defaultEntryId) {
      return
    }
    const entry = props.entries.find((candidate) => candidate.id === props.defaultEntryId)
    if (!entry?.nodeId) {
      return
    }
    const targetNode = nodeMap.get(entry.nodeId)
    const vehicleComponent = resolveVehicleComponent(targetNode)
    if (!targetNode || !vehicleComponent) {
      return
    }
    resolvedEntry = {
      ...cloneEntry(entry),
      ownerNodeId: node.id,
      targetNode,
      vehicleComponent,
    }
  })
  return resolvedEntry
}

class SteerComponent extends Component<SteerComponentProps> {
  constructor(context: ComponentRuntimeContext<SteerComponentProps>) {
    super(context)
  }
}

const steerComponentDefinition: ComponentDefinition<SteerComponentProps> = {
  type: STEER_COMPONENT_TYPE,
  label: 'Steer',
  icon: 'mdi-steering',
  order: 176,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return { entries: [], defaultEntryId: null }
  },
  createInstance(context) {
    return new SteerComponent(context)
  },
}

componentManager.registerDefinition(steerComponentDefinition)

export function createSteerComponentState(
  node: SceneNode,
  overrides?: Partial<SteerComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<SteerComponentProps> {
  const defaults = steerComponentDefinition.createDefaultProps(node)
  const props = clampSteerComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: STEER_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { steerComponentDefinition }