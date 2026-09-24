import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolveDir = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url))

// Mirrors the alias list of `vite.config.ts` for the modules under test; the unit tests only cover
// pure geometry/shape helpers, so no app plugin (Vue/Vuetify) is needed here.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@',
        replacement: resolveDir('./src'),
      },
      {
        find: '@schema',
        replacement: resolveDir('../schema'),
      },
      {
        find: /^@harmony\/utils$/,
        replacement: resolveDir('../utils/src/index.ts'),
      },
      {
        find: /^@harmony\/utils\/(.*)$/,
        replacement: `${resolveDir('../utils/src')}/$1`,
      },
      {
        find: '@harmony/physics-core',
        replacement: resolveDir('../physics-core/src'),
      },
      {
        find: '@harmony/physics-ammo',
        replacement: resolveDir('../physics-ammo/src'),
      },
      {
        find: '@harmony/physics-cannon',
        replacement: resolveDir('../physics-cannon/src'),
      },
      {
        find: '@harmony/physics-bridge',
        replacement: resolveDir('../physics-bridge/src'),
      },
      {
        find: /^three$/,
        replacement: resolveDir('./node_modules/three'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
