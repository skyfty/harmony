import {
  collectStepFrameTransferables,
  createEmptyStepFrame,
  type PhysicsBridgeInitResult,
  type PhysicsInitOptions,
  type PhysicsRaycastHit,
  type PhysicsSceneAsset,
  type PhysicsStepFrame,
  type PhysicsWorkerRequest,
  type PhysicsWorkerResponse,
} from '@harmony/physics-core'

export interface PhysicsWorkerController {
  init(options: PhysicsInitOptions): Promise<PhysicsBridgeInitResult>
  loadScene(asset: PhysicsSceneAsset): Promise<{ bodyCount: number; vehicleCount: number }>
  step(deltaMs: number): Promise<PhysicsStepFrame>
  setBodyTransform(command: Extract<PhysicsWorkerRequest, { type: 'set-body-transform' }>['payload']): Promise<void>
  setVehicleInput(command: Extract<PhysicsWorkerRequest, { type: 'set-vehicle-input' }>['payload']): Promise<void>
  raycast(command: Extract<PhysicsWorkerRequest, { type: 'raycast' }>['payload']): Promise<PhysicsRaycastHit | null>
  disposeScene(): Promise<void>
  destroy(): Promise<void>
}

export function createNoopPhysicsWorkerController(): PhysicsWorkerController {
  let frame = 0
  let scene: PhysicsSceneAsset | null = null
  return {
    async init() {
      return {
        backend: 'noop',
        workerBacked: true,
      }
    },
    async loadScene(asset) {
      scene = asset
      return {
        bodyCount: asset.bodies.length,
        vehicleCount: asset.vehicles.length,
      }
    },
    async step() {
      frame += 1
      return createEmptyStepFrame(frame)
    },
    async setBodyTransform() {},
    async setVehicleInput() {},
    async raycast() {
      return null
    },
    async disposeScene() {
      scene = null
    },
    async destroy() {
      scene = null
    },
  }
}

function serializeError(id: number, error: unknown): PhysicsWorkerResponse {
  if (error instanceof Error) {
    return {
      id,
      ok: false,
      error: {
        message: error.message,
        stack: error.stack,
      },
    }
  }
  return {
    id,
    ok: false,
    error: {
      message: typeof error === 'string' ? error : 'Unknown physics worker error',
    },
  }
}

export function attachPhysicsWorkerRuntime(
  scope: Pick<DedicatedWorkerGlobalScope, 'onmessage' | 'postMessage'>,
  controller: PhysicsWorkerController,
): void {
  scope.onmessage = async (event: MessageEvent<PhysicsWorkerRequest>) => {
    const request = event.data
    try {
      switch (request.type) {
        case 'init': {
          const payload = await controller.init(request.payload)
          scope.postMessage({ id: request.id, ok: true, type: request.type, payload } satisfies PhysicsWorkerResponse)
          break
        }
        case 'load-scene': {
          const payload = await controller.loadScene(request.payload)
          scope.postMessage({ id: request.id, ok: true, type: request.type, payload } satisfies PhysicsWorkerResponse)
          break
        }
        case 'step': {
          const payload = await controller.step(request.payload.deltaMs)
          scope.postMessage(
            { id: request.id, ok: true, type: request.type, payload } satisfies PhysicsWorkerResponse,
            collectStepFrameTransferables(payload),
          )
          break
        }
        case 'set-body-transform': {
          await controller.setBodyTransform(request.payload)
          scope.postMessage({ id: request.id, ok: true, type: request.type, payload: null } satisfies PhysicsWorkerResponse)
          break
        }
        case 'set-vehicle-input': {
          await controller.setVehicleInput(request.payload)
          scope.postMessage({ id: request.id, ok: true, type: request.type, payload: null } satisfies PhysicsWorkerResponse)
          break
        }
        case 'raycast': {
          const payload = await controller.raycast(request.payload)
          scope.postMessage({ id: request.id, ok: true, type: request.type, payload } satisfies PhysicsWorkerResponse)
          break
        }
        case 'dispose-scene': {
          await controller.disposeScene()
          scope.postMessage({ id: request.id, ok: true, type: request.type, payload: null } satisfies PhysicsWorkerResponse)
          break
        }
        case 'destroy': {
          await controller.destroy()
          scope.postMessage({ id: request.id, ok: true, type: request.type, payload: null } satisfies PhysicsWorkerResponse)
          break
        }
        default: {
          const exhaustive: never = request
          throw new Error(`Unsupported physics worker message: ${String(exhaustive)}`)
        }
      }
    } catch (error) {
      scope.postMessage(serializeError(request.id, error))
    }
  }
}
