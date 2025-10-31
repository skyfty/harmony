import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
      {
        find: '@schema',
        replacement: fileURLToPath(new URL('../schema', import.meta.url)),
      },
      {
        find: 'three/examples/jsm/',
        replacement: `${fileURLToPath(new URL('./node_modules/three/examples/jsm/', import.meta.url))}`,
      },
      {
        find: 'three/addons/',
        replacement: `${fileURLToPath(new URL('./node_modules/three/examples/jsm/', import.meta.url))}`,
      },
      {
        find: /^three$/,
        replacement: fileURLToPath(new URL('./node_modules/three', import.meta.url)),
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
