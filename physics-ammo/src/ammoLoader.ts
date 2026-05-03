/// <reference path="./ammojs3.d.ts" />

import wasmUrl from 'ammojs3/dist/ammo.wasm.wasm?url'

export type AmmoModuleFactory<TModule> = () => Promise<TModule>

type AmmoBootstrapFactory<TModule> = (target?: Record<string, unknown>) => Promise<TModule>

function resolveAmmoBootstrapFactory<TModule>(module: unknown): AmmoBootstrapFactory<TModule> {
  if (typeof module === 'function') {
    return module as AmmoBootstrapFactory<TModule>
  }
  if (module && typeof module === 'object' && 'default' in module && typeof module.default === 'function') {
    return module.default as AmmoBootstrapFactory<TModule>
  }
  throw new Error('Invalid Ammo bootstrap module')
}

export function createDefaultAmmoModuleFactory<TModule = unknown>(): AmmoModuleFactory<TModule> {
  return async () => {
    const importedModulePromise = import('ammojs3/dist/ammo.wasm.js')
    const importedModule = await importedModulePromise
    const bootstrap = resolveAmmoBootstrapFactory<TModule>(importedModule)
    return bootstrap.call(globalThis, {
      locateFile(path: string) {
        if (path === 'ammo.wasm.wasm') {
          return wasmUrl
        }
        return path
      },
    })
  }
}

export class AmmoModuleLoader<TModule> {
  private readonly factory: AmmoModuleFactory<TModule>
  private loadingPromise: Promise<TModule> | null = null

  constructor(factory: AmmoModuleFactory<TModule>) {
    this.factory = factory
  }

  async load(): Promise<TModule> {
    if (!this.loadingPromise) {
      this.loadingPromise = this.factory()
    }
    return this.loadingPromise
  }
}
