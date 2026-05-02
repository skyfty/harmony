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
import { attachPhysicsWorkerRuntime, createNoopPhysicsWorkerController, type PhysicsWorkerController } from '@harmony/physics-worker-runtime'

export type WechatWorkerLike = {
  postMessage: (message: PhysicsWorkerRequest) => void
  terminate: () => void
  onMessage: (callback: (event: { data: PhysicsWorkerResponse }) => void) => void
}

export type CreateWechatPhysicsBridgeOptions = {
  subpackageName: string
  loadSubpackage: (name: string) => Promise<void>
  createWorker: () => WechatWorkerLike
}

type InMemoryWorkerScope = {
  onmessage: ((event: MessageEvent<PhysicsWorkerRequest>) => void) | null
  postMessage: (message: PhysicsWorkerResponse, transferables?: Transferable[]) => void
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

class WechatPhysicsBridge implements PhysicsBridge {
  private readonly options: CreateWechatPhysicsBridgeOptions
  private worker: WechatWorkerLike | null = null
  private nextRequestId = 1
  private pendingRequests = new Map<number, PendingRequest>()

  constructor(options: CreateWechatPhysicsBridgeOptions) {
    this.options = options
  }

  async init(options: PhysicsInitOptions): Promise<PhysicsBridgeInitResult> {
    if (!this.worker) {
      await this.options.loadSubpackage(this.options.subpackageName)
      this.worker = this.options.createWorker()
      this.worker.onMessage((event) => this.handleWorkerMessage(event.data))
    }
    return this.request('init', options)
  }

  async loadScene(asset: PhysicsSceneAsset): Promise<void> {
    await this.request('load-scene', asset)
  }

  async step(deltaMs: number): Promise<PhysicsStepFrame> {
    return this.request('step', { deltaMs })
  }

  async setBodyTransform(command: PhysicsBodyTransformCommand): Promise<void> {
    await this.request('set-body-transform', command)
  }

  async setVehicleInput(command: PhysicsVehicleInputCommand): Promise<void> {
    await this.request('set-vehicle-input', command)
  }

  async raycast(command: PhysicsRaycastCommand): Promise<PhysicsRaycastHit | null> {
    return this.request('raycast', command)
  }

  async disposeScene(): Promise<void> {
    await this.request('dispose-scene', null)
  }

  async destroy(): Promise<void> {
    if (!this.worker) {
      return
    }
    await this.request('destroy', null)
    this.worker.terminate()
    this.worker = null
  }

  private request<TRequest extends PhysicsWorkerRequest['type']>(
    type: TRequest,
    payload: Extract<PhysicsWorkerRequest, { type: TRequest }>['payload'],
  ): Promise<Extract<PhysicsWorkerResponse, { ok: true; type: TRequest }>['payload']> {
    if (!this.worker) {
      return Promise.reject(new Error('Physics wechat bridge is not initialized'))
    }
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.worker?.postMessage({ id, type, payload } as Extract<PhysicsWorkerRequest, { type: TRequest }>)
    })
  }

  private handleWorkerMessage(response: PhysicsWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      return
    }
    this.pendingRequests.delete(response.id)
    if (!response.ok) {
      pending.reject(new Error(response.error.message))
      return
    }
    pending.resolve(response.payload)
  }
}

export function createWechatPhysicsBridge(options: CreateWechatPhysicsBridgeOptions): PhysicsBridge {
  return new WechatPhysicsBridge(options)
}

export function createInMemoryWechatPhysicsWorker(
  controller: PhysicsWorkerController = createNoopPhysicsWorkerController(),
): WechatWorkerLike {
  let terminated = false
  let hostListener: ((event: { data: PhysicsWorkerResponse }) => void) | null = null
  const host: WechatWorkerLike = {
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
      hostListener = null
      scope.onmessage = null
    },
    onMessage(callback) {
      hostListener = callback
    },
  }

  const scope: InMemoryWorkerScope = {
    onmessage: null,
    postMessage(message) {
      if (terminated || !hostListener) {
        return
      }
      queueMicrotask(() => {
        if (!terminated) {
          hostListener?.({ data: message })
        }
      })
    },
  }

  attachPhysicsWorkerRuntime(scope, controller)
  return host
}

export function createNoopWechatPhysicsBridge(subpackageName = 'physics'): PhysicsBridge {
  return createWechatPhysicsBridge({
    subpackageName,
    async loadSubpackage() {},
    createWorker: () => createInMemoryWechatPhysicsWorker(),
  })
}
