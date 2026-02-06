import type { SceneNode } from '@harmony/schema'

export function createSkySceneNode(id: string, overrides: { visible?: boolean; userData?: Record<string, unknown> | null } = {}): SceneNode {
  return {
    id,
    name: 'Sky',
    nodeType: 'Sky',
    canPrefab: false,
    allowChildNodes: false,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: overrides.visible ?? true,
    locked: false,
    editorFlags: { editorOnly: true },
    userData: overrides.userData ?? null,
  }
}

export function isSkyNode(node: SceneNode, id: string): boolean {
  return node.id === id
}

export function normalizeSkySceneNode(node: SceneNode | null | undefined, createSky: (overrides?: any) => SceneNode): SceneNode {
  if (!node) {
    return createSky()
  }
  const visible = node.visible ?? true
  const userData = node.userData ? { ...(node.userData as Record<string, unknown>) } : null
  const normalized = createSky({ visible, userData })
  if (node.children?.length) {
    normalized.children = node.children.map((c) => ({ ...c }))
  }
  return normalized
}

export function ensureSkyNode(
  nodes: SceneNode[],
  isGroundNode: (n: SceneNode) => boolean,
  isSkyNodePred: (n: SceneNode) => boolean,
  createSky: (overrides?: any) => SceneNode,
): SceneNode[] {
  let skyNode: SceneNode | null = null
  const others: SceneNode[] = []
  nodes.forEach((node) => {
    if (!skyNode && isSkyNodePred(node)) {
      skyNode = normalizeSkySceneNode(node, createSky)
      return
    }
    if (!isSkyNodePred(node)) {
      others.push(node)
    }
  })
  if (!skyNode) {
    skyNode = createSky()
  }
  const insertIndex = others.findIndex((node) => isGroundNode(node))
  const next = [...others]
  next.splice(insertIndex >= 0 ? insertIndex + 1 : 0, 0, skyNode)
  return next
}

export default {
  createSkySceneNode,
  isSkyNode,
  normalizeSkySceneNode,
  ensureSkyNode,
}
