import type * as THREE from 'three'
import {
  COMPONENT_ARTIFACT_KEY,
  COMPONENT_ARTIFACT_NODE_ID_KEY,
  PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
} from '@schema/components'
import type { SceneNode } from '@schema/core'

type SceneNodeLookup = (nodeId: string) => Pick<SceneNode, 'components'> | null | undefined

export function isProceduralLandscapePlacementArtifact(
  object: THREE.Object3D | null | undefined,
  getNode: SceneNodeLookup,
): boolean {
  let current: THREE.Object3D | null = object ?? null
  while (current) {
    const userData = current.userData as Record<string, unknown> | undefined
    if (userData?.[COMPONENT_ARTIFACT_KEY] === true) {
      const ownerNodeId = userData[COMPONENT_ARTIFACT_NODE_ID_KEY]
      if (
        typeof ownerNodeId === 'string'
        && Boolean(getNode(ownerNodeId)?.components?.[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE])
      ) {
        return true
      }
    }
    current = current.parent
  }
  return false
}
