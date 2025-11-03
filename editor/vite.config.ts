import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

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
  },
  server: {
    sourcemapIgnoreList: false,
  },
})
