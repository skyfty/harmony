import { fileURLToPath, URL } from 'node:url';
import uni from '@dcloudio/vite-plugin-uni';
import threePlatformAdapter from '@minisheep/three-platform-adapter/plugin';
import glsl from 'vite-plugin-glsl';
import { visualizer } from 'rollup-plugin-visualizer';
import { createMpChunkSplitterPlugin } from '@minisheep/vite-plugin-mp-chunk-splitter';
import { toCustomChunkPlugin } from '@harmony/tools/vite';

const uniPlatform = process.env.UNI_PLATFORM;
const isMp = uniPlatform?.startsWith('mp-');

const vueRuntimeAlias = isMp
  ? '@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js'
  : '@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js';

export default {
  optimizeDeps: {
    exclude: ['@minisheep/three-platform-adapter'],
  },
  resolve: {
    alias: {
      '@schema': fileURLToPath(new URL('../schema', import.meta.url)),
      '@harmony/schema': fileURLToPath(new URL('../schema', import.meta.url)),
      vue: vueRuntimeAlias,
      three: fileURLToPath(new URL('./node_modules/three', import.meta.url)),
      'cannon-es': fileURLToPath(new URL('./node_modules/cannon-es', import.meta.url)),
      'three/examples': fileURLToPath(new URL('./node_modules/three/examples', import.meta.url)),
      '@three-examples': fileURLToPath(new URL('./node_modules/three/examples/jsm', import.meta.url)),
    },
  },
  server: {
    port: 8093,
    open: true,
  },
  plugins: [
    glsl(),
    getUniPlugin(),
    visualizer({ emitFile: true }),
    threePlatformAdapter({
      assetsOutput: {
        worker: 'pages/scenery/workers',
        wasm: 'pages/scenery/wasms',
      },
    }),
    createMpChunkSplitterPlugin({
      subpackages: ['pages/scenery'],
      singleChunkMode: true,
      packageSizeLimit: 1.8 * 1024 * 1024,
    }),
    toCustomChunkPlugin({
      manualChunks: {
        'pages/scenery/chunks/vendor': [
          '@minisheep/three-platform-adapter',
          '@minisheep/three-platform-adapter/wechat',
          '@minisheep/three-platform-adapter/dist/three-override/jsm/**',
          'three',
          'three/addons/**',
          'three/examples/**',
          'three/examples/jsm/**',
        ],
      },
    }),
    {
      name: 'find-dep',
      config(config) {
        const resolve = (config as { resolve?: { preserveSymlinks?: boolean } }).resolve;
        if (resolve) {
          resolve.preserveSymlinks = true;
        } else {
          (config as { resolve: { preserveSymlinks: boolean } }).resolve = { preserveSymlinks: true };
        }
      },
    },
  ],
};

function getUniPlugin() {
  const maybeModule = uni as unknown as { default?: () => unknown };
  return typeof maybeModule.default === 'function' ? maybeModule.default() : uni;
}
