import * as THREE from 'three'

import { resolveEnabledComponentState, type SceneJsonExportDocument, type SceneNode } from './core'
import {
  GROUND_ANCHOR_COMPONENT_TYPE,
  type GroundAnchorComponentProps,
} from './components'

export function resolveGroundAnchorComponent(
  node: SceneNode | null | undefined,
) {
  return resolveEnabledComponentState<GroundAnchorComponentProps>(node, GROUND_ANCHOR_COMPONENT_TYPE)
}

export function collectGroundAnchorNodeIds(
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
    if (resolveGroundAnchorComponent(node)) {
      nodeIds.push(node.id)
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return nodeIds
}

export function collectGroundAnchorWorldPositions(params: {
  document: SceneJsonExportDocument | null | undefined
  resolveObjectByNodeId: (nodeId: string) => THREE.Object3D | null | undefined
}): THREE.Vector3[] {
  const { document, resolveObjectByNodeId } = params
  const nodeIds = collectGroundAnchorNodeIds(document?.nodes)
  const positions: THREE.Vector3[] = []
  nodeIds.forEach((nodeId) => {
    const object = resolveObjectByNodeId(nodeId) ?? null
    if (!object) {
      return
    }
    positions.push(object.getWorldPosition(new THREE.Vector3()))
  })
  return positions
}
