import type { Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState, Vector3Like } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const NOMINATE_COMPONENT_TYPE = 'nominate'

export interface NominateComponentEntry {
  id: string
  key: string
  nodeId: string | null
  defaultVisible: boolean
}

export interface NominateComponentProps {
  entries: NominateComponentEntry[]
}

export interface NominateExternalNodeState {
  visible?: boolean
  position?: Vector3Like
  rotation?: Vector3Like
  scale?: Vector3Like
}

export type NominateExternalStateMap = Record<string, Partial<NominateExternalNodeState> | null | undefined>

export interface NominateResolvedEntry extends NominateComponentEntry {
  ownerNodeId: string
  targetNode: SceneNode
}

const NOMINATE_RUNTIME_BASE_VISIBLE_KEY = '__harmonyNominateBaseVisible'

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

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
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

function sanitizeNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function cloneVectorLike(vector: Vector3Like): Vector3Like {
  return {
    x: sanitizeNumber(vector.x, 0),
    y: sanitizeNumber(vector.y, 0),
    z: sanitizeNumber(vector.z, 0),
  }
}

function normalizeVectorLike(value: unknown): Vector3Like | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Partial<Record<'x' | 'y' | 'z', unknown>>
  const x = sanitizeNumber(record.x, Number.NaN)
  const y = sanitizeNumber(record.y, Number.NaN)
  const z = sanitizeNumber(record.z, Number.NaN)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return undefined
  }
  return { x, y, z }
}

function cloneEntry(entry: NominateComponentEntry): NominateComponentEntry {
  return {
    id: sanitizeString(entry.id),
    key: sanitizeString(entry.key),
    nodeId: sanitizeNodeId(entry.nodeId),
    defaultVisible: entry.defaultVisible !== false,
  }
}

export function clampNominateComponentProps(
  props: Partial<NominateComponentProps> | null | undefined,
): NominateComponentProps {
  const source = Array.isArray(props?.entries) ? props.entries : []
  return {
    entries: source.map((entry) => {
      const record = entry && typeof entry === 'object'
        ? (entry as Partial<NominateComponentEntry>)
        : {}
      return {
        id: sanitizeString(record.id),
        key: sanitizeString(record.key),
        nodeId: sanitizeNodeId(record.nodeId),
        defaultVisible: sanitizeBoolean(record.defaultVisible, true),
      }
    }),
  }
}

export function cloneNominateComponentProps(props: NominateComponentProps): NominateComponentProps {
  return {
    entries: Array.isArray(props.entries) ? props.entries.map(cloneEntry) : [],
  }
}

export function normalizeNominateExternalNodeState(value: unknown): Partial<NominateExternalNodeState> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Partial<Record<'visible' | 'position' | 'rotation' | 'scale', unknown>>
  const next: Partial<NominateExternalNodeState> = {}
  if (record.visible !== undefined) {
    next.visible = sanitizeBoolean(record.visible, true)
  }
  const position = normalizeVectorLike(record.position)
  if (position) {
    next.position = position
  }
  const rotation = normalizeVectorLike(record.rotation)
  if (rotation) {
    next.rotation = rotation
  }
  const scale = normalizeVectorLike(record.scale)
  if (scale) {
    next.scale = scale
  }
  return Object.keys(next).length ? next : null
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

export function collectNominateResolvedEntries(nodes: SceneNode[] | undefined): NominateResolvedEntry[] {
  if (!nodes?.length) {
    return []
  }
  const nodeMap = buildSceneNodeMap(nodes)
  const resolved: NominateResolvedEntry[] = []
  visitSceneNodes(nodes, (node) => {
    const component = node.components?.[NOMINATE_COMPONENT_TYPE] as
      | SceneNodeComponentState<NominateComponentProps>
      | undefined
    if (!component?.enabled) {
      return
    }
    const props = clampNominateComponentProps(component.props)
    props.entries.forEach((entry) => {
      if (!entry.key || !entry.nodeId) {
        return
      }
      const targetNode = nodeMap.get(entry.nodeId)
      if (!targetNode) {
        return
      }
      resolved.push({
        ...cloneEntry(entry),
        ownerNodeId: node.id,
        targetNode,
      })
    })
  })
  return resolved
}

export function buildNominateResolvedEntryMap(nodes: SceneNode[] | undefined): Map<string, NominateResolvedEntry[]> {
  const map = new Map<string, NominateResolvedEntry[]>()
  collectNominateResolvedEntries(nodes).forEach((entry) => {
    const bucket = map.get(entry.key)
    if (bucket) {
      bucket.push(entry)
      return
    }
    map.set(entry.key, [entry])
  })
  return map
}

function applyObjectVector(target: Object3D['position'] | Object3D['rotation'] | Object3D['scale'], value: Vector3Like): void {
  target.set(value.x, value.y, value.z)
}

