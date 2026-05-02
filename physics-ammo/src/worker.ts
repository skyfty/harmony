import { attachPhysicsWorkerRuntime, type PhysicsWorkerController } from '@harmony/physics-bridge'
import { createAmmoPhysicsController, type CreateAmmoPhysicsControllerOptions } from './controller'

export function attachAmmoPhysicsWorkerRuntime<TAmmoModule>(
  scope: Pick<DedicatedWorkerGlobalScope, 'onmessage' | 'postMessage'>,
  options: CreateAmmoPhysicsControllerOptions<TAmmoModule>,
): PhysicsWorkerController {
  const controller = createAmmoPhysicsController(options)
  attachPhysicsWorkerRuntime(scope, controller)
  return controller
}
