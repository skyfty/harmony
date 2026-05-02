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
    // @ts-expect-error Vite/uni resolves wasm asset URLs at build time.
    const wasmUrlPromise = import('ammojs3/dist/ammo.wasm.wasm?url') as Promise<{ default: string }>
    const [importedModule, { default: wasmUrl }] = await Promise.all([
      importedModulePromise,
      wasmUrlPromise,
    ])
    const bootstrap = resolveAmmoBootstrapFactory<TModule>(importedModule)
    return bootstrap({
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
