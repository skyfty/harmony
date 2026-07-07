import type { BehaviorComponentProps, SceneBehavior, SceneNode } from '../core'
import { BEHAVIOR_COMPONENT_TYPE } from '../components'
import { behaviorMapToList } from './definitions'

export interface BehaviorSequenceOption {
  sequenceId: string
  label: string
}

export function findSceneNodeById(nodes: SceneNode[] | undefined, nodeId: string | null): SceneNode | null {
  if (!nodes || !nodeId) {
    return null
  }
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node
    }
    const child = findSceneNodeById(node.children, nodeId)
    if (child) {
      return child
    }
  }
  return null
}

export function resolveSceneNodeName(nodes: SceneNode[] | undefined, nodeId: string | null): string | null {
  const node = findSceneNodeById(nodes, nodeId)
  if (!node) {
    return null
  }
  const name = node.name?.trim()
  return name && name.length ? name : node.id
}

export function collectPerformSequenceOptions(nodes: SceneNode[] | undefined, nodeId: string | null): BehaviorSequenceOption[] {
  const node = findSceneNodeById(nodes, nodeId)
  if (!node) {
    return []
  }
  const component = node.components?.[BEHAVIOR_COMPONENT_TYPE] as
    | { props?: BehaviorComponentProps | null }
    | undefined
  if (!component?.props) {
    return []
  }
  const source = component.props.behaviors
  const list: SceneBehavior[] = Array.isArray(source)
    ? source
    : behaviorMapToList(source)
  const seen = new Map<string, string>()
  let unnamedIndex = 1
  list.forEach((entry) => {
    if (!entry || entry.action !== 'perform') {
      return
    }
    const sequenceId = entry.sequenceId?.trim()
    if (!sequenceId || seen.has(sequenceId)) {
      return
    }
    const label = entry.name?.trim() || `Perform Sequence ${unnamedIndex}`
    if (!entry.name?.trim()) {
      unnamedIndex += 1
    }
    seen.set(sequenceId, label)
  })
  return Array.from(seen.entries()).map(([sequenceId, label]) => ({ sequenceId, label }))
}

export function resolvePerformSequenceLabel(
  nodes: SceneNode[] | undefined,
  nodeId: string | null,
  sequenceId: string | null,
): string | null {
  if (!nodeId || !sequenceId) {
    return null
  }
  const options = collectPerformSequenceOptions(nodes, nodeId)
  return options.find((option) => option.sequenceId === sequenceId)?.label ?? null
}
