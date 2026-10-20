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

export type GroundAnchorWorldTarget = {
  /** Document node id when the anchor originates from the authored scene graph. */
  nodeId: string | null
  object: THREE.Object3D
  position: THREE.Vector3
  source: 'document' | 'runtime'
}

export type CollectGroundAnchorWorldTargetsParams = {
  document: SceneJsonExportDocument | null | undefined
  resolveObjectByNodeId: (nodeId: string) => THREE.Object3D | null | undefined
  /**
   * Runtime scene roots. This catches Ground Anchors added by runtime-prefab or
   * behaviour flows that are not yet mirrored into the authored document.
   */
  runtimeRoots?: THREE.Object3D | readonly (THREE.Object3D | null | undefined)[] | null
}

function normalizeRuntimeRoots(
  value: CollectGroundAnchorWorldTargetsParams['runtimeRoots'],
): THREE.Object3D[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value.filter((root): root is THREE.Object3D => Boolean(root))
  }
  return [value as THREE.Object3D]
}

function isEffectivelyVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (current.visible === false) {
      return false
    }
    current = current.parent
  }
  return true
}

export function collectGroundAnchorWorldTargets(
  params: CollectGroundAnchorWorldTargetsParams,
): GroundAnchorWorldTarget[] {
  const { document, resolveObjectByNodeId, runtimeRoots } = params
  const targets: GroundAnchorWorldTarget[] = []
  const seenObjects = new Set<string>()
  const addTarget = (
    nodeId: string | null,
    object: THREE.Object3D | null | undefined,
    source: GroundAnchorWorldTarget['source'],
  ): void => {
    if (!object || !isEffectivelyVisible(object) || seenObjects.has(object.uuid)) {
      return
    }
    seenObjects.add(object.uuid)
    targets.push({
      nodeId,
      object,
      position: object.getWorldPosition(new THREE.Vector3()),
      source,
    })
  }

  const nodeIds = collectGroundAnchorNodeIds(document?.nodes)
  nodeIds.forEach((nodeId) => {
    addTarget(nodeId, resolveObjectByNodeId(nodeId), 'document')
  })

  normalizeRuntimeRoots(runtimeRoots).forEach((root) => {
    const stack: THREE.Object3D[] = [root]
    while (stack.length > 0) {
      const object = stack.pop()
      if (!object || object.visible === false) {
        continue
      }
      const anchorNodeId = typeof object.userData?.groundAnchorNodeId === 'string'
        ? object.userData.groundAnchorNodeId
        : null
      if (object.userData?.groundAnchor === true) {
        addTarget(anchorNodeId, object, 'runtime')
      }
      if (object.children.length > 0) {
        stack.push(...object.children)
      }
    }
  })
  return targets
}

export function collectGroundAnchorWorldPositions(params: {
  document: SceneJsonExportDocument | null | undefined
  resolveObjectByNodeId: (nodeId: string) => THREE.Object3D | null | undefined
  runtimeRoots?: CollectGroundAnchorWorldTargetsParams['runtimeRoots']
}): THREE.Vector3[] {
  return collectGroundAnchorWorldTargets(params).map((target) => target.position)
}
