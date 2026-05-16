import type {
  PhysicsAddRuntimeBodiesCommand,
  PhysicsBackendId,
  PhysicsBackendPreference,
  PhysicsBodyTransformCommand,
  PhysicsBridge,
  PhysicsBridgeInitResult,
  PhysicsInitOptions,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsRemoveRuntimeBodiesCommand,
  PhysicsSceneAsset,
  PhysicsStepFrame,
  PhysicsVehicleInputCommand,
} from '@harmony/physics-core'
import type { PhysicsBackendBridge } from '@harmony/physics-bridge'
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime'
import { initializePhysicsBackendBridge } from '@harmony/schema/physicsBackendBridge'
import { createInMemoryWechatPhysicsWorker, createWechatPhysicsBridge } from '@harmony/physics-bridge/wechat'

export type CreateSceneryPhysicsBridgeOptions = {
  engine?: PhysicsBackendPreference
}

class LazySceneryPhysicsBridge implements PhysicsBridge {
  private readonly options: CreateSceneryPhysicsBridgeOptions
  private bridge: PhysicsBridge | null = null
  private bridgePromise: Promise<PhysicsBridge> | null = null

  constructor(options: CreateSceneryPhysicsBridgeOptions = {}) {
    this.options = options
  }

  async init(options: PhysicsInitOptions): Promise<PhysicsBridgeInitResult> {
    const bridge = await this.ensureBridge()
    return bridge.init(options)
  }

  async loadScene(asset: PhysicsSceneAsset): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.loadScene(asset)
  }

  async step(deltaMs: number): Promise<PhysicsStepFrame> {
    const bridge = await this.ensureBridge()
    return bridge.step(deltaMs)
  }

  async setBodyTransform(command: PhysicsBodyTransformCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.setBodyTransform(command)
  }

  async setVehicleInput(command: PhysicsVehicleInputCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.setVehicleInput(command)
  }

  async addRuntimeBodies(command: PhysicsAddRuntimeBodiesCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.addRuntimeBodies(command)
  }

  async removeRuntimeBodies(command: PhysicsRemoveRuntimeBodiesCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.removeRuntimeBodies(command)
  }

  async raycast(command: PhysicsRaycastCommand): Promise<PhysicsRaycastHit | null> {
    const bridge = await this.ensureBridge()
    return bridge.raycast(command)
  }

  async disposeScene(): Promise<void> {
    if (!this.bridge) {
      return
    }
    await this.bridge.disposeScene()
  }

  async destroy(): Promise<void> {
    if (!this.bridge) {
      return
    }
    await this.bridge.destroy()
    this.bridge = null
    this.bridgePromise = null
  }

  private async ensureBridge(): Promise<PhysicsBridge> {
    if (this.bridge) {
      return this.bridge
    }
    if (!this.bridgePromise) {
      this.bridgePromise = this.createBridge()
    }
    this.bridge = await this.bridgePromise
    return this.bridge
  }

  private async createBridge(): Promise<PhysicsBridge> {
    const resolvedEngine = resolvePhysicsBackendId(this.options.engine)
    const backend = await loadPhysicsBackend(resolvedEngine)
    initializePhysicsBackendBridge(backend.schemaBridge)

    return createWechatPhysicsBridge({
      subpackageName: backend.subpackageName,
      loadSubpackage: loadWechatSubpackage,
      createWorker: () => createInMemoryWechatPhysicsWorker(backend.createController()),
    })
  }
}

export function createSceneryPhysicsBridge(options: CreateSceneryPhysicsBridgeOptions = {}): PhysicsBridge {
  return new LazySceneryPhysicsBridge(options)
}

function resolvePhysicsBackendId(engine: PhysicsBackendPreference | undefined): Extract<PhysicsBackendId, 'ammo' | 'cannon'> {
  return engine === 'ammo' ? 'ammo' : 'cannon'
}

function loadWechatSubpackage(name: string): Promise<void> {
  const wxAny = typeof wx !== 'undefined' ? (wx as typeof wx & { loadSubpackage?: (...args: any[]) => any }) : null
  if (!wxAny || typeof wxAny.loadSubpackage !== 'function') {
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const task = wxAny.loadSubpackage({
      name,
      success: () => resolve(),
      fail: (error: unknown) => reject(error),
    })
    task?.onError?.((error: unknown) => reject(error))
  })
}

type LoadedPhysicsBackend = {
  subpackageName: 'physics-ammo' | 'physics-cannon'
  schemaBridge: PhysicsBackendBridge
  createController: () => PhysicsWorkerController
}

async function loadPhysicsBackend(
  engine: Extract<PhysicsBackendId, 'ammo' | 'cannon'>,
): Promise<LoadedPhysicsBackend> {
  if (engine === 'ammo') {
    const ammoSource = await import('@harmony/physics-ammo-source')
    const moduleFactory = ammoSource.createDefaultAmmoModuleFactory()
    let ammoPromise: Promise<unknown> | null = null
    const loadAmmoModule = async () => {
      ammoPromise ??= moduleFactory()
      return ammoPromise
    }
    const ammo = await loadAmmoModule()
    return {
      subpackageName: 'physics-ammo',
      schemaBridge: ammoSource.createAmmoSchemaPhysicsBackendBridge(ammo as never),
      createController: () => ammoSource.createAmmoPhysicsController({ moduleFactory: loadAmmoModule }),
    }
  }

  const cannonSource = await import('@harmony/physics-cannon-source')
  return {
    subpackageName: 'physics-cannon',
    schemaBridge: cannonSource.createCannonSchemaPhysicsBackendBridge(),
    createController: () => cannonSource.createCannonPhysicsController(),
  }
}