function getRuntimeBaseVisible(runtimeObject: Object3D): boolean {
  const userData = runtimeObject.userData ?? (runtimeObject.userData = {})
  const cached = userData[NOMINATE_RUNTIME_BASE_VISIBLE_KEY]
  if (typeof cached === 'boolean') {
    return cached
  }
  userData[NOMINATE_RUNTIME_BASE_VISIBLE_KEY] = runtimeObject.visible
  return runtimeObject.visible
}

function applyEffectiveVisibilityToRuntimeTree(
  nodes: SceneNode[] | undefined,
  resolveRuntimeObject: (nodeId: string) => Object3D | null | undefined,
  visibilityOverrides: Map<string, boolean>,
  inheritedVisible = true,
): void {
  if (!nodes?.length) {
    return
  }

  nodes.forEach((node) => {
    const runtimeObject = resolveRuntimeObject(node.id)
    const localVisible = visibilityOverrides.get(node.id) ?? (runtimeObject ? getRuntimeBaseVisible(runtimeObject) : (node.visible ?? true))
    const effectiveVisible = inheritedVisible && localVisible
    if (runtimeObject) {
      runtimeObject.visible = effectiveVisible
    }
    if (node.children?.length) {
      applyEffectiveVisibilityToRuntimeTree(node.children, resolveRuntimeObject, visibilityOverrides, effectiveVisible)
    }
  })
}

export function applyNominateStateMapToRuntime(
  nodes: SceneNode[] | undefined,
  resolveRuntimeObject: (nodeId: string) => Object3D | null | undefined,
  stateMap: NominateExternalStateMap | null | undefined,
): void {
  if (!nodes?.length) {
    return
  }

  const resolvedEntries = collectNominateResolvedEntries(nodes)
  if (!resolvedEntries.length) {
    return
  }

  const defaultApplied = new Set<string>()
  const visibilityOverrides = new Map<string, boolean>()
  resolvedEntries.forEach((entry) => {
    const runtimeObject = resolveRuntimeObject(entry.targetNode.id)
    if (!runtimeObject) {
      return
    }
    if (defaultApplied.has(entry.targetNode.id)) {
      return
    }
    defaultApplied.add(entry.targetNode.id)
    visibilityOverrides.set(entry.targetNode.id, entry.defaultVisible)
    applyObjectVector(runtimeObject.position, cloneVectorLike(entry.targetNode.position))
    applyObjectVector(runtimeObject.rotation, cloneVectorLike(entry.targetNode.rotation))
    applyObjectVector(runtimeObject.scale, cloneVectorLike(entry.targetNode.scale))
  })

  if (!stateMap || typeof stateMap !== 'object') {
    applyEffectiveVisibilityToRuntimeTree(nodes, resolveRuntimeObject, visibilityOverrides)
    return
  }

  const resolvedEntryMap = buildNominateResolvedEntryMap(nodes)
  Object.entries(stateMap).forEach(([key, rawValue]) => {
    const normalizedKey = sanitizeString(key)
    if (!normalizedKey) {
      return
    }
    const override = normalizeNominateExternalNodeState(rawValue)
    if (!override) {
      return
    }
    const entries = resolvedEntryMap.get(normalizedKey)
    if (!entries?.length) {
      return
    }
    entries.forEach((entry) => {
      const runtimeObject = resolveRuntimeObject(entry.targetNode.id)
      if (!runtimeObject) {
        return
      }
      if (override.visible !== undefined) {
        visibilityOverrides.set(entry.targetNode.id, override.visible)
      }
      if (override.position) {
        applyObjectVector(runtimeObject.position, override.position)
      }
      if (override.rotation) {
        applyObjectVector(runtimeObject.rotation, override.rotation)
      }
      if (override.scale) {
        applyObjectVector(runtimeObject.scale, override.scale)
      }
    })
  })

  applyEffectiveVisibilityToRuntimeTree(nodes, resolveRuntimeObject, visibilityOverrides)
}

class NominateComponent extends Component<NominateComponentProps> {
  constructor(context: ComponentRuntimeContext<NominateComponentProps>) {
    super(context)
  }
}

const nominateComponentDefinition: ComponentDefinition<NominateComponentProps> = {
  type: NOMINATE_COMPONENT_TYPE,
  label: 'Nominate',
  icon: 'mdi-format-list-bulleted-square',
  order: 175,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return { entries: [] }
  },
  createInstance(context) {
    return new NominateComponent(context)
  },
}

componentManager.registerDefinition(nominateComponentDefinition)

export function createNominateComponentState(
  node: SceneNode,
  overrides?: Partial<NominateComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<NominateComponentProps> {
  const defaults = nominateComponentDefinition.createDefaultProps(node)
  const props = clampNominateComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: NOMINATE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { nominateComponentDefinition }