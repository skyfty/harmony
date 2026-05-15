import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import uni from '@dcloudio/vite-plugin-uni';
import bundleOptimizer from '@uni-ku/bundle-optimizer';
import threePlatformAdapter from '@minisheep/three-platform-adapter/plugin';
import glsl from 'vite-plugin-glsl';
import { visualizer } from 'rollup-plugin-visualizer';

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

function resolveManualChunk(id: string): string | undefined {
  if (!isMp) {
    return undefined;
  }

  const normalizedId = id.replaceAll('\\', '/');
  if (
    normalizedId.includes('/physics-ammo/src/')
    || normalizedId.includes('/src/pages/physics-ammo/engine/')
    || normalizedId.includes('/node_modules/ammojs3/')
  ) {
    return 'pages/physics-ammo/common/vendor';
  }

  if (
    normalizedId.includes('/physics-cannon/src/')
    || normalizedId.includes('/src/pages/physics-cannon/engine/')
    || normalizedId.includes('/node_modules/cannon-es/')
  ) {
    return 'pages/physics-cannon/common/vendor';
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
        manualChunks(id) {
          return resolveManualChunk(id);
        },
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
      '@harmony/physics-ammo': fileURLToPath(new URL('./src/pages/physics-ammo/runtime.ts', import.meta.url)),
      '@harmony/physics-ammo-source': fileURLToPath(new URL('./src/pages/physics-ammo/engine', import.meta.url)),
      '@harmony/physics-core': fileURLToPath(new URL('../physics-core/src', import.meta.url)),
      '@harmony/physics-bridge': fileURLToPath(new URL('../physics-bridge/src', import.meta.url)),
      '@harmony/physics-cannon': fileURLToPath(new URL('./src/pages/physics-cannon/runtime.ts', import.meta.url)),
      '@harmony/physics-cannon-source': fileURLToPath(new URL('./src/pages/physics-cannon/engine', import.meta.url)),
      'ammojs3': fileURLToPath(new URL('./node_modules/ammojs3', import.meta.url)),
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
    bundleOptimizer({
      enable: isMp
        ? {
            // Keep async cross-package loading, but avoid vendor normalization that
            // creates cross-subpackage circular requires in mp-weixin.
            optimization: false,
            'async-import': true,
            'async-component': true,
          }
        : {
            optimization: false,
            'async-import': false,
            'async-component': false,
          },
      optimization: {
        // Disabling this avoids cross-subpackage circular vendor chunks in mp-weixin.
        normalizeVueEntityModule: false,
      },
    }),
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
