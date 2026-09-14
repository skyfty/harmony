import {
  GROUND_COLLISION_SOURCE_COMPONENT_TYPE,
  type GroundCollisionSourceComponentProps,
} from './components'
import { resolveEnabledComponentState, type SceneNode } from './core'

export function resolveGroundCollisionSourceComponent(
  node: SceneNode | null | undefined,
) {
  return resolveEnabledComponentState<GroundCollisionSourceComponentProps>(
    node,
    GROUND_COLLISION_SOURCE_COMPONENT_TYPE,
  )
}

export function collectGroundCollisionSourceNodeIds(
  nodes: SceneNode[] | null | undefined,
): string[] {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return []
  }
  const nodeIds: string[] = []
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (resolveGroundCollisionSourceComponent(node)) {
      nodeIds.push(node.id)
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return nodeIds
}
