import type { PhysicsBackendBridge } from '@harmony/physics-bridge';
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime';
import type { createAmmoPhysicsController as CreateAmmoPhysicsController } from '../../../../physics-ammo/src/index';
import type { createAmmoSchemaPhysicsBackendBridge as CreateAmmoSchemaPhysicsBackendBridge } from '../../../../physics-ammo/src/index';
import ammoWasmUrl from './vendor/ammo.wasm.wasm?url';

export type LoadedAmmoPhysicsBackend = {
  schemaBridge: PhysicsBackendBridge;
  createController: () => PhysicsWorkerController;
};

type AmmoControllerModule = {
  createAmmoPhysicsController: typeof CreateAmmoPhysicsController;
};

type AmmoSchemaBridgeModule = {
  createAmmoSchemaPhysicsBackendBridge: typeof CreateAmmoSchemaPhysicsBackendBridge;
};

type AmmoBootstrapModule = {
  default?: (target?: Record<string, unknown>) => Promise<unknown>;
};

let ammoControllerModulePromise: Promise<AmmoControllerModule> | null = null;
let ammoSchemaBridgeModulePromise: Promise<AmmoSchemaBridgeModule> | null = null;
let ammoBootstrapModulePromise: Promise<AmmoBootstrapModule> | null = null;

function loadAmmoControllerModule(): Promise<AmmoControllerModule> {
  ammoControllerModulePromise ??= import('../../../../physics-ammo/src/index');
  return ammoControllerModulePromise;
}

function loadAmmoSchemaBridgeModule(): Promise<AmmoSchemaBridgeModule> {
  ammoSchemaBridgeModulePromise ??= import('../../../../physics-ammo/src/index');
  return ammoSchemaBridgeModulePromise;
}

function loadAmmoBootstrapModule(): Promise<AmmoBootstrapModule> {
  ammoBootstrapModulePromise ??= import('./vendor/ammo.wasm.js');
  return ammoBootstrapModulePromise;
}

function resolveAmmoBootstrapFactory(module: AmmoBootstrapModule): (target?: Record<string, unknown>) => Promise<unknown> {
  if (typeof module.default === 'function') {
    return module.default;
  }
  throw new Error('Invalid Ammo bootstrap module');
}

export async function createAmmoPhysicsBackend(): Promise<LoadedAmmoPhysicsBackend> {
  const [controllerModule, schemaBridgeModule] = await Promise.all([
    loadAmmoControllerModule(),
    loadAmmoSchemaBridgeModule(),
  ]);
  let ammoPromise: Promise<unknown> | null = null;
  const moduleFactory = async () => {
    ammoPromise ??= loadAmmoBootstrapModule().then((module) => {
      const bootstrap = resolveAmmoBootstrapFactory(module);
      return bootstrap.call(globalThis, {
        locateFile(path: string) {
          if (path === 'ammo.wasm.wasm') {
            return ammoWasmUrl;
          }
          return path;
        },
      });
    });
    return ammoPromise;
  };
  const ammo = await moduleFactory();

  return {
    schemaBridge: schemaBridgeModule.createAmmoSchemaPhysicsBackendBridge(ammo as never),
    createController: () => controllerModule.createAmmoPhysicsController({ moduleFactory }),
  };
}
