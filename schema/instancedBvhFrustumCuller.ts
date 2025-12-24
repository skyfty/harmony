import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export type InstanceBounds = { center: THREE.Vector3; radius: number }

export type InstancedBvhFrustumCuller = {
  setIds: (ids: string[]) => void
  updateAndQueryVisible: (
    frustum: THREE.Frustum,
    getBounds: (id: string, centerTarget: THREE.Vector3) => { radius: number } | null,
  ) => Set<string>
  dispose: () => void
}

const v0 = new THREE.Vector3()
const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()

export function createInstancedBvhFrustumCuller(): InstancedBvhFrustumCuller {
  let ids: string[] = []

  const geometry = new THREE.BufferGeometry()
  const positionAttribute = new THREE.BufferAttribute(new Float32Array(0), 3)
  geometry.setAttribute('position', positionAttribute)

  let bvh: MeshBVH | null = null

  const centerScratch = new THREE.Vector3()
  const boundsBox = new THREE.Box3()

  function rebuild(): void {
    const triangleCount = ids.length
    const positions = new Float32Array(triangleCount * 9)
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setDrawRange(0, triangleCount * 3)
    // Create (or recreate) BVH.
    bvh = triangleCount ? new MeshBVH(geometry, { maxLeafTris: 10 }) : null
  }

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
    rebuild()
  }

  function updateAndQueryVisible(
    frustum: THREE.Frustum,
    getBounds: (id: string, centerTarget: THREE.Vector3) => { radius: number } | null,
  ): Set<string> {
    const visible = new Set<string>()
    if (!bvh || !ids.length) {
      return visible
    }

    const attr = geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attr.array as Float32Array

    boundsBox.makeEmpty()

    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!
      const bounds = getBounds(id, centerScratch)
      if (!bounds) {
        // Put it far away so it gets culled by frustum.
        centerScratch.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
      }
      const radius = bounds?.radius ?? 0
      const cx = centerScratch.x
      const cy = centerScratch.y
      const cz = centerScratch.z

      // Triangle that approximates a sphere bounds around (cx, cy, cz)
      v0.set(cx - radius, cy - radius, cz)
      v1.set(cx + radius, cy - radius, cz)
      v2.set(cx, cy + radius, cz + radius)

      const base = i * 9
      array[base + 0] = v0.x
      array[base + 1] = v0.y
      array[base + 2] = v0.z
      array[base + 3] = v1.x
      array[base + 4] = v1.y
      array[base + 5] = v1.z
      array[base + 6] = v2.x
      array[base + 7] = v2.y
      array[base + 8] = v2.z

      boundsBox.expandByPoint(v0)
      boundsBox.expandByPoint(v1)
      boundsBox.expandByPoint(v2)
    }

    attr.needsUpdate = true
    geometry.boundingBox = boundsBox
    bvh.refit()

    // Use shapecast to collect triangle indices whose bounds intersect frustum.
    ;(bvh as any).shapecast({
      intersectsBounds: (box: THREE.Box3) => frustum.intersectsBox(box),
      intersectsTriangle: (_tri: any, triIndex: number) => {
        const id = ids[triIndex]
        if (id) {
          visible.add(id)
        }
        return false
      },
    })

    return visible
  }

  function dispose(): void {
    ids = []
    bvh = null
    geometry.dispose()
  }

  return {
    setIds,
    updateAndQueryVisible,
    dispose,
  }
}
