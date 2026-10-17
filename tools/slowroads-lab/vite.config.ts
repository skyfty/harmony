import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replaceAll('\\', '/')
const threeRootPath = fileURLToPath(new URL('../node_modules/three', import.meta.url)).replaceAll('\\', '/')
const threeExamplesPath = `${threeRootPath}/examples/jsm`

export default defineConfig({
  root,
  base: './',
  publicDir: false,
  resolve: {
    dedupe: ['three'],
    alias: [
      { find: /^three\/examples\/jsm(\/.*)?$/, replacement: `${threeExamplesPath}$1` },
      { find: /^three\/addons(\/.*)?$/, replacement: `${threeExamplesPath}$1` },
      { find: /^three$/, replacement: threeRootPath },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  server: {
    port: 8096,
    strictPort: false,
    open: true,
    fs: {
      allow: [repoRoot],
    },
  },
  // geotiff pulls in dynamically imported decoders; an IIFE worker cannot
  // code-split those chunks.
  worker: {
    format: 'es',
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('/node_modules/three/') ? 'three' : undefined),
      },
    },
  },
})
