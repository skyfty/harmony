import * as THREE from 'three'

import type { SceneNode } from '@schema/index'

type UpdateLightObjectProperties = (container: THREE.Object3D, node: SceneNode) => void

export function syncLightFromNodeDuringDrag(
  container: THREE.Object3D,
  node: SceneNode,
  updateLightObjectProperties: UpdateLightObjectProperties,
): void {
  updateLightObjectProperties(container, node)
  container.updateMatrixWorld(true)
}

export function lockDirectionalLightTargetWorldPosition(
  container: THREE.Object3D,
  targetWorldPosition: THREE.Vector3,
  scratchLocal: THREE.Vector3,
): void {
  const directional = container.children.find(
    (child) => (child as THREE.DirectionalLight).isDirectionalLight,
  ) as THREE.DirectionalLight | undefined

  if (!directional?.target) {
    return
  }

  scratchLocal.copy(targetWorldPosition)
  container.worldToLocal(scratchLocal)
  directional.target.position.copy(scratchLocal)
  directional.target.updateMatrixWorld(true)
}
