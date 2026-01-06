import type { SceneNode } from './index'

export type SceneNodeId = string
export type SceneNodeParentMap = Map<SceneNodeId, SceneNodeId | null>
export type SceneNodeMap = Map<SceneNodeId, SceneNode>

/**
 * Rebuilds nodeId -> node and nodeId -> parentId indices for a node tree.
 * Clears and mutates the provided maps.
 */
export function rebuildSceneNodeIndex(
  nodes: SceneNode[] | null | undefined,
  nodeMap: SceneNodeMap,
  parentMap: SceneNodeParentMap,
): void {
  nodeMap.clear()
  parentMap.clear()
  if (!Array.isArray(nodes)) {
    return
  }

  const stack: Array<{ node: SceneNode; parentId: SceneNodeId | null }> = nodes.map((node) => ({
    node,
    parentId: null,
  }))

  while (stack.length) {
    const entry = stack.pop()
    if (!entry) {
      continue
    }
    const { node, parentId } = entry
    nodeMap.set(node.id, node)
    parentMap.set(node.id, parentId)

    if (Array.isArray(node.children) && node.children.length) {
      node.children.forEach((child) => {
        stack.push({ node: child, parentId: node.id })
      })
    }
  }
}

export function resolveSceneNodeById(nodeMap: SceneNodeMap, nodeId: string): SceneNode | null {
  return nodeMap.get(nodeId) ?? null
}

export function resolveSceneParentNodeId(parentMap: SceneNodeParentMap, nodeId: string): string | null {
  return parentMap.get(nodeId) ?? null
}
