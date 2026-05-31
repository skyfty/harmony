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

export type RectangleBuildPhase = 'idle' | 'edgeDraft' | 'rectangleDraft'

export function resolveRectangleDirection(
  start: THREE.Vector3,
  end: THREE.Vector3,
  lockedDirection?: THREE.Vector3 | null,
  axisAligned = false,
): THREE.Vector3 | null {
  const basis = lockedDirection?.clone() ?? end.clone().sub(start)
  basis.y = 0
  if (!Number.isFinite(basis.x) || !Number.isFinite(basis.z) || basis.lengthSq() <= MIN_DIRECTION_LENGTH) {
    return null
  }
  if (!axisAligned) {
    return basis.normalize()
  }

  const absX = Math.abs(basis.x)
  const absZ = Math.abs(basis.z)
  if (absX <= MIN_DIRECTION_LENGTH && absZ <= MIN_DIRECTION_LENGTH) {
    return null
  }

  if (absX >= absZ) {
    return new THREE.Vector3(Math.sign(basis.x) || 1, 0, 0)
  }
  return new THREE.Vector3(0, 0, Math.sign(basis.z) || 1)
}

export function resolveRectangleDragDirection(
  start: THREE.Vector3,
  end: THREE.Vector3,
  axisAligned = false,
): THREE.Vector3 | null {
  const delta = end.clone().sub(start)
  delta.y = 0
  if (delta.lengthSq() <= MIN_DIRECTION_LOCK_LENGTH * MIN_DIRECTION_LOCK_LENGTH) {
    return null
  }
  return resolveRectangleDirection(start, end, null, axisAligned)
}

export function projectPointAlongDirection(
  start: THREE.Vector3,
  target: THREE.Vector3,
  direction: THREE.Vector3,
): THREE.Vector3 | null {
  const delta = target.clone().sub(start)
  delta.y = 0
  const axis = direction.clone()
  axis.y = 0
  if (!Number.isFinite(axis.x) || !Number.isFinite(axis.z) || axis.lengthSq() <= MIN_DIRECTION_LENGTH) {
    return null
  }
  axis.normalize()
  const signedDistance = delta.dot(axis)
  if (!Number.isFinite(signedDistance) || Math.abs(signedDistance) <= MIN_RECT_SIZE) {
    return null
  }
  return start.clone().addScaledVector(axis, signedDistance)
}

export function buildAxisAlignedRectangleEdgePreviewPoints(
  start: THREE.Vector3,
  target: THREE.Vector3,
): [THREE.Vector3, THREE.Vector3] | null {
  const direction = resolveRectangleDirection(start, target, null, true)
  if (!direction) {
    return null
  }
  const projectedEnd = projectPointAlongDirection(start, target, direction)
  if (!projectedEnd) {
    return null
  }
  return [start.clone(), projectedEnd]
}

export function buildRotatedRectangleFromCorner(
  start: THREE.Vector3,
  end: THREE.Vector3,
  lockedDirection?: THREE.Vector3 | null,
  axisAligned = false,
): RotatedRectangleBuild | null {
  const axisWidth = resolveRectangleDirection(start, end, lockedDirection, axisAligned)
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

export function buildRotatedRectangleFromEdge(
  start: THREE.Vector3,
  baseEdgeEnd: THREE.Vector3,
  currentPoint: THREE.Vector3,
  axisAligned = false,
): RotatedRectangleBuild | null {
  const axisWidth = resolveRectangleDirection(start, baseEdgeEnd, null, axisAligned)
  if (!axisWidth) {
    return null
  }

  const baseDelta = baseEdgeEnd.clone().sub(start)
  baseDelta.y = 0
  const signedWidth = baseDelta.dot(axisWidth)
  const width = Math.abs(signedWidth)
  if (!Number.isFinite(signedWidth) || width <= MIN_RECT_SIZE) {
    return null
  }

  const axisDepth = new THREE.Vector3(-axisWidth.z, 0, axisWidth.x)
  const depthDelta = currentPoint.clone().sub(start)
  depthDelta.y = 0
  const signedDepth = depthDelta.dot(axisDepth)
  const depth = Math.abs(signedDepth)
  if (!Number.isFinite(signedDepth) || depth <= MIN_RECT_SIZE) {
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
