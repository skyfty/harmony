import type { SceneNode } from '@harmony/schema'
import * as THREE from 'three'
import { GRID_SNAP_SPACING } from './constants'

const instancedBoundsBox = new THREE.Box3()
const instancedBoundsMin = new THREE.Vector3()
const instancedBoundsMax = new THREE.Vector3()

const orientedBoundsYawInvMatrix = new THREE.Matrix4()
const orientedBoundsYawMatrix = new THREE.Matrix4()
const orientedBoundsTmpWorld = new THREE.Vector3()
const orientedBoundsTmpYaw = new THREE.Vector3()
const orientedBoundsCorners = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
] as [
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
]

export function findSceneNode(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    if (node.children) {
      const found = findSceneNode(node.children, id)
      if (found) {
        return found
      }
    }
  }
  return null
}

export function buildParentIndex(
  nodes: SceneNode[],
  parentId: string | null,
  map: Map<string, string | null>
): Map<string, string | null> {
  for (const node of nodes) {
    map.set(node.id, parentId)
    if (node.children) {
      buildParentIndex(node.children, node.id, map)
    }
  }
  return map
}

export function filterTopLevelSelection(selectedIds: string[], parentMap: Map<string, string | null>): string[] {
  // If a node is selected and its parent is also selected (directly or indirectly),
  // we only want to transform the parent to avoid double transformation.
  // However, the logic here might be simpler: just check if parent is in selectedIds.
  
  // Re-implementing logic from SceneViewport.vue if I can find it.
  // Assuming standard logic:
  const selectedSet = new Set(selectedIds)
  return selectedIds.filter(id => {
    let current = parentMap.get(id)
    while (current) {
      if (selectedSet.has(current)) {
        return false
      }
      current = parentMap.get(current) ?? null
    }
    return true
  })
}

export function setBoundingBoxFromObject(object: THREE.Object3D | null, target: THREE.Box3): THREE.Box3 {
  if (!object) {
    return target.makeEmpty()
  }
  const instancedBounds = object.userData?.instancedBounds as { min?: number[]; max?: number[] } | undefined
  if (instancedBounds?.min?.length === 3 && instancedBounds?.max?.length === 3) {
    instancedBoundsMin.fromArray(instancedBounds.min)
    instancedBoundsMax.fromArray(instancedBounds.max)
    instancedBoundsBox.min.copy(instancedBoundsMin)
    instancedBoundsBox.max.copy(instancedBoundsMax)
    target.copy(instancedBoundsBox)
    target.applyMatrix4(object.matrixWorld)
    return target
  }
  return target.setFromObject(object)
}

export function computeOrientedGroundRectFromObject(
  object: THREE.Object3D | null,
  yaw: number,
  outCenter: THREE.Vector3,
  outSize: THREE.Vector3,
): boolean {
  if (!object) {
    outCenter.set(0, 0, 0)
    outSize.set(0, 0, 0)
    return false
  }

  const safeYaw = Number.isFinite(yaw) ? yaw : 0
  orientedBoundsYawInvMatrix.makeRotationY(-safeYaw)
  orientedBoundsYawMatrix.makeRotationY(safeYaw)

  object.updateMatrixWorld(true)

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let hasAnyPoint = false

  const consumeWorldPoint = (worldPoint: THREE.Vector3) => {
    orientedBoundsTmpYaw.copy(worldPoint).applyMatrix4(orientedBoundsYawInvMatrix)
    if (orientedBoundsTmpYaw.x < minX) minX = orientedBoundsTmpYaw.x
    if (orientedBoundsTmpYaw.x > maxX) maxX = orientedBoundsTmpYaw.x
    if (orientedBoundsTmpYaw.z < minZ) minZ = orientedBoundsTmpYaw.z
    if (orientedBoundsTmpYaw.z > maxZ) maxZ = orientedBoundsTmpYaw.z
    hasAnyPoint = true
  }

  object.traverse((candidate) => {
    // Support the same instanced-bounds optimization used by setBoundingBoxFromObject.
    const instancedBounds = candidate.userData?.instancedBounds as { min?: number[]; max?: number[] } | undefined
    if (instancedBounds?.min?.length === 3 && instancedBounds?.max?.length === 3) {
      instancedBoundsMin.fromArray(instancedBounds.min)
      instancedBoundsMax.fromArray(instancedBounds.max)
      const min = instancedBoundsMin
      const max = instancedBoundsMax

      orientedBoundsCorners[0].set(min.x, min.y, min.z)
      orientedBoundsCorners[1].set(min.x, min.y, max.z)
      orientedBoundsCorners[2].set(min.x, max.y, min.z)
      orientedBoundsCorners[3].set(min.x, max.y, max.z)
      orientedBoundsCorners[4].set(max.x, min.y, min.z)
      orientedBoundsCorners[5].set(max.x, min.y, max.z)
      orientedBoundsCorners[6].set(max.x, max.y, min.z)
      orientedBoundsCorners[7].set(max.x, max.y, max.z)

      for (const corner of orientedBoundsCorners) {
        orientedBoundsTmpWorld.copy(corner).applyMatrix4(candidate.matrixWorld)
        consumeWorldPoint(orientedBoundsTmpWorld)
      }
      return
    }

    const mesh = candidate as unknown as THREE.Mesh
    const geometry = (mesh as any).geometry as THREE.BufferGeometry | undefined
    if (!geometry) {
      return
    }

    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }
    const bbox = geometry.boundingBox
    if (!bbox || bbox.isEmpty()) {
      return
    }

    const min = bbox.min
    const max = bbox.max

    orientedBoundsCorners[0].set(min.x, min.y, min.z)
    orientedBoundsCorners[1].set(min.x, min.y, max.z)
    orientedBoundsCorners[2].set(min.x, max.y, min.z)
    orientedBoundsCorners[3].set(min.x, max.y, max.z)
    orientedBoundsCorners[4].set(max.x, min.y, min.z)
    orientedBoundsCorners[5].set(max.x, min.y, max.z)
    orientedBoundsCorners[6].set(max.x, max.y, min.z)
    orientedBoundsCorners[7].set(max.x, max.y, max.z)

    for (const corner of orientedBoundsCorners) {
      orientedBoundsTmpWorld.copy(corner).applyMatrix4(candidate.matrixWorld)
      consumeWorldPoint(orientedBoundsTmpWorld)
    }
  })

  if (!hasAnyPoint || !Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    outCenter.set(0, 0, 0)
    outSize.set(0, 0, 0)
    return false
  }

  outSize.set(maxX - minX, 0, maxZ - minZ)
  outCenter.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2).applyMatrix4(orientedBoundsYawMatrix)
  return true
}

export function toEulerLike(euler: THREE.Euler): THREE.Vector3 {
  return new THREE.Vector3(euler.x, euler.y, euler.z)
}

export type VectorCoordinates = Pick<THREE.Vector3, 'x' | 'y' | 'z'>

export function cloneVectorCoordinates(vector: VectorCoordinates): THREE.Vector3 {
  const safeX = Number.isFinite(vector.x) ? vector.x : 0
  const safeY = Number.isFinite(vector.y) ? vector.y : 0
  const safeZ = Number.isFinite(vector.z) ? vector.z : 0
  return new THREE.Vector3(safeX, safeY, safeZ)
}

export function snapVectorToGrid(vec: THREE.Vector3) {
  vec.x = Math.round(vec.x / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
  vec.y = Math.round(vec.y / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
  vec.z = Math.round(vec.z / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
  return vec
}

export function snapValueToGrid(value: number): number {
  return Math.round(value / GRID_SNAP_SPACING) * GRID_SNAP_SPACING
}
