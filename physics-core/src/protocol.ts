import type {
  PhysicsAddRuntimeBodiesCommand,
  PhysicsBodySnapshot,
  PhysicsBodyTransformCommand,
  PhysicsBodyVelocityCommand,
  PhysicsBridgeInitResult,
  PhysicsInitOptions,
  PhysicsContactEvent,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsRemoveRuntimeBodiesCommand,
  PhysicsSceneAsset,
  PhysicsVehicleInputCommand,
} from './types'

export type PhysicsStepFrame = {
  frame: number
  bodyCount: number
  wheelCount: number
  bodyTransforms: Float32Array
  wheelTransforms: Float32Array
  bodyMeta?: Uint32Array
  bodyLinearVelocities?: Float32Array
  bodyAngularVelocities?: Float32Array
  bodySleeping?: Uint8Array
  contacts?: PhysicsContactEvent[]
}

export type PhysicsAuthoritySnapshot = {
  tick: number
  frame: number
  bodies: PhysicsBodySnapshot[]
  contacts?: PhysicsContactEvent[]
}

export type PhysicsWorkerRequest =
  | { id: number; type: 'init'; payload: PhysicsInitOptions }
  | { id: number; type: 'load-scene'; payload: PhysicsSceneAsset }
  | { id: number; type: 'step'; payload: { deltaMs: number } }
  | { id: number; type: 'set-body-transform'; payload: PhysicsBodyTransformCommand }
  | { id: number; type: 'set-body-velocity'; payload: PhysicsBodyVelocityCommand }
  | { id: number; type: 'set-vehicle-input'; payload: PhysicsVehicleInputCommand }
  | { id: number; type: 'add-runtime-bodies'; payload: PhysicsAddRuntimeBodiesCommand }
  | { id: number; type: 'remove-runtime-bodies'; payload: PhysicsRemoveRuntimeBodiesCommand }
  | { id: number; type: 'raycast'; payload: PhysicsRaycastCommand }
  | { id: number; type: 'dispose-scene'; payload: null }
  | { id: number; type: 'destroy'; payload: null }

export type PhysicsWorkerSuccessResponse =
  | { id: number; ok: true; type: 'init'; payload: PhysicsBridgeInitResult }
  | { id: number; ok: true; type: 'load-scene'; payload: { bodyCount: number; vehicleCount: number } }
  | { id: number; ok: true; type: 'step'; payload: PhysicsStepFrame }
  | { id: number; ok: true; type: 'set-body-transform'; payload: null }
  | { id: number; ok: true; type: 'set-body-velocity'; payload: null }
  | { id: number; ok: true; type: 'set-vehicle-input'; payload: null }
  | { id: number; ok: true; type: 'add-runtime-bodies'; payload: null }
  | { id: number; ok: true; type: 'remove-runtime-bodies'; payload: null }
  | { id: number; ok: true; type: 'raycast'; payload: PhysicsRaycastHit | null }
  | { id: number; ok: true; type: 'dispose-scene'; payload: null }
  | { id: number; ok: true; type: 'destroy'; payload: null }

export type PhysicsWorkerErrorResponse = {
  id: number
  ok: false
  error: {
    message: string
    stack?: string
  }
}

export type PhysicsWorkerResponse = PhysicsWorkerSuccessResponse | PhysicsWorkerErrorResponse


export function collectStepFrameTransferables(frame: PhysicsStepFrame): Transferable[] {
  const transferables: Transferable[] = [frame.bodyTransforms.buffer, frame.wheelTransforms.buffer]
  if (frame.bodyMeta) {
    transferables.push(frame.bodyMeta.buffer)
  }
  if (frame.bodyLinearVelocities) {
    transferables.push(frame.bodyLinearVelocities.buffer)
  }
  if (frame.bodyAngularVelocities) {
    transferables.push(frame.bodyAngularVelocities.buffer)
  }
  if (frame.bodySleeping) {
    transferables.push(frame.bodySleeping.buffer)
  }
  return transferables
}
