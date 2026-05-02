export type AmmoModuleFactory<TModule> = () => Promise<TModule>

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
