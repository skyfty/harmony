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
import { initializePhysicsBackendBridge } from '@harmony/physics-bridge/physicsBackendBridge'
import { createWechatPhysicsBridge, createInMemoryWechatPhysicsWorker } from '@harmony/physics-bridge/wechat'

type AmmoRuntimeModule = typeof import('@harmony/physics-ammo')
type CannonRuntimeModule = typeof import('@harmony/physics-cannon')

export type CreateSceneryPhysicsBridgeOptions = {
  engine?: PhysicsBackendPreference
}

const PHYSICS_AMMO_SUBPACKAGE_NAME = 'physicsAmmo'
const PHYSICS_CANNON_SUBPACKAGE_NAME = 'physicsCannon'

function resolveSceneryPhysicsBackendPreference(preference: PhysicsBackendPreference | undefined): 'ammo' | 'cannon' {
  return preference === 'cannon' ? 'cannon' : 'ammo'
}

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
  private readonly enginePreference: PhysicsBackendPreference | undefined
  private bridge: PhysicsBridge | null = null
  private bridgePromise: Promise<PhysicsBridge> | null = null

  constructor(options: CreateSceneryPhysicsBridgeOptions = {}) {
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
    const backend = resolveSceneryPhysicsBackendPreference(this.enginePreference)
    if (backend === 'cannon') {
      await loadWechatPhysicsSubpackage(PHYSICS_CANNON_SUBPACKAGE_NAME)
      const cannonRuntime = await import('@harmony/physics-cannon') as CannonRuntimeModule
      const { createCannonPhysicsController, createCannonSchemaPhysicsBackendBridge } = cannonRuntime
      initializePhysicsBackendBridge(createCannonSchemaPhysicsBackendBridge())
      return createWechatPhysicsBridge({
        subpackageName: PHYSICS_CANNON_SUBPACKAGE_NAME,
        loadSubpackage: loadWechatPhysicsSubpackage,
        createWorker: () => createInMemoryWechatPhysicsWorker(createCannonPhysicsController()),
      })
    }

    await loadWechatPhysicsSubpackage(PHYSICS_AMMO_SUBPACKAGE_NAME)
    const ammoRuntime = await import('@harmony/physics-ammo') as AmmoRuntimeModule
    const {
      createAmmoPhysicsController,
      createDefaultAmmoModuleFactory,
      createAmmoSchemaPhysicsBackendBridge,
    } = ammoRuntime
    const ammoModuleFactory = createDefaultAmmoModuleFactory()
    const ammoModule = await ammoModuleFactory()
    initializePhysicsBackendBridge(createAmmoSchemaPhysicsBackendBridge(ammoModule))

    return createWechatPhysicsBridge({
      subpackageName: PHYSICS_AMMO_SUBPACKAGE_NAME,
      loadSubpackage: loadWechatPhysicsSubpackage,
      createWorker: () => createInMemoryWechatPhysicsWorker(createAmmoPhysicsController({
        moduleFactory: () => Promise.resolve(ammoModule),
      })),
    })
  }
}

export function createSceneryPhysicsBridge(options: CreateSceneryPhysicsBridgeOptions = {}): PhysicsBridge {
  return new LazySceneryPhysicsBridge(options)
}
