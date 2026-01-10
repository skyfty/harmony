import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import replace from '@rollup/plugin-replace'

const resolveDir = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url))
const withTrailingSlash = (value: string) => (value.endsWith('/') || value.endsWith('\\') ? value : `${value}/`)

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
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
        find: 'cannon-es',
        replacement: resolveDir('./node_modules/cannon-es'),
      },
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
            if (id.includes('/node_modules/cannon-es')) return 'vendor_physics'
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
    sourcemapIgnoreList: false,
  },
})
