import {
  createBackendRigidbodyBody,
  ensureBackendPhysicsWorld,
  extractRoadHeightfieldDebugSurfaces,
  getPhysicsBackendBridge,
  normalizeShapeScale,
} from '@harmony/physics-bridge'

export {
  createBackendRigidbodyBody,
  ensureBackendPhysicsWorld,
  extractRoadHeightfieldDebugSurfaces,
  getPhysicsBackendBridge,
  normalizeShapeScale,
}

export type {
  PhysicsBackendBridge,
  PhysicsBackendShapeScaleLike,
} from '@harmony/physics-bridge'

export function hasPhysicsBackendBridge(): boolean {
  try {
    getPhysicsBackendBridge()
    return true
  } catch {
    return false
  }
}
