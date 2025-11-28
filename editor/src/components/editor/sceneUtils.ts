import type { SceneNode } from '@harmony/schema'
import * as THREE from 'three'
import { GRID_SNAP_SPACING } from './constants'

const instancedBoundsBox = new THREE.Box3()
const instancedBoundsMin = new THREE.Vector3()
const instancedBoundsMax = new THREE.Vector3()

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
