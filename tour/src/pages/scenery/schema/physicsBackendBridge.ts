import {
  createBackendRigidbodyBody,
  ensureBackendPhysicsWorld,
  getPhysicsBackendBridge,
  initializePhysicsBackendBridge,
  normalizeShapeScale,
} from '@harmony/physics-bridge'

export {
  createBackendRigidbodyBody,
  ensureBackendPhysicsWorld,
  getPhysicsBackendBridge,
  initializePhysicsBackendBridge,
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
