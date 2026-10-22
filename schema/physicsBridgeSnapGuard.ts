export type PendingPhysicsBridgeSnap = {
  position: { x: number; y: number; z: number }
  expiresAtMs: number
}

/** Returns false for an old bridge frame while an explicit teleport is pending. */
export function shouldApplyPhysicsBridgeFrameForPendingSnap(
  pendingSnap: PendingPhysicsBridgeSnap | null | undefined,
  framePosition: { x: number; y: number; z: number },
  nowMs: number,
  maxDistanceMeters = 0.75,
): boolean {
  if (!pendingSnap || nowMs >= pendingSnap.expiresAtMs) {
    return true
  }
  const dx = framePosition.x - pendingSnap.position.x
  const dy = framePosition.y - pendingSnap.position.y
  const dz = framePosition.z - pendingSnap.position.z
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
    return false
  }
  const maxDistance = Number.isFinite(maxDistanceMeters) && maxDistanceMeters > 0
    ? maxDistanceMeters
    : 0.75
  return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance
}
