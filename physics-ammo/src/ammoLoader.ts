import ammoBootstrapSource from './vendor/ammo.wasm.js?raw'
import wasmUrl from './vendor/ammo.wasm.wasm?url'

export type AmmoModuleFactory<TModule> = () => Promise<TModule>

type AmmoBootstrapFactory<TModule> = (target?: Record<string, unknown>) => Promise<TModule>
type AmmoBootstrapModule = {
  Ammo?: AmmoBootstrapFactory<unknown>
  default?: unknown
}

type AmmoBootstrapSources = {
  moduleSource: string
  functionSource: string
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
  const moduleType = typeof module
  const moduleKeys = module && typeof module === 'object' ? Object.keys(module as Record<string, unknown>).join(',') : ''
  throw new Error(`Invalid Ammo bootstrap module (type=${moduleType}${moduleKeys ? `, keys=${moduleKeys}` : ''})`)
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
  }
}

async function createAmmoBootstrapModule(source: string): Promise<AmmoBootstrapModule> {
  const { moduleSource, functionSource } = transformAmmoBootstrapSource(source, wasmUrl)

  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blob = new Blob([moduleSource], { type: 'text/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    try {
      return (await import(/* @vite-ignore */ blobUrl)) as AmmoBootstrapModule
    } catch {
      // Fall back to the Function path below if blob module loading is unavailable.
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  return new Function(functionSource)() as AmmoBootstrapModule
}

export function createDefaultAmmoModuleFactory<TModule = unknown>(): AmmoModuleFactory<TModule> {
  return async () => {
    const importedModule = await createAmmoBootstrapModule(ammoBootstrapSource)
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
