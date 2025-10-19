import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function ensureGeneratorFunctionCompat(): void {
  try {
    const moduleId = require.resolve('generator-function')
    const cached = require.cache?.[moduleId]
    if (cached && typeof cached.exports === 'function') {
      return
    }
    const generatorFactory = () => (function* () {}.constructor)
    if (require.cache) {
      require.cache[moduleId] = {
        id: moduleId,
        filename: moduleId,
        path: moduleId,
        exports: generatorFactory,
        loaded: true,
        children: [],
        require,
      } as unknown as NodeModule
    }
  } catch (error) {
    console.warn('Failed to apply generator-function compatibility patch', error)
  }
}

ensureGeneratorFunctionCompat()
