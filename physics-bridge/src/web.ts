import type {
  PhysicsBodyTransformCommand,
  PhysicsBridge,
  PhysicsBridgeInitResult,
  PhysicsInitOptions,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsSceneAsset,
  PhysicsStepFrame,
  PhysicsVehicleInputCommand,
  PhysicsWorkerRequest,
  PhysicsWorkerResponse,
} from '@harmony/physics-core'
import { attachPhysicsWorkerRuntime, createNoopPhysicsWorkerController, type PhysicsWorkerController } from './runtime'

export type PhysicsWebWorkerLike = {
  postMessage: (message: PhysicsWorkerRequest) => void
  terminate: () => void
  onmessage: ((event: MessageEvent<PhysicsWorkerResponse>) => void) | null
}

export type CreateWebPhysicsBridgeOptions = {
  workerFactory: () => PhysicsWebWorkerLike
}

type InMemoryWorkerScope = {
  onmessage: ((event: MessageEvent<PhysicsWorkerRequest>) => void) | null
  postMessage: (message: PhysicsWorkerResponse, transferables?: Transferable[]) => void
}

type PendingRequest<TPayload = unknown> = {
  resolve: (value: TPayload) => void
  reject: (error: Error) => void
}

class WebPhysicsBridge implements PhysicsBridge {
  private readonly workerFactory: () => PhysicsWebWorkerLike
  private worker: PhysicsWebWorkerLike | null = null
  private nextRequestId = 1
  private pendingRequests = new Map<number, PendingRequest>()

  constructor(options: CreateWebPhysicsBridgeOptions) {
    this.workerFactory = options.workerFactory
  }

  async init(options: PhysicsInitOptions): Promise<PhysicsBridgeInitResult> {
    if (!this.worker) {
      this.worker = this.workerFactory()
      this.worker.onmessage = (event) => this.handleWorkerMessage(event)
    }
    return this.request('init', options) as Promise<PhysicsBridgeInitResult>
  }

  async loadScene(asset: PhysicsSceneAsset): Promise<void> {
    await this.request('load-scene', asset)
  }

  async step(deltaMs: number): Promise<PhysicsStepFrame> {
    return this.request('step', { deltaMs }) as Promise<PhysicsStepFrame>
  }

  async setBodyTransform(command: PhysicsBodyTransformCommand): Promise<void> {
    await this.request('set-body-transform', command)
  }

  async setVehicleInput(command: PhysicsVehicleInputCommand): Promise<void> {
    await this.request('set-vehicle-input', command)
  }

  async raycast(command: PhysicsRaycastCommand): Promise<PhysicsRaycastHit | null> {
    return this.request('raycast', command) as Promise<PhysicsRaycastHit | null>
  }

  async disposeScene(): Promise<void> {
    await this.request('dispose-scene', null)
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      await this.request('destroy', null)
      this.worker.terminate()
      this.worker = null
    }
  }

  private request<TRequest extends PhysicsWorkerRequest['type']>(
    type: TRequest,
    payload: Extract<PhysicsWorkerRequest, { type: TRequest }>['payload'],
  ): Promise<unknown> {
    if (!this.worker) {
      return Promise.reject(new Error('Physics web bridge is not initialized'))
    }
    const id = this.nextRequestId++
    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.worker?.postMessage({ id, type, payload } as Extract<PhysicsWorkerRequest, { type: TRequest }>)
    })
  }

  private handleWorkerMessage(event: MessageEvent<PhysicsWorkerResponse>): void {
    const response = event.data
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      return
    }
    this.pendingRequests.delete(response.id)
    if (!response.ok) {
      pending.reject(new Error(response.error.message))
      return
    }
    pending.resolve(response.payload as never)
  }
}

export function createWebPhysicsBridge(options: CreateWebPhysicsBridgeOptions): PhysicsBridge {
  return new WebPhysicsBridge(options)
}

export function createInMemoryWebPhysicsWorker(
  controller: PhysicsWorkerController = createNoopPhysicsWorkerController(),
): PhysicsWebWorkerLike {
  let terminated = false
  const host: PhysicsWebWorkerLike = {
    onmessage: null,
    postMessage(message) {
      if (terminated || !scope.onmessage) {
        return
      }
      queueMicrotask(() => {
        if (!terminated) {
          scope.onmessage?.({ data: message } as MessageEvent<PhysicsWorkerRequest>)
        }
      })
    },
    terminate() {
      terminated = true
      host.onmessage = null
      scope.onmessage = null
    },
  }

  const scope: InMemoryWorkerScope = {
    onmessage: null,
    postMessage(message) {
      if (terminated) {
        return
      }
      queueMicrotask(() => {
        if (!terminated) {
          host.onmessage?.({ data: message } as MessageEvent<PhysicsWorkerResponse>)
        }
      })
    },
  }

  attachPhysicsWorkerRuntime(scope, controller)
  return host
}

export function createNoopWebPhysicsBridge(): PhysicsBridge {
  return createWebPhysicsBridge({
    workerFactory: () => createInMemoryWebPhysicsWorker(),
  })
}
