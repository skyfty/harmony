import { GROUND_NODE_ID, type SceneJsonExportDocument, type SceneNode } from './core'

const groundNodeCacheByNodes = new WeakMap<SceneNode[], SceneNode | null>()

function isGroundNode(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  return node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'Ground'
}

export function resolveGroundNode(nodes: SceneNode[] | null | undefined): SceneNode | null {
  if (!Array.isArray(nodes)) {
    return null
  }

  const cached = groundNodeCacheByNodes.get(nodes)
  if (cached !== undefined) {
    return cached
  }

  const stack: SceneNode[] = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (isGroundNode(node)) {
      groundNodeCacheByNodes.set(nodes, node)
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }

  groundNodeCacheByNodes.set(nodes, null)
  return null
}

export function resolveDocumentGroundNode(document: SceneJsonExportDocument | null | undefined): SceneNode | null {
  return resolveGroundNode(document?.nodes ?? null)
}
