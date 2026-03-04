import * as THREE from 'three'
import { GRID_MAJOR_SPACING } from './constants'

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
    // Snap to a discrete set of allowed angles (every 10 degrees up to 180).
    // We compute the raw full-angle (0..360), reduce to a 0..180 base to select
    // the nearest allowed angle, then re-apply the original half-circle to
    // preserve direction/quadrant.
    const rawAngleFull = Math.atan2(rawDelta.z, rawDelta.x) // [-pi, pi]
    if (!Number.isNaN(rawAngleFull)) {
      const deg = (rawAngleFull * 180) / Math.PI
      let degPos = deg
      if (degPos < 0) degPos += 360

      // Map into 0..180 for undirected angle matching
      const baseDeg = degPos <= 180 ? degPos : degPos - 180

      // Allowed angles: 10,20,...,180 (degrees). Use 180 as a valid snap.
      const allowed = [10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180]

      // Find nearest allowed base angle.
      let best: number = allowed[0]!
      let bestDiff = Math.abs(baseDeg - best)
      for (let i = 1; i < allowed.length; i++) {
        const cand = allowed[i]!
        const diff = Math.abs(baseDeg - cand)
        if (diff < bestDiff) {
          best = cand
          bestDiff = diff
        }
      }

      // Reconstruct final angle in full circle preserving original half (0..180 vs 180..360)
      const finalBase = best // 10..180
      const finalDeg = degPos <= 180 ? finalBase : (finalBase + 180) % 360
      const finalRad = (finalDeg * Math.PI) / 180

      // Determine a quantized step count along GRID_MAJOR_SPACING and place endpoint
      const length = Math.hypot(delta.x, delta.z)
      const steps = Math.max(1, Math.round(length / GRID_MAJOR_SPACING))
      const worldX = Math.cos(finalRad) * steps * GRID_MAJOR_SPACING
      const worldZ = Math.sin(finalRad) * steps * GRID_MAJOR_SPACING

      return new THREE.Vector3(anchor.x + worldX, anchor.y, anchor.z + worldZ)
    }
  }

  return new THREE.Vector3(
    anchor.x + stepX * GRID_MAJOR_SPACING,
    anchor.y,
    anchor.z + stepZ * GRID_MAJOR_SPACING,
  )
}
