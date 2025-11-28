import * as THREE from 'three'
import { GRID_SNAP_SPACING } from '../constants'

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
