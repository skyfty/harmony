import * as THREE from 'three'

const MIN_DIRECTION_LENGTH = 1e-6
const MIN_DIRECTION_LOCK_LENGTH = 1e-2
const MIN_RECT_SIZE = 1e-6

export type RotatedRectangleBuild = {
  corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
  center: THREE.Vector3
  axisWidth: THREE.Vector3
  axisDepth: THREE.Vector3
  signedWidth: number
  signedDepth: number
  width: number
  depth: number
  yaw: number
}

export function resolveRectangleDirection(
  start: THREE.Vector3,
  end: THREE.Vector3,
  lockedDirection?: THREE.Vector3 | null,
): THREE.Vector3 | null {
  const basis = lockedDirection?.clone() ?? end.clone().sub(start)
  basis.y = 0
  if (!Number.isFinite(basis.x) || !Number.isFinite(basis.z) || basis.lengthSq() <= MIN_DIRECTION_LENGTH) {
    return null
  }
  return basis.normalize()
}

export function resolveRectangleDragDirection(
  start: THREE.Vector3,
  end: THREE.Vector3,
): THREE.Vector3 | null {
  const delta = end.clone().sub(start)
  delta.y = 0
  if (delta.lengthSq() <= MIN_DIRECTION_LOCK_LENGTH * MIN_DIRECTION_LOCK_LENGTH) {
    return null
  }
  return resolveRectangleDirection(start, end)
}

export function buildRotatedRectangleFromCorner(
  start: THREE.Vector3,
  end: THREE.Vector3,
  lockedDirection?: THREE.Vector3 | null,
): RotatedRectangleBuild | null {
  const axisWidth = resolveRectangleDirection(start, end, lockedDirection)
  if (!axisWidth) {
    return null
  }

  const delta = end.clone().sub(start)
  delta.y = 0

  const axisDepth = new THREE.Vector3(-axisWidth.z, 0, axisWidth.x)
  const signedWidth = delta.dot(axisWidth)
  const signedDepth = delta.dot(axisDepth)
  const width = Math.abs(signedWidth)
  const depth = Math.abs(signedDepth)
  if (
    !Number.isFinite(signedWidth)
    || !Number.isFinite(signedDepth)
    || width <= MIN_RECT_SIZE
    || depth <= MIN_RECT_SIZE
  ) {
    return null
  }

  const p1 = start.clone()
  const p2 = start.clone().addScaledVector(axisWidth, signedWidth)
  const p3 = p2.clone().addScaledVector(axisDepth, signedDepth)
  const p4 = start.clone().addScaledVector(axisDepth, signedDepth)
  const center = start.clone()
    .addScaledVector(axisWidth, signedWidth * 0.5)
    .addScaledVector(axisDepth, signedDepth * 0.5)

  return {
    corners: [p1, p2, p3, p4],
    center,
    axisWidth,
    axisDepth,
    signedWidth,
    signedDepth,
    width,
    depth,
    yaw: Math.atan2(-axisWidth.z, axisWidth.x),
  }
}