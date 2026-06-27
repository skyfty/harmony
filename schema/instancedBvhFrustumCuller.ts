import * as THREE from 'three'

export type InstanceBounds = { center: THREE.Vector3; radius: number }

export type InstancedBvhFrustumCuller = {
  setIds: (ids: string[]) => void
  updateAndQueryVisible: (
    frustum: THREE.Frustum,
    getBounds: (id: string, centerTarget: THREE.Vector3) => { radius: number } | null,
  ) => Set<string>
  dispose: () => void
}

const sphere = new THREE.Sphere()

export function createInstancedBvhFrustumCuller(): InstancedBvhFrustumCuller {
  let ids: string[] = []
  const centerScratch = new THREE.Vector3()

  function setIds(nextIds: string[]): void {
    const normalized = Array.isArray(nextIds)
      ? nextIds
          .filter((id) => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : []

    if (normalized.length === ids.length) {
      let same = true
      for (let i = 0; i < normalized.length; i += 1) {
        if (normalized[i] !== ids[i]) {
          same = false
          break
        }
      }
      if (same) {
        return
      }
    }

    ids = normalized
  }

  function updateAndQueryVisible(
    frustum: THREE.Frustum,
    getBounds: (id: string, centerTarget: THREE.Vector3) => { radius: number } | null,
  ): Set<string> {
    const visible = new Set<string>()
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!
      const bounds = getBounds(id, centerScratch)
      if (!bounds) {
        continue
      }

      const radius = bounds.radius
      if (!Number.isFinite(radius) || radius < 0) {
        continue
      }

      sphere.center.copy(centerScratch)
      sphere.radius = radius
      if (frustum.intersectsSphere(sphere)) {
        visible.add(id)
      }
    }

    return visible
  }

  function dispose(): void {
    ids = []
  }

  return {
    setIds,
    updateAndQueryVisible,
    dispose,
  }
}
