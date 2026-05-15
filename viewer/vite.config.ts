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

const rawVueRuntimeAlias = isMp
  ? '@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js'
  : '@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js';
const schemaMirrorPath = fileURLToPath(new URL('./src/pages/scenery/schema', import.meta.url)).replaceAll('\\', '/');

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
  const normalizedName = assetInfo.name?.replaceAll('\\', '/') ?? '';
  if (normalizedName.includes('ammo.wasm')) {
    return 'pages/physics-ammo/vendor/[name].[hash][extname]';
  }
  return undefined;
}

function resolveManualChunk(id: string): string | undefined {
  if (!isMp) {
    return undefined;
  }

  const normalizedId = id.replaceAll('\\', '/');
  if (
    normalizedId.includes('/node_modules/vue/')
    || normalizedId.includes('/node_modules/@vue/')
    || normalizedId.includes('/node_modules/@dcloudio/')
    || normalizedId.includes('/node_modules/@minisheep/mini-program-polyfill-core/')
    || normalizedId.includes('/node_modules/@minisheep/mini-program-polyfill/')
    || normalizedId.includes('/node_modules/event-target-shim/')
  ) {
    return 'common/vendor';
  }

  if (
    normalizedId.includes('/src/pages/scenery/')
    || normalizedId.includes('/src/pages/scenery/schema/')
    || (
      normalizedId.includes('/schema/')
      && !normalizedId.includes('/schema/dist/physicsBackendBridge.js')
      && !normalizedId.includes('/schema/dist/physicsBackendTypes.js')
      && !normalizedId.includes('/schema/dist/physicsBodySync.js')
      && !normalizedId.includes('/schema/dist/physicsBridgeVehicleInputSync.js')
      && !normalizedId.includes('/schema/dist/physicsRuntimeBridge.js')
      && !normalizedId.includes('/schema/dist/physicsEngine.js')
      && !normalizedId.includes('/schema/dist/physicsShapeResolvers.js')
    )
    || normalizedId.includes('/node_modules/three/')
    || normalizedId.includes('/node_modules/three-mesh-bvh/')
    || normalizedId.includes('/node_modules/polygon-clipping/')
    || normalizedId.includes('/node_modules/@msgpack/msgpack/')
    || normalizedId.includes('/node_modules/robust-predicates/')
    || normalizedId.includes('/node_modules/splaytree/')
    || normalizedId.includes('/node_modules/three-csm/')
    || normalizedId.includes('/node_modules/fflate/')
    || normalizedId.includes('/node_modules/web-streams-polyfill/')
    || normalizedId.includes('/node_modules/@minisheep/three-platform-adapter/')
  ) {
    return 'pages/scenery/common/vendor';
  }

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
    alias: [
      { find: /^@harmony\/schema$/, replacement: `${schemaMirrorPath}/index.ts` },
      { find: /^@harmony\/schema\/(.*)$/, replacement: `${schemaMirrorPath}/$1` },
      { find: '@harmony/physics-ammo', replacement: fileURLToPath(new URL('./src/pages/physics-ammo/runtime.ts', import.meta.url)) },
      { find: '@harmony/physics-ammo-source', replacement: fileURLToPath(new URL('./src/pages/physics-ammo/engine', import.meta.url)) },
      { find: '@harmony/physics-core', replacement: fileURLToPath(new URL('../physics-core/src', import.meta.url)) },
      { find: '@harmony/physics-bridge', replacement: fileURLToPath(new URL('../physics-bridge/src', import.meta.url)) },
      { find: '@harmony/physics-cannon', replacement: fileURLToPath(new URL('./src/pages/physics-cannon/runtime.ts', import.meta.url)) },
      { find: '@harmony/physics-cannon-source', replacement: fileURLToPath(new URL('./src/pages/physics-cannon/engine', import.meta.url)) },
      { find: 'ammojs3', replacement: fileURLToPath(new URL('./node_modules/ammojs3', import.meta.url)) },
      { find: 'cannon-es', replacement: fileURLToPath(new URL('./node_modules/cannon-es', import.meta.url)) },
      { find: 'vue', replacement: vueRuntimeAlias },
      { find: 'three', replacement: fileURLToPath(new URL('./node_modules/three', import.meta.url)) },
      { find: 'three/examples', replacement: fileURLToPath(new URL('./node_modules/three/examples', import.meta.url)) },
      { find: '@three-examples', replacement: fileURLToPath(new URL('./node_modules/three/examples/jsm', import.meta.url)) },
    ],
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
        normalizeVueEntityModule: false,
      },
      logger: ['optimization'],
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
