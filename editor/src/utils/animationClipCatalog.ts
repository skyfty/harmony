import type { SceneNode } from '@schema/core'
import { ANIMATION_COMPONENT_TYPE } from '@schema/components'
import { collectAnimationClipCatalog } from '@schema/runtimeAnimationCatalog'
import { getRuntimeObject } from '@/stores/sceneStore'

export type EditorAnimationClipOption = {
  label: string
  value: string
}

export function findSceneNodeById(tree: SceneNode[] | undefined, id: string | null | undefined): SceneNode | null {
  if (!tree || !id) {
    return null
  }
  for (const node of tree) {
    if (node.id === id) {
      return node
    }
    const match = findSceneNodeById(node.children, id)
    if (match) {
      return match
    }
  }
  return null
}

export function resolveAnimationComponentOwnerNode(
  tree: SceneNode[] | undefined,
  nodeId: string | null | undefined,
): SceneNode | null {
  const node = findSceneNodeById(tree, nodeId)
  if (!node) {
    return null
  }
  return node.components?.[ANIMATION_COMPONENT_TYPE] ? node : null
}

export function resolveAnimationComponentSourceNode(
  tree: SceneNode[] | undefined,
  ownerNode: SceneNode | null | undefined,
): SceneNode | null {
  if (!ownerNode) {
    return null
  }
  return findSceneNodeById(tree, ownerNode.id)
}

export function collectAnimationClipOptionsForComponentNode(
  tree: SceneNode[] | undefined,
  ownerNode: SceneNode | null | undefined,
): EditorAnimationClipOption[] {
  const sourceNode = resolveAnimationComponentSourceNode(tree, ownerNode)
  if (!sourceNode) {
    return []
  }
  const runtimeObject = getRuntimeObject(sourceNode.id)
  return collectAnimationClipCatalog(runtimeObject)
}
