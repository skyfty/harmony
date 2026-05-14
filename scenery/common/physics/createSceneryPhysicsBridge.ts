import type {
  PhysicsAddRuntimeBodiesCommand,
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
import type { AmmoApi } from '@harmony/physics-ammo'
import type { PhysicsBackendBridge } from '@harmony/physics-bridge'
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime'
import { initializePhysicsBackendBridge } from '@harmony/physics-bridge/physicsBackendBridge'
import { createWechatPhysicsBridge, createInMemoryWechatPhysicsWorker } from '@harmony/physics-bridge/wechat'

type AmmoRuntimeModule = {
  createAmmoPhysicsController: (options: {
    moduleFactory: () => Promise<unknown>
  }) => PhysicsWorkerController
  createDefaultAmmoModuleFactory: <T>() => () => Promise<T>
  createAmmoSchemaPhysicsBackendBridge: (module: AmmoApi) => PhysicsBackendBridge
}

type CannonRuntimeModule = {
  createCannonPhysicsController: () => PhysicsWorkerController
  createCannonSchemaPhysicsBackendBridge: () => PhysicsBackendBridge
}

export type SceneryPhysicsBackendLoaders = {
  loadAmmoRuntime: () => Promise<AmmoRuntimeModule>
  loadCannonRuntime: () => Promise<CannonRuntimeModule>
}

export type CreateSceneryPhysicsBridgeOptions = {
  engine?: PhysicsBackendPreference
  backendLoaders?: SceneryPhysicsBackendLoaders
}

const PHYSICS_AMMO_SUBPACKAGE_NAME = 'physicsAmmo'
const PHYSICS_CANNON_SUBPACKAGE_NAME = 'physicsCannon'

function resolveSceneryPhysicsBackendPreference(preference: PhysicsBackendPreference | undefined): 'ammo' | 'cannon' {
  return preference === 'cannon' ? 'cannon' : 'ammo'
}

function ensureSceneryPhysicsBackendLoaders(
  loaders: SceneryPhysicsBackendLoaders | undefined,
): SceneryPhysicsBackendLoaders {
  if (!loaders) {
    throw new Error('Scenery physics backend loaders are required.')
  }
  return loaders
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
  private readonly backendLoaders: SceneryPhysicsBackendLoaders | undefined
  private bridge: PhysicsBridge | null = null
  private bridgePromise: Promise<PhysicsBridge> | null = null

  constructor(options: CreateSceneryPhysicsBridgeOptions = {}) {
    this.enginePreference = options.engine
    this.backendLoaders = options.backendLoaders
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
    const backendLoaders = ensureSceneryPhysicsBackendLoaders(this.backendLoaders)
    const backend = resolveSceneryPhysicsBackendPreference(this.enginePreference)
    if (backend === 'cannon') {
      await loadWechatPhysicsSubpackage(PHYSICS_CANNON_SUBPACKAGE_NAME)
      const cannonRuntime = await backendLoaders.loadCannonRuntime()
      const { createCannonPhysicsController, createCannonSchemaPhysicsBackendBridge } = cannonRuntime
      initializePhysicsBackendBridge(createCannonSchemaPhysicsBackendBridge())
      return createWechatPhysicsBridge({
        subpackageName: PHYSICS_CANNON_SUBPACKAGE_NAME,
        loadSubpackage: loadWechatPhysicsSubpackage,
        createWorker: () => createInMemoryWechatPhysicsWorker(createCannonPhysicsController()),
      })
    }

    await loadWechatPhysicsSubpackage(PHYSICS_AMMO_SUBPACKAGE_NAME)
    const ammoRuntime = await backendLoaders.loadAmmoRuntime()
    const {
      createAmmoPhysicsController,
      createDefaultAmmoModuleFactory,
      createAmmoSchemaPhysicsBackendBridge,
    } = ammoRuntime
    const ammoModuleFactory = createDefaultAmmoModuleFactory<AmmoApi>()
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
