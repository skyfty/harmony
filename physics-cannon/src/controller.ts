import type { PhysicsBridgeInitResult, PhysicsInitOptions, PhysicsRaycastHit, PhysicsSceneAsset } from '@harmony/physics-core'
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime'
import { CannonPhysicsWorld } from './world'

export function createCannonPhysicsController(): PhysicsWorkerController {
  const world = new CannonPhysicsWorld()
  let initialized = false

  return {
    async init(initOptions: PhysicsInitOptions): Promise<PhysicsBridgeInitResult> {
      world.setWorldSettings(initOptions.world)
      initialized = true
      return {
        backend: 'cannon',
        workerBacked: true,
      }
    },
    async loadScene(asset: PhysicsSceneAsset) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      return world.loadScene(asset)
    },
    async step(deltaMs) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      return world.step(deltaMs)
    },
    async setBodyTransform(command) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      world.setBodyTransform(command)
    },
    async setVehicleInput(command) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      world.setVehicleInput(command)
    },
    async raycast(command): Promise<PhysicsRaycastHit | null> {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      return world.raycast(command)
    },
    async disposeScene() {
      world.disposeScene()
    },
    async destroy() {
      world.disposeWorld()
    },
  }
}
