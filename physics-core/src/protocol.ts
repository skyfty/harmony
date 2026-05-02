import type {
  PhysicsBodyTransformCommand,
  PhysicsBridgeInitResult,
  PhysicsInitOptions,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsSceneAsset,
  PhysicsVehicleInputCommand,
} from './types'

export const PHYSICS_BODY_TRANSFORM_STRIDE = 8
export const PHYSICS_WHEEL_TRANSFORM_STRIDE = 9

export type PhysicsStepFrame = {
  frame: number
  bodyCount: number
  wheelCount: number
  bodyTransforms: Float32Array
  wheelTransforms: Float32Array
  bodyMeta?: Uint32Array
}

export type PhysicsWorkerRequest =
  | { id: number; type: 'init'; payload: PhysicsInitOptions }
  | { id: number; type: 'load-scene'; payload: PhysicsSceneAsset }
  | { id: number; type: 'step'; payload: { deltaMs: number } }
  | { id: number; type: 'set-body-transform'; payload: PhysicsBodyTransformCommand }
  | { id: number; type: 'set-vehicle-input'; payload: PhysicsVehicleInputCommand }
  | { id: number; type: 'raycast'; payload: PhysicsRaycastCommand }
  | { id: number; type: 'dispose-scene'; payload: null }
  | { id: number; type: 'destroy'; payload: null }

export type PhysicsWorkerSuccessResponse =
  | { id: number; ok: true; type: 'init'; payload: PhysicsBridgeInitResult }
  | { id: number; ok: true; type: 'load-scene'; payload: { bodyCount: number; vehicleCount: number } }
  | { id: number; ok: true; type: 'step'; payload: PhysicsStepFrame }
  | { id: number; ok: true; type: 'set-body-transform'; payload: null }
  | { id: number; ok: true; type: 'set-vehicle-input'; payload: null }
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

export function createEmptyStepFrame(frame = 0): PhysicsStepFrame {
  return {
    frame,
    bodyCount: 0,
    wheelCount: 0,
    bodyTransforms: new Float32Array(0),
    wheelTransforms: new Float32Array(0),
  }
}

export function collectStepFrameTransferables(frame: PhysicsStepFrame): Transferable[] {
  const transferables: Transferable[] = [frame.bodyTransforms.buffer, frame.wheelTransforms.buffer]
  if (frame.bodyMeta) {
    transferables.push(frame.bodyMeta.buffer)
  }
  return transferables
}
