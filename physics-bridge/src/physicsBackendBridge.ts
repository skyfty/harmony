import type {
  PhysicsBackendBridge,
  PhysicsBackendShapeScaleLike,
} from './physicsBackendTypes'

export type { PhysicsBackendBridge, PhysicsBackendShapeScaleLike } from './physicsBackendTypes'

let activeBridge: PhysicsBackendBridge | null = null

export function initializePhysicsBackendBridge(bridge: PhysicsBackendBridge | null | undefined): void {
  if (!bridge) {
    return
  }
  if (!activeBridge) {
    activeBridge = bridge
    return
  }
}

export function getPhysicsBackendBridge(): PhysicsBackendBridge {
  if (!activeBridge) {
    throw new Error('Physics backend bridge is not registered')
  }
  return activeBridge
}
