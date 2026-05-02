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
} from '@harmony/physics-core'

type WechatRuntimeBridgeModule = typeof import('@harmony/physics-host-wechat')
type AmmoRuntimeModule = typeof import('@harmony/physics-ammo')

async function loadWechatPhysicsSubpackage(name: string): Promise<void> {
  const wxLike = globalThis as {
    wx?: {
      loadSubpackage?: (options: {
        name: string
        success?: () => void
        fail?: (error: unknown) => void
      }) => void
    }
  }
  const loadSubpackage = wxLike.wx?.loadSubpackage
  if (typeof loadSubpackage !== 'function') {
    return
  }
  await new Promise<void>((resolve, reject) => {
    loadSubpackage({
      name,
      success: () => resolve(),
      fail: (error) => reject(error),
    })
  })
}

class LazySceneryPhysicsBridge implements PhysicsBridge {
  private bridge: PhysicsBridge | null = null
  private bridgePromise: Promise<PhysicsBridge> | null = null

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
    await loadWechatPhysicsSubpackage('physics')
    const [{ createWechatPhysicsBridge, createInMemoryWechatPhysicsWorker }, { createAmmoPhysicsController, createDefaultAmmoModuleFactory }] =
      await Promise.all([
        import('@harmony/physics-host-wechat') as Promise<WechatRuntimeBridgeModule>,
        import('@harmony/physics-ammo') as Promise<AmmoRuntimeModule>,
      ])

    return createWechatPhysicsBridge({
      subpackageName: 'physics',
      loadSubpackage: loadWechatPhysicsSubpackage,
      createWorker: () => createInMemoryWechatPhysicsWorker(createAmmoPhysicsController({
        moduleFactory: createDefaultAmmoModuleFactory(),
      })),
    })
  }
}

export function createSceneryPhysicsBridge(): PhysicsBridge {
  return new LazySceneryPhysicsBridge()
}
