import type {
  PhysicsBodyLike,
  PhysicsWorldLike,
  PhysicsBackendBridge,
  PhysicsBackendShapeScaleLike,
  BackendRigidbodyCreateParams,
  EnsurePhysicsWorldParams,
  RoadHeightfieldDebugSurface,
  BackendRigidbodyResult,
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

export function hasPhysicsBackendBridge(): boolean {
  return activeBridge != null
}

export function normalizeShapeScale(scaleLike: PhysicsBackendShapeScaleLike): { x: number; y: number; z: number } {
  return getPhysicsBackendBridge().normalizeShapeScale(scaleLike)
}

export function createBackendRigidbodyBody(
  params: BackendRigidbodyCreateParams,
): BackendRigidbodyResult {
  return getPhysicsBackendBridge().createRigidbodyBody(params)
}

export function ensureBackendPhysicsWorld(params: EnsurePhysicsWorldParams): PhysicsWorldLike {
  return getPhysicsBackendBridge().ensurePhysicsWorld(params)
}

export function extractRoadHeightfieldDebugSurfaces(
  bodies: PhysicsBodyLike[],
): RoadHeightfieldDebugSurface[] {
  const extractor = getPhysicsBackendBridge().extractRoadHeightfieldDebugSurfaces
  return extractor ? extractor(bodies) : []
}
