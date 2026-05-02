import type { PhysicsBridgeInitResult, PhysicsInitOptions, PhysicsRaycastHit, PhysicsSceneAsset } from '@harmony/physics-core'
import type { PhysicsWorkerController } from '@harmony/physics-worker-runtime'
import { AmmoModuleLoader, type AmmoModuleFactory } from './ammoLoader'
import { AmmoPhysicsWorld } from './world'

export type CreateAmmoPhysicsControllerOptions<TAmmoModule> = {
  moduleFactory: AmmoModuleFactory<TAmmoModule>
}

export function createAmmoPhysicsController<TAmmoModule>(
  options: CreateAmmoPhysicsControllerOptions<TAmmoModule>,
): PhysicsWorkerController {
  const loader = new AmmoModuleLoader(options.moduleFactory)
  const world = new AmmoPhysicsWorld()
  let initialized = false

  return {
    async init(_initOptions: PhysicsInitOptions): Promise<PhysicsBridgeInitResult> {
      await loader.load()
      initialized = true
      return {
        backend: 'ammo',
        workerBacked: true,
      }
    },
    async loadScene(asset: PhysicsSceneAsset) {
      if (!initialized) {
        throw new Error('Ammo physics controller is not initialized')
      }
      return world.loadScene(asset)
    },
    async step(deltaMs) {
      if (!initialized) {
        throw new Error('Ammo physics controller is not initialized')
      }
      return world.step(deltaMs)
    },
    async setBodyTransform(command) {
      if (!initialized) {
        throw new Error('Ammo physics controller is not initialized')
      }
      world.setBodyTransform(command)
    },
    async setVehicleInput(command) {
      if (!initialized) {
        throw new Error('Ammo physics controller is not initialized')
      }
      world.setVehicleInput(command)
    },
    async raycast(): Promise<PhysicsRaycastHit | null> {
      return null
    },
    async disposeScene() {
      world.disposeScene()
    },
    async destroy() {
      world.disposeScene()
    },
  }
}
