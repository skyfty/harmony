import {
  collectStepFrameTransferables,
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
  addRuntimeBodies(command: Extract<PhysicsWorkerRequest, { type: 'add-runtime-bodies' }>['payload']): Promise<void>
  removeRuntimeBodies(command: Extract<PhysicsWorkerRequest, { type: 'remove-runtime-bodies' }>['payload']): Promise<void>
  raycast(command: Extract<PhysicsWorkerRequest, { type: 'raycast' }>['payload']): Promise<PhysicsRaycastHit | null>
  disposeScene(): Promise<void>
  destroy(): Promise<void>
}

export function createNoopPhysicsWorkerController(): PhysicsWorkerController {
  let frame = 0
  return {
    async init() {
      return {
        backend: 'noop',
        workerBacked: true,
      }
    },
    async loadScene(asset) {
      return {
        bodyCount: asset.bodies.length,
        vehicleCount: asset.vehicles.length,
      }
    },
    async step() {
      frame += 1
      return {
        frame: frame,
        bodyCount: 0,
        wheelCount: 0,
        bodyTransforms: new Float32Array(0),
        wheelTransforms: new Float32Array(0),
      };
    },
    async setBodyTransform() {},
    async setVehicleInput() {},
    async addRuntimeBodies() {},
    async removeRuntimeBodies() {},
    async raycast() {
      return null
    },
    async disposeScene() {
    },
    async destroy() {
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
  scope: {
    onmessage: ((event: MessageEvent<PhysicsWorkerRequest>) => void) | null
    postMessage: (message: PhysicsWorkerResponse, transferables?: Transferable[]) => void
  },
  controller: PhysicsWorkerController,
): void {
  let requestChain = Promise.resolve()
  scope.onmessage = (event: MessageEvent<PhysicsWorkerRequest>) => {
    const request = event.data
    // Keep worker requests strictly ordered so stateful controllers do not
    // overlap init/load/dispose/destroy work for the same physics world.
    requestChain = requestChain
      .then(async () => {
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
            case 'add-runtime-bodies': {
              await controller.addRuntimeBodies(request.payload)
              scope.postMessage({ id: request.id, ok: true, type: request.type, payload: null } satisfies PhysicsWorkerResponse)
              break
            }
            case 'remove-runtime-bodies': {
              await controller.removeRuntimeBodies(request.payload)
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
      })
      .catch(() => {})
  }
}
