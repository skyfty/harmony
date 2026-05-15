import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import uni from '@dcloudio/vite-plugin-uni';
import threePlatformAdapter from '@minisheep/three-platform-adapter/plugin';
import glsl from 'vite-plugin-glsl';
import { visualizer } from 'rollup-plugin-visualizer';
import { createMpChunkSplitterPlugin } from '@minisheep/vite-plugin-mp-chunk-splitter';
import { toCustomChunkPlugin } from '@harmony/tools/vite';

// https://vitejs.dev/config/
const uniPlatform = process.env.UNI_PLATFORM;
const isMp = uniPlatform?.startsWith('mp-');
const buildTarget = isMp ? 'es2018' : 'es2020';
const useBuiltHarmonyPackages = isMp && process.env.NODE_ENV === 'production';

const rawVueRuntimeAlias = isMp
  ? '@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js'
  : '@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js';

const _require = createRequire(import.meta.url);
let vueRuntimeAlias: string;
try {
  vueRuntimeAlias = _require.resolve(rawVueRuntimeAlias);
} catch {
  vueRuntimeAlias = 'vue';
}

const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
const shouldUsePolling =
  process.env.CHOKIDAR_USEPOLLING != null
    ? process.env.CHOKIDAR_USEPOLLING !== '0'
    : process.platform === 'win32' || isWsl;
const parsedPollingInterval = Number.parseInt(process.env.CHOKIDAR_INTERVAL ?? '300', 10);
const pollingInterval =
  Number.isFinite(parsedPollingInterval) && parsedPollingInterval > 0
    ? parsedPollingInterval
    : 300;

function resolveAssetFileName(assetInfo: { name?: string }): string | undefined {
  if (!isMp) {
    return undefined;
  }
  return undefined;
}

export default {
  define: {
    'import.meta.env.VITE_SCENERY_ENABLE_GLTF_DRACO': JSON.stringify('false'),
    'import.meta.env.VITE_SCENERY_ENABLE_GLTF_KTX2': JSON.stringify('false'),
  },
  optimizeDeps: {
    exclude: ['@minisheep/three-platform-adapter'],
    esbuildOptions: {
      target: buildTarget,
    },
  },
  esbuild: {
    target: buildTarget,
  },
  build: {
    target: buildTarget,
    rollupOptions: {
      output: {
        chunkFileNames: isMp ? 'pages/shared/chunks/[hash].js' : 'assets/chunks/[hash].js',
        entryFileNames: isMp ? 'pages/shared/entries/[hash].js' : 'assets/entries/[hash].js',
        assetFileNames(assetInfo) {
          return resolveAssetFileName(assetInfo) ?? 'assets/[name].[hash][extname]';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@schema': useBuiltHarmonyPackages
        ? fileURLToPath(new URL('../schema/dist', import.meta.url))
        : fileURLToPath(new URL('../schema', import.meta.url)),
      '@harmony/schema': useBuiltHarmonyPackages
        ? fileURLToPath(new URL('../schema/dist', import.meta.url))
        : fileURLToPath(new URL('../schema', import.meta.url)),
      '@harmony/physics-core': fileURLToPath(new URL('../physics-core/src', import.meta.url)),
      '@harmony/physics-bridge': fileURLToPath(new URL('../physics-bridge/src', import.meta.url)),
      '@harmony/physics-cannon': fileURLToPath(new URL('../physics-cannon/src', import.meta.url)),
      'cannon-es': fileURLToPath(new URL('./node_modules/cannon-es', import.meta.url)),
      'vue': vueRuntimeAlias,
      'three': fileURLToPath(new URL('./node_modules/three', import.meta.url)),
      'three/examples': fileURLToPath(new URL('./node_modules/three/examples', import.meta.url)),
      '@three-examples': fileURLToPath(new URL('./node_modules/three/examples/jsm', import.meta.url)),
    },
  },
  server: {
    port: 8092,
    open: true,
    watch: {
      usePolling: shouldUsePolling,
      interval: pollingInterval,
    },
    hmr: true,
  },
  plugins: [
    glsl(),
    getUniPlugin(),
    visualizer({
      emitFile: true,
    }),
    // Keep adapter-emitted workers/wasms inside the scenery package boundary.
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
        'pages/shared/chunks/physics-core': [
          '@harmony/physics-core',
          '@harmony/physics-core/**',
          '**/physics-core/src/**',
          '**/harmony/physics-core/**',
        ],
        'pages/shared/chunks/physics-bridge': [
          '@harmony/physics-bridge',
          '@harmony/physics-bridge/**',
          '**/physics-bridge/src/**',
          '**/harmony/physics-bridge/**',
        ],
        'pages/scenery/chunks/vendor': [
          '@minisheep/three-platform-adapter',
          '@minisheep/three-platform-adapter/wechat',
          '@minisheep/three-platform-adapter/dist/three-override/jsm/**',
          'three',
          'three/addons/**',
          'three/examples/**',
          'three/examples/jsm/**',
          '@harmony/physics-cannon',
          'cannon-es',
          'cannon-es/**',
          '**/physics-cannon/src/**',
          '**/harmony/physics-cannon/**',
          '**/node_modules/cannon-es/**',
          '**/harmony/schema/**',
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
