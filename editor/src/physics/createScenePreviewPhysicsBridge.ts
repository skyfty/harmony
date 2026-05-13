import type {
  PhysicsBackendPreference,
  PhysicsBodyTransformCommand,
  PhysicsBridge,
  PhysicsBridgeInitResult,
  PhysicsInitOptions,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsSceneAsset,
  PhysicsStepFrame,
  PhysicsVehicleInputCommand,
} from '@harmony/physics-core'

type BridgeRuntimeModule = typeof import('@harmony/physics-bridge')
type AmmoRuntimeModule = typeof import('@harmony/physics-ammo')
type CannonRuntimeModule = typeof import('@harmony/physics-cannon')

export type CreateScenePreviewPhysicsBridgeOptions = {
  engine?: PhysicsBackendPreference
}

function resolveEditorPhysicsBackendPreference(preference: PhysicsBackendPreference | undefined): 'ammo' | 'cannon' {
  if (preference === 'ammo' || preference === 'cannon') {
    return preference
  }
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search)
      const queryValue = params.get('physicsEngine')
      if (queryValue === 'ammo' || queryValue === 'cannon') {
        return queryValue
      }
      const storedValue = window.localStorage.getItem('harmony:editor:physics-engine')
      if (storedValue === 'ammo' || storedValue === 'cannon') {
        return storedValue
      }
    } catch {
    }
  }
  return 'ammo'
}

class LazyScenePreviewPhysicsBridge implements PhysicsBridge {
  private readonly enginePreference: PhysicsBackendPreference | undefined
  private bridge: PhysicsBridge | null = null
  private bridgePromise: Promise<PhysicsBridge> | null = null

  constructor(options: CreateScenePreviewPhysicsBridgeOptions = {}) {
    this.enginePreference = options.engine
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
    const backend = resolveEditorPhysicsBackendPreference(this.enginePreference)
    if (backend === 'cannon') {
      const [{ createWebPhysicsBridge, createInMemoryWebPhysicsWorker }, { createCannonPhysicsController }] =
        await Promise.all([
          import('@harmony/physics-bridge') as Promise<BridgeRuntimeModule>,
          import('@harmony/physics-cannon') as Promise<CannonRuntimeModule>,
        ])
      return createWebPhysicsBridge({
        workerFactory: () => createInMemoryWebPhysicsWorker(createCannonPhysicsController()),
      })
    }

    const [{ createWebPhysicsBridge, createInMemoryWebPhysicsWorker }, { createAmmoPhysicsController, createDefaultAmmoModuleFactory }] =
      await Promise.all([
        import('@harmony/physics-bridge') as Promise<BridgeRuntimeModule>,
        import('@harmony/physics-ammo') as Promise<AmmoRuntimeModule>,
      ])

    return createWebPhysicsBridge({
      workerFactory: () => createInMemoryWebPhysicsWorker(createAmmoPhysicsController({
        moduleFactory: createDefaultAmmoModuleFactory(),
      })),
    })
  }
}

export function createScenePreviewPhysicsBridge(options: CreateScenePreviewPhysicsBridgeOptions = {}): PhysicsBridge {
  return new LazyScenePreviewPhysicsBridge(options)
}
