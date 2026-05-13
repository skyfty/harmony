import { attachPhysicsWorkerRuntime, type PhysicsWorkerController } from '@harmony/physics-bridge'
import { createAmmoPhysicsController, type CreateAmmoPhysicsControllerOptions } from './controller'

type WorkerScopeLike = {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (message: unknown, transferables?: Transferable[]) => void
}

export function attachAmmoPhysicsWorkerRuntime<TAmmoModule>(
  scope: WorkerScopeLike,
  options: CreateAmmoPhysicsControllerOptions<TAmmoModule>,
): PhysicsWorkerController {
  const controller = createAmmoPhysicsController(options)
  attachPhysicsWorkerRuntime(scope, controller)
  return controller
}
