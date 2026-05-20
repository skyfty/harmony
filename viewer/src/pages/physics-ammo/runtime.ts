import type { PhysicsBackendBridge } from '@harmony/physics-bridge';
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime';
import type { createAmmoPhysicsController as CreateAmmoPhysicsController } from './engine/controller';
import type { createAmmoSchemaPhysicsBackendBridge as CreateAmmoSchemaPhysicsBackendBridge } from './engine/schemaBridge';
import ammoBootstrapSource from './vendor/ammo.wasm.js?raw';
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
  Ammo?: (target?: Record<string, unknown>) => unknown;
  default?: unknown;
};

let ammoControllerModulePromise: Promise<AmmoControllerModule> | null = null;
let ammoSchemaBridgeModulePromise: Promise<AmmoSchemaBridgeModule> | null = null;
let ammoBootstrapModulePromise: Promise<AmmoBootstrapModule> | null = null;

function loadAmmoControllerModule(): Promise<AmmoControllerModule> {
  ammoControllerModulePromise ??= import('./engine/controller');
  return ammoControllerModulePromise;
}

function loadAmmoSchemaBridgeModule(): Promise<AmmoSchemaBridgeModule> {
  ammoSchemaBridgeModulePromise ??= import('./engine/schemaBridge');
  return ammoSchemaBridgeModulePromise;
}

function loadAmmoBootstrapModule(): Promise<AmmoBootstrapModule> {
  ammoBootstrapModulePromise ??= Promise.resolve(createAmmoBootstrapModule(ammoBootstrapSource));
  return ammoBootstrapModulePromise;
}

function resolveAmmoBootstrapFactory(module: AmmoBootstrapModule): (target?: Record<string, unknown>) => unknown {
  if (typeof module.Ammo === 'function') {
    return module.Ammo;
  }
  if (typeof module.default === 'function') {
    return module.default;
  }
  if (module.default && typeof module.default === 'object') {
    const nestedModule = module.default as AmmoBootstrapModule;
    if (typeof nestedModule.Ammo === 'function') {
      return nestedModule.Ammo;
    }
    if (typeof nestedModule.default === 'function') {
      return nestedModule.default;
    }
  }
  throw new Error('Invalid Ammo bootstrap module');
}

function createAmmoBootstrapModule(source: string): AmmoBootstrapModule {
  const transformedSource = source
    .replace('import{LocalAsset as t}from"../utils/LocalAsset.js";', '')
    .replace(
      'WebAssembly.instantiate(t.resolve("wasm","ammo.wasm.wasm"),e).then((t=>n(t.instance)))',
      `fetch(${JSON.stringify(ammoWasmUrl)}).then((response) => response.arrayBuffer()).then((bytes) => WebAssembly.instantiate(bytes, e)).then((t) => n(t.instance))`,
    )
    .replace('export{n as Ammo,n as default};', 'return { Ammo: n, default: n };')

  return new Function(transformedSource)() as AmmoBootstrapModule
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
      return bootstrap.call(globalThis);
    });
    return ammoPromise;
  };
  const ammo = await moduleFactory();

  return {
    schemaBridge: schemaBridgeModule.createAmmoSchemaPhysicsBackendBridge(ammo as never),
    createController: () => controllerModule.createAmmoPhysicsController({ moduleFactory }),
  };
}
