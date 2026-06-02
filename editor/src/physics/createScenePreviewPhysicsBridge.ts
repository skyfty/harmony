import type {
  PhysicsAddRuntimeBodiesCommand,
  PhysicsBackendPreference,
  PhysicsBodyTransformCommand,
  PhysicsBodyVelocityCommand,
  PhysicsBridge,
  PhysicsBridgeInitResult,
  PhysicsCharacterInputCommand,
  PhysicsInitOptions,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsRemoveRuntimeBodiesCommand,
  PhysicsSceneAsset,
  PhysicsStepFrame,
  PhysicsVehicleInputCommand,
} from '@harmony/physics-core'
import type { AmmoApi } from '@harmony/physics-ammo'
import { initializePhysicsBackendBridge } from '@harmony/physics-bridge/physicsBackendBridge'
import { createWebPhysicsBridge, createInMemoryWebPhysicsWorker } from '@harmony/physics-bridge/web'
import type * as CANNON from 'cannon-es'

type AmmoRuntimeModule = typeof import('@harmony/physics-ammo')
type CannonRuntimeModule = typeof import('@harmony/physics-cannon')

export type CreateScenePreviewPhysicsBridgeOptions = {
  engine?: PhysicsBackendPreference
  onCannonWorldReady?: (world: CANNON.World | null) => void
}

function resolveEditorPhysicsBackendPreference(preference: PhysicsBackendPreference | undefined): 'ammo' | 'cannon' {
  return preference === 'cannon' ? 'cannon' : 'ammo'
}

class LazyScenePreviewPhysicsBridge implements PhysicsBridge {
  private readonly enginePreference: PhysicsBackendPreference | undefined
  private readonly onCannonWorldReady: ((world: CANNON.World | null) => void) | undefined
  private bridge: PhysicsBridge | null = null
  private bridgePromise: Promise<PhysicsBridge> | null = null

  constructor(options: CreateScenePreviewPhysicsBridgeOptions = {}) {
    this.enginePreference = options.engine
    this.onCannonWorldReady = options.onCannonWorldReady
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

  async setBodyVelocity(command: PhysicsBodyVelocityCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.setBodyVelocity(command)
  }

  async setVehicleInput(command: PhysicsVehicleInputCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.setVehicleInput(command)
  }

  async setCharacterInput(command: PhysicsCharacterInputCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.setCharacterInput(command)
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
    const backend = resolveEditorPhysicsBackendPreference(this.enginePreference)
    if (backend === 'cannon') {
      const cannonRuntime = await import('@harmony/physics-cannon') as CannonRuntimeModule
      const { createCannonPhysicsController, createCannonSchemaPhysicsBackendBridge } = cannonRuntime
      initializePhysicsBackendBridge(createCannonSchemaPhysicsBackendBridge())
      return createWebPhysicsBridge({
        workerFactory: () => createInMemoryWebPhysicsWorker(createCannonPhysicsController({
          onWorldReady: this.onCannonWorldReady,
        })),
      })
    }

    const ammoRuntime = await import('@harmony/physics-ammo') as AmmoRuntimeModule
    const {
      createAmmoPhysicsController,
      createDefaultAmmoModuleFactory,
      createAmmoSchemaPhysicsBackendBridge,
    } = ammoRuntime
    const ammoModuleFactory = createDefaultAmmoModuleFactory<AmmoApi>()
    const ammoModule = await ammoModuleFactory()
    if (!ammoModule) {
      throw new Error('Failed to load Ammo physics module')
    }
    initializePhysicsBackendBridge(createAmmoSchemaPhysicsBackendBridge(ammoModule))

    return createWebPhysicsBridge({
      workerFactory: () => createInMemoryWebPhysicsWorker(createAmmoPhysicsController({
        moduleFactory: () => Promise.resolve(ammoModule),
      })),
    })
  }
}

export function createScenePreviewPhysicsBridge(options: CreateScenePreviewPhysicsBridgeOptions = {}): PhysicsBridge {
  return new LazyScenePreviewPhysicsBridge(options)
}
