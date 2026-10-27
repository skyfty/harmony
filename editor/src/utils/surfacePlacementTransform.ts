import * as THREE from 'three'

const SURFACE_UP = new THREE.Vector3(0, 1, 0)

export function resolveSurfaceAlignedQuaternion(
  normal: THREE.Vector3 | null | undefined,
): THREE.Quaternion {
  if (!normal || !Number.isFinite(normal.x) || !Number.isFinite(normal.y) || !Number.isFinite(normal.z)) {
    return new THREE.Quaternion()
  }
  const normalized = normal.clone()
  if (normalized.lengthSq() <= 1e-12) {
    return new THREE.Quaternion()
  }
  normalized.normalize()
  return new THREE.Quaternion().setFromUnitVectors(SURFACE_UP, normalized)
}
