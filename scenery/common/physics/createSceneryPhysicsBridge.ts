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
import { createCannonPhysicsController, createCannonSchemaPhysicsBackendBridge } from '@harmony/physics-cannon'
import { initializePhysicsBackendBridge } from '@harmony/schema/physicsBackendBridge'
import { createInMemoryWechatPhysicsWorker, createWechatPhysicsBridge } from '@harmony/physics-bridge/wechat'

export type CreateSceneryPhysicsBridgeOptions = {
  engine?: PhysicsBackendPreference
}

class LazySceneryPhysicsBridge implements PhysicsBridge {
  private bridge: PhysicsBridge | null = null
  private bridgePromise: Promise<PhysicsBridge> | null = null

  constructor(_options: CreateSceneryPhysicsBridgeOptions = {}) {}

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
    initializePhysicsBackendBridge(createCannonSchemaPhysicsBackendBridge())
    return createWechatPhysicsBridge({
      subpackageName: 'scenery',
      loadSubpackage: async () => {},
      createWorker: () => createInMemoryWechatPhysicsWorker(createCannonPhysicsController()),
    })
  }
}

export function createSceneryPhysicsBridge(options: CreateSceneryPhysicsBridgeOptions = {}): PhysicsBridge {
  return new LazySceneryPhysicsBridge(options)
}
