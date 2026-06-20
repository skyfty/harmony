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

type AmmoBootstrapSources = {
  moduleSource: string;
  functionSource: string;
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
  if (typeof module === 'function') {
    return module as unknown as (target?: Record<string, unknown>) => unknown;
  }
  if (typeof module.Ammo === 'function') {
    return module.Ammo as (target?: Record<string, unknown>) => unknown;
  }
  if (typeof module.default === 'function') {
    return module.default as (target?: Record<string, unknown>) => unknown;
  }
  if (module.default && typeof module.default === 'object') {
    const nestedModule = module.default as AmmoBootstrapModule;
    if (typeof nestedModule.Ammo === 'function') {
      return nestedModule.Ammo as (target?: Record<string, unknown>) => unknown;
    }
    if (typeof nestedModule.default === 'function') {
      return nestedModule.default as (target?: Record<string, unknown>) => unknown;
    }
  }
  const moduleType = typeof module;
  const moduleKeys = module && typeof module === 'object' ? Object.keys(module as Record<string, unknown>).join(',') : '';
  throw new Error(`Invalid Ammo bootstrap module (type=${moduleType}${moduleKeys ? `, keys=${moduleKeys}` : ''})`);
}

function transformAmmoBootstrapSource(source: string, wasmAssetUrl: string): AmmoBootstrapSources {
  const strippedSource = source
    .replace('import{LocalAsset as t}from"../utils/LocalAsset.js";', '')
    .replace(
      'WebAssembly.instantiate(t.resolve("wasm","ammo.wasm.wasm"),e).then((t=>n(t.instance)))',
      `fetch(${JSON.stringify(wasmAssetUrl)}).then((response) => response.arrayBuffer()).then((bytes) => WebAssembly.instantiate(bytes, e)).then((t) => n(t.instance))`,
    )
  return {
    moduleSource: strippedSource,
    functionSource: `${strippedSource.replace('export{n as Ammo,n as default};', '')}\nreturn { Ammo: n, default: n };`,
  };
}

async function createAmmoBootstrapModule(source: string): Promise<AmmoBootstrapModule> {
  const { moduleSource, functionSource } = transformAmmoBootstrapSource(source, ammoWasmUrl)

  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blob = new Blob([moduleSource], { type: 'text/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    try {
      return (await import(/* @vite-ignore */ blobUrl)) as AmmoBootstrapModule;
    } catch {
      // Fall back to the Function path below if blob module loading is unavailable.
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  return new Function(functionSource)() as AmmoBootstrapModule;
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
