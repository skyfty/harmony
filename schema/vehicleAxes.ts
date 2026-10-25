import * as THREE from 'three'

export type VehicleAxisIndex = 0 | 1 | 2

/**
 * Resolves a cardinal vehicle axis into a caller-owned vector.
 *
 * Vehicle axes are frequently transformed into world space. Returning shared
 * cardinal-vector instances lets one road/heading calculation permanently
 * contaminate later physics and follow-camera work, so every call must produce
 * an independent vector.
 */
export function resolveVehicleAxisVector(
  index: VehicleAxisIndex,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  if (index === 1) {
    return target.set(0, 1, 0)
  }
  if (index === 2) {
    return target.set(0, 0, 1)
  }
  return target.set(1, 0, 0)
}
