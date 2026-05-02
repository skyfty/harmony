import type { PhysicsBridgeInitResult, PhysicsInitOptions, PhysicsRaycastHit, PhysicsSceneAsset } from '@harmony/physics-core'
import type { PhysicsWorkerController } from '@harmony/physics-bridge'
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
    async init(initOptions: PhysicsInitOptions): Promise<PhysicsBridgeInitResult> {
      const ammo = await loader.load()
      world.setModule(ammo)
      world.setWorldSettings(initOptions.world)
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
    async raycast(command): Promise<PhysicsRaycastHit | null> {
      if (!initialized) {
        throw new Error('Ammo physics controller is not initialized')
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
