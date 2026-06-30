import type { PhysicsQuaternion, PhysicsVector3 } from './types'

export function distanceBetween(a: PhysicsVector3, b: PhysicsVector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export function normalizeVector(vector: PhysicsVector3): PhysicsVector3 {
  const vectorLength = Math.hypot(vector[0], vector[1], vector[2])
  if (!(vectorLength > 1e-6)) {
    return [0, 1, 0]
  }
  return [vector[0] / vectorLength, vector[1] / vectorLength, vector[2] / vectorLength]
}

export function normalizeQuaternion(quaternion: PhysicsQuaternion): PhysicsQuaternion {
  const quaternionLength = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
  if (!(quaternionLength > 1e-6)) {
    return [0, 0, 0, 1]
  }
  return [
    quaternion[0] / quaternionLength,
    quaternion[1] / quaternionLength,
    quaternion[2] / quaternionLength,
    quaternion[3] / quaternionLength,
  ]
}

export function resolveCharacterProbeOffsets(radius: number): Array<[number, number]> {
  const ring = Math.max(0.06, radius + 0.02)
  const diagonal = ring * Math.SQRT1_2
  return [
    [0, 0],
    [ring, 0],
    [-ring, 0],
    [0, ring],
    [0, -ring],
    [diagonal, diagonal],
    [diagonal, -diagonal],
    [-diagonal, diagonal],
    [-diagonal, -diagonal],
  ]
}

export function axisVectorForIndex(axisIndex: 0 | 1 | 2): PhysicsVector3 {
  if (axisIndex === 1) {
    return [0, 1, 0]
  }
  if (axisIndex === 2) {
    return [0, 0, 1]
  }
  return [1, 0, 0]
}

export function rotateVectorByQuaternion(
  vector: PhysicsVector3,
  quaternion: PhysicsQuaternion | { x?: number; y?: number; z?: number; w?: number } | null | undefined,
): PhysicsVector3 {
  const qx = Array.isArray(quaternion) ? quaternion[0] : quaternion?.x ?? 0
  const qy = Array.isArray(quaternion) ? quaternion[1] : quaternion?.y ?? 0
  const qz = Array.isArray(quaternion) ? quaternion[2] : quaternion?.z ?? 0
  const qw = Array.isArray(quaternion) ? quaternion[3] : quaternion?.w ?? 1
  const vx = vector[0]
  const vy = vector[1]
  const vz = vector[2]

  const ix = qw * vx + qy * vz - qz * vy
  const iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx
  const iw = -qx * vx - qy * vy - qz * vz

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}
