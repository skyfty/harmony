import type { PhysicsBridgeInitResult, PhysicsInitOptions, PhysicsRaycastHit, PhysicsSceneAsset } from '@harmony/physics-core'
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime'
import type * as CANNON from 'cannon-es'
import { CannonPhysicsWorld } from './world'

export type CreateCannonPhysicsControllerOptions = {
  onWorldReady?: (world: CANNON.World | null) => void
}

export function createCannonPhysicsController(options: CreateCannonPhysicsControllerOptions = {}): PhysicsWorkerController {
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
      const payload = world.loadScene(asset)
      options.onWorldReady?.(world.getWorld())
      return payload
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
    async setBodyVelocity(command) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      world.setBodyVelocity(command)
    },
    async setVehicleInput(command) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      world.setVehicleInput(command)
    },
    async setCharacterInput(command) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      world.setCharacterInput(command)
    },
    async addRuntimeBodies(command) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      world.addRuntimeBodies(command)
    },
    async removeRuntimeBodies(command) {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      world.removeRuntimeBodies(command)
    },
    async raycast(command): Promise<PhysicsRaycastHit | null> {
      if (!initialized) {
        throw new Error('Cannon physics controller is not initialized')
      }
      return world.raycast(command)
    },
    async disposeScene() {
      world.disposeScene()
      options.onWorldReady?.(world.getWorld())
    },
    async destroy() {
      world.disposeWorld()
      options.onWorldReady?.(null)
    },
  }
}
