import * as THREE from 'three'
import { GRID_MAJOR_SPACING, WALL_AXIS_SNAP_THRESHOLD, WALL_DIAGONAL_SNAP_THRESHOLD } from './constants'

/**
 * Constrains the dragged wall endpoint to the major grid, with *soft* angle snapping.
 * - Always quantizes to GRID_MAJOR_SPACING.
 * - If the raw direction is near 45°, snap to diagonal.
 * - If the raw direction is near an axis, snap to that axis.
 * - Otherwise keep the quantized (possibly slanted) direction.
 */
export function constrainWallEndPointSoftSnap(
  anchor: THREE.Vector3,
  target: THREE.Vector3,
  rawTarget?: THREE.Vector3,
): THREE.Vector3 {
  const delta = target.clone().sub(anchor)
  let stepX = Math.round(delta.x / GRID_MAJOR_SPACING)
  let stepZ = Math.round(delta.z / GRID_MAJOR_SPACING)

  if (stepX === 0 && stepZ === 0) {
    return anchor.clone()
  }

  const rawDelta = rawTarget ? rawTarget.clone().sub(anchor) : delta.clone()
  const absRawX = Math.abs(rawDelta.x)
  const absRawZ = Math.abs(rawDelta.z)

  if (absRawX > 1e-4 || absRawZ > 1e-4) {
    const angle = Math.atan2(absRawZ, absRawX) // [0, pi/2]
    if (!Number.isNaN(angle)) {
      const diagonalAngle = Math.PI * 0.25
      const axisAngle = 0
      const zAxisAngle = Math.PI * 0.5

      // Prefer diagonal snap.
      if (Math.abs(angle - diagonalAngle) <= WALL_DIAGONAL_SNAP_THRESHOLD) {
        const diagSteps = Math.max(Math.abs(stepX), Math.abs(stepZ), 1)
        const signX = rawDelta.x >= 0 ? 1 : -1
        const signZ = rawDelta.z >= 0 ? 1 : -1
        stepX = diagSteps * signX
        stepZ = diagSteps * signZ
      } else if (Math.abs(angle - axisAngle) <= WALL_AXIS_SNAP_THRESHOLD) {
        // Near X axis.
        stepZ = 0
      } else if (Math.abs(angle - zAxisAngle) <= WALL_AXIS_SNAP_THRESHOLD) {
        // Near Z axis.
        stepX = 0
      }
    }
  }

  return new THREE.Vector3(
    anchor.x + stepX * GRID_MAJOR_SPACING,
    anchor.y,
    anchor.z + stepZ * GRID_MAJOR_SPACING,
  )
}
