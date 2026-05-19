import type { PhysicsBackendBridge } from '@harmony/physics-bridge';
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime';
import type { createCannonPhysicsController as CreateCannonPhysicsController } from '../../../../physics-cannon/src/index';
import type { createCannonSchemaPhysicsBackendBridge as CreateCannonSchemaPhysicsBackendBridge } from '../../../../physics-cannon/src/index';
export { loadCannonDebuggerPro, type CannonDebuggerConstructor } from '../../../../physics-cannon/src/index';

export type LoadedCannonPhysicsBackend = {
  schemaBridge: PhysicsBackendBridge;
  createController: () => PhysicsWorkerController;
};

type CannonControllerModule = {
  createCannonPhysicsController: typeof CreateCannonPhysicsController;
};

type CannonSchemaBridgeModule = {
  createCannonSchemaPhysicsBackendBridge: typeof CreateCannonSchemaPhysicsBackendBridge;
};

let cannonControllerModulePromise: Promise<CannonControllerModule> | null = null;
let cannonSchemaBridgeModulePromise: Promise<CannonSchemaBridgeModule> | null = null;

function loadCannonControllerModule(): Promise<CannonControllerModule> {
  cannonControllerModulePromise ??= import('../../../../physics-cannon/src/index');
  return cannonControllerModulePromise;
}

function loadCannonSchemaBridgeModule(): Promise<CannonSchemaBridgeModule> {
  cannonSchemaBridgeModulePromise ??= import('../../../../physics-cannon/src/index');
  return cannonSchemaBridgeModulePromise;
}

export async function createCannonPhysicsBackend(): Promise<LoadedCannonPhysicsBackend> {
  const [controllerModule, schemaBridgeModule] = await Promise.all([
    loadCannonControllerModule(),
    loadCannonSchemaBridgeModule(),
  ]);
  return {
    schemaBridge: schemaBridgeModule.createCannonSchemaPhysicsBackendBridge(),
    createController: () => controllerModule.createCannonPhysicsController(),
  };
}
