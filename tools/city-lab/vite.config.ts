import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replaceAll('\\', '/')
const schemaSourcePath = fileURLToPath(new URL('../../schema', import.meta.url)).replaceAll('\\', '/')
const threeRootPath = fileURLToPath(new URL('../node_modules/three', import.meta.url)).replaceAll('\\', '/')
const threeExamplesPath = `${threeRootPath}/examples/jsm`

export default defineConfig({
  root,
  base: './',
  publicDir: false,
  resolve: {
    // The lab and the shared schema source must resolve to a single three.js
    // instance, otherwise `instanceof` checks and material/geometry handling
    // diverge between them.
    dedupe: ['three'],
    alias: [
      { find: /^three\/examples\/jsm(\/.*)?$/, replacement: `${threeExamplesPath}$1` },
      { find: /^three\/addons(\/.*)?$/, replacement: `${threeExamplesPath}$1` },
      { find: /^three$/, replacement: threeRootPath },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      { find: /^@schema(\/.*)?$/, replacement: `${schemaSourcePath}$1` },
      { find: /^@harmony\/schema(\/.*)?$/, replacement: `${schemaSourcePath}$1` },
    ],
  },
  server: {
    port: 8095,
    strictPort: false,
    open: true,
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    // Keep the three.js runtime in its own chunk so the tool code stays readable
    // in the build output and the bundle warning points at the expected vendor blob.
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('/node_modules/three/') ? 'three' : undefined),
      },
    },
  },
})
