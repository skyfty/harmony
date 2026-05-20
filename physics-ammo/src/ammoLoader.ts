import ammoBootstrapSource from './vendor/ammo.wasm.js?raw'
import wasmUrl from './vendor/ammo.wasm.wasm?url'

export type AmmoModuleFactory<TModule> = () => Promise<TModule>

type AmmoBootstrapFactory<TModule> = (target?: Record<string, unknown>) => Promise<TModule>
type AmmoBootstrapModule = {
  Ammo?: AmmoBootstrapFactory<unknown>
  default?: unknown
}

function resolveAmmoBootstrapFactory<TModule>(module: unknown): AmmoBootstrapFactory<TModule> {
  if (typeof module === 'function') {
    return module as AmmoBootstrapFactory<TModule>
  }
  if (module && typeof module === 'object') {
    const maybeModule = module as {
      Ammo?: unknown
      default?: unknown
    }
    if (typeof maybeModule.Ammo === 'function') {
      return maybeModule.Ammo as AmmoBootstrapFactory<TModule>
    }
    if (typeof maybeModule.default === 'function') {
      return maybeModule.default as AmmoBootstrapFactory<TModule>
    }
    if (maybeModule.default && typeof maybeModule.default === 'object') {
      const nestedModule = maybeModule.default as {
        Ammo?: unknown
        default?: unknown
      }
      if (typeof nestedModule.Ammo === 'function') {
        return nestedModule.Ammo as AmmoBootstrapFactory<TModule>
      }
      if (typeof nestedModule.default === 'function') {
        return nestedModule.default as AmmoBootstrapFactory<TModule>
      }
    }
  }
  throw new Error('Invalid Ammo bootstrap module')
}

function createAmmoBootstrapModule(source: string): AmmoBootstrapModule {
  const transformedSource = source
    .replace('import{LocalAsset as t}from"../utils/LocalAsset.js";', '')
    .replace(
      'WebAssembly.instantiate(t.resolve("wasm","ammo.wasm.wasm"),e).then((t=>n(t.instance)))',
      `fetch(${JSON.stringify(wasmUrl)}).then((response) => response.arrayBuffer()).then((bytes) => WebAssembly.instantiate(bytes, e)).then((t) => n(t.instance))`,
    )
    .replace('export{n as Ammo,n as default};', 'return { Ammo: n, default: n };')

  return new Function(transformedSource)() as AmmoBootstrapModule
}

export function createDefaultAmmoModuleFactory<TModule = unknown>(): AmmoModuleFactory<TModule> {
  return async () => {
    const importedModule = createAmmoBootstrapModule(ammoBootstrapSource)
    const bootstrap = resolveAmmoBootstrapFactory<TModule>(importedModule)
    return bootstrap.call(globalThis, {
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
