import * as THREE from 'three'

const MIN_AXIS_RAY_SINE = 1e-3

/**
 * Returns the position along an axis line closest to a pointer ray.
 *
 * House Rig handles use the difference between two parameters from the same
 * fixed initial axis point, so the result stays absolute across pointer moves.
 * A null result means the axis and pointer ray are too close to parallel to
 * produce a stable value.
 */
export function projectRayOntoAxisParameter(
  ray: THREE.Ray,
  axisPoint: THREE.Vector3,
  axisDirection: THREE.Vector3,
): number | null {
  if (ray.direction.lengthSq() < 1e-12 || axisDirection.lengthSq() < 1e-12) {
    return null
  }

  const rayDirection = ray.direction.clone().normalize()
  const normalizedAxis = axisDirection.clone().normalize()
  const axisRayDot = THREE.MathUtils.clamp(
    normalizedAxis.dot(rayDirection),
    -1,
    1,
  )
  const sineSquared = 1 - axisRayDot * axisRayDot
  if (sineSquared < MIN_AXIS_RAY_SINE * MIN_AXIS_RAY_SINE) {
    return null
  }

  const axisToRayOrigin = axisPoint.clone().sub(ray.origin)
  const axisOffset = normalizedAxis.dot(axisToRayOrigin)
  const rayOffset = rayDirection.dot(axisToRayOrigin)
  return (axisRayDot * rayOffset - axisOffset) / sineSquared
}
