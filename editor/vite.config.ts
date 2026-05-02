import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import replace from '@rollup/plugin-replace'

const resolveDir = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url))
const withTrailingSlash = (value: string) => (value.endsWith('/') || value.endsWith('\\') ? value : `${value}/`)
const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)
const shouldUsePolling =
  process.env.CHOKIDAR_USEPOLLING != null
    ? process.env.CHOKIDAR_USEPOLLING !== '0'
    : process.platform === 'win32' || isWsl
const parsedPollingInterval = Number.parseInt(process.env.CHOKIDAR_INTERVAL ?? '300', 10)
const pollingInterval = Number.isFinite(parsedPollingInterval) && parsedPollingInterval > 0 ? parsedPollingInterval : 300

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  cacheDir: path.join(os.tmpdir(), 'harmony-editor-vite'),
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
        find: '@harmony/physics-core',
        replacement: resolveDir('../physics-core/src'),
      },
      {
        find: '@harmony/physics-ammo',
        replacement: resolveDir('../physics-ammo/src'),
      },
      {
        find: '@harmony/physics-host-web',
        replacement: resolveDir('../physics-host-web/src'),
      },
      {
        find: '@harmony/physics-worker-runtime',
        replacement: resolveDir('../physics-worker-runtime/src'),
      },
      // keep using the short @schema alias; no runtime alias needed for @harmony/schema
      {
        find: '@three-examples',
        replacement: withTrailingSlash(resolveDir('./node_modules/three/examples/jsm/')),
      },
      {
        find: /^three\/examples\/jsm\//,
        replacement: withTrailingSlash(resolveDir('./node_modules/three/examples/jsm/')),
      },
      {
        find: /^three\/addons\//,
        replacement: withTrailingSlash(resolveDir('./node_modules/three/examples/jsm/')),
      },
      {
        find: /^three$/,
        replacement: resolveDir('./node_modules/three'),
      },
    ],
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/node_modules/three/examples') || id.includes('/node_modules/three/examples/')) return 'vendor_three_examples'
            if (id.includes('/node_modules/three') || id.includes('/node_modules/three/')) return 'vendor_three'
            if (id.includes('/schema/') || id.includes('/home/sky/harmony/schema')) return 'vendor_schema'
            if (id.includes('/node_modules/vuetify') || id.includes('/node_modules/@vuetify')) return 'vendor_vuetify'
            if (id.includes('/node_modules/@harmony') || id.includes('/node_modules/../schema')) return 'vendor_schema'
            if (id.includes('/node_modules/ammojs3')) return 'vendor_physics'
            return 'vendor'
          }
        },
      },
      plugins: [
        replace({
          include: ['**/node_modules/three-mesh-bvh/**'],
          preventAssignment: true,
          values: { '/* @__PURE__ */': '' },
          delimiters: ['', ''],
        }),
      ],
    },
  },
  server: {
    port: 8088,
    watch: {
      usePolling: shouldUsePolling,
      interval: pollingInterval,
    },
    sourcemapIgnoreList: false,
  },
})
