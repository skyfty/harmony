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
const useWorkspaceSourceForH5 = !isMp;
const buildTarget = isMp ? 'es2018' : 'es2020';
const sceneOptimizerExcludes = [
  '@harmony/schema',
  '@harmony/schema/',
  'three',
  'three/examples',
  'three-mesh-bvh',
  'three-csm',
  'polygon-clipping',
  '@msgpack/msgpack',
  'robust-predicates',
  'splaytree',
  'fflate',
  'ammojs3',
  'cannon-es',
  '@minisheep/three-platform-adapter',
];

const rawVueRuntimeAlias = isMp
  ? '@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js'
  : '@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js';
const repoRootPath = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/');
const scenerySourcePath = fileURLToPath(new URL('../scenery', import.meta.url)).replaceAll('\\', '/');
const schemaSourcePath = fileURLToPath(new URL('../schema', import.meta.url)).replaceAll('\\', '/');
const physicsCoreSourcePath = fileURLToPath(new URL('../physics-core/src', import.meta.url)).replaceAll('\\', '/');
const physicsCannonSourcePath = fileURLToPath(new URL('../physics-cannon/src', import.meta.url)).replaceAll('\\', '/');
const sceneryPhysicsBridgeSourcePath = fileURLToPath(new URL('../physics-bridge/src', import.meta.url)).replaceAll('\\', '/');
const utilsSrcPath = fileURLToPath(new URL('../utils/src', import.meta.url)).replaceAll('\\', '/');
const eventTargetShimPath = fileURLToPath(new URL('./node_modules/event-target-shim/index.mjs', import.meta.url)).replaceAll('\\', '/');
const webStreamsPolyfillPath = fileURLToPath(new URL('./node_modules/web-streams-polyfill/dist/polyfill.mjs', import.meta.url)).replaceAll('\\', '/');
const cannonEsEntryPath = fileURLToPath(new URL('./src/pages/physics-cannon/cannon-es/dist/cannon-es.js', import.meta.url)).replaceAll('\\', '/');
const ammoJsEntryPath = fileURLToPath(new URL('./src/pages/physics-ammo/ammojs3/dist/ammo.js', import.meta.url)).replaceAll('\\', '/');
const ammoJsWasmEntryPath = fileURLToPath(new URL('./src/pages/physics-ammo/vendor/ammo.wasm.js', import.meta.url)).replaceAll('\\', '/');
const ammoJsWasmBinaryPath = fileURLToPath(new URL('./src/pages/physics-ammo/vendor/ammo.wasm.wasm', import.meta.url)).replaceAll('\\', '/');
const schemaMirrorPath = fileURLToPath(new URL('./src/pages/scenery/schema', import.meta.url)).replaceAll('\\', '/');
const physicsCoreMirrorPath = fileURLToPath(new URL('./src/pages/scenery/physics-core', import.meta.url)).replaceAll('\\', '/');
const sceneryPhysicsBridgeMirrorPath = fileURLToPath(new URL('./src/pages/scenery/physics-bridge', import.meta.url)).replaceAll('\\', '/');
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
  if (normalizedId.includes('/.vite/deps/')) {
    if (
      normalizedId.includes('three')
      || normalizedId.includes('schema')
      || normalizedId.includes('physics-bridge')
      || normalizedId.includes('three-mesh-bvh')
      || normalizedId.includes('polygon-clipping')
      || normalizedId.includes('@msgpack/msgpack')
      || normalizedId.includes('robust-predicates')
      || normalizedId.includes('splaytree')
      || normalizedId.includes('three-csm')
      || normalizedId.includes('fflate')
      || normalizedId.includes('@minisheep/three-platform-adapter')
      || normalizedId.includes('ammojs3')
      || normalizedId.includes('cannon-es')
    ) {
      if (
        normalizedId.includes('ammojs3')
      ) {
        return 'pages/physics-ammo/common/vendor';
      }
      if (normalizedId.includes('cannon-es')) {
        return 'pages/physics-cannon/common/vendor';
      }
      return 'pages/scenery/common/vendor';
    }
  }

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
    normalizedId.includes('/src/pages/scenery/three/')
    || normalizedId.includes('/src/pages/scenery/three-mesh-bvh/')
    || normalizedId.includes('/src/pages/scenery/three-platform-adapter/')
    || normalizedId.includes('/node_modules/three/')
    || normalizedId.includes('/node_modules/three-mesh-bvh/')
    || normalizedId.includes('/node_modules/three-csm/')
    || normalizedId.includes('/node_modules/@minisheep/three-platform-adapter/')
  ) {
    return 'pages/scenery/common/vendor';
  }

  if (
    normalizedId.includes('/src/pages/scenery/')
    || normalizedId.includes('/src/pages/scenery/schema/')
    || normalizedId.includes('/src/pages/scenery/physics-core/')
    || normalizedId.includes('/src/pages/scenery/utils/')
    || normalizedId.includes('/src/pages/scenery/physics-bridge/')
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
    || normalizedId.includes('/node_modules/fflate/')
    || normalizedId.includes('/node_modules/web-streams-polyfill/')
  ) {
    return 'pages/scenery/common/vendor';
  }

  if (
    normalizedId.includes('/physics-ammo/src/')
    || normalizedId.includes('/src/pages/physics-ammo/engine/')
    || normalizedId.includes('/src/pages/physics-ammo/ammojs3/')
    || normalizedId.includes('/node_modules/ammojs3/')
  ) {
    return 'pages/physics-ammo/common/vendor';
  }

  if (
    normalizedId.includes('/physics-cannon/src/')
    || normalizedId.includes('/src/pages/physics-cannon/engine/')
    || normalizedId.includes('/src/pages/physics-cannon/cannon-es/')
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
    exclude: sceneOptimizerExcludes,
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
      ...(useWorkspaceSourceForH5
        ? [
            { find: /^@harmony\/scenery$/, replacement: scenerySourcePath },
            { find: /^@harmony\/scenery\/(.*)$/, replacement: `${scenerySourcePath}/$1` },
            { find: /^@harmony\/schema$/, replacement: `${schemaSourcePath}/index.ts` },
            { find: /^@harmony\/schema\/(.*)$/, replacement: `${schemaSourcePath}/$1` },
            { find: /^@harmony\/physics-core$/, replacement: `${physicsCoreSourcePath}/index.ts` },
            { find: /^@harmony\/physics-core\/(.*)$/, replacement: `${physicsCoreSourcePath}/$1` },
            { find: /^@harmony\/physics-cannon$/, replacement: `${physicsCannonSourcePath}/index.ts` },
            { find: /^@harmony\/physics-cannon\/(.*)$/, replacement: `${physicsCannonSourcePath}/$1` },
            { find: /^@harmony\/physics-bridge$/, replacement: `${sceneryPhysicsBridgeSourcePath}/index.ts` },
            { find: /^@harmony\/physics-bridge\/(.*)$/, replacement: `${sceneryPhysicsBridgeSourcePath}/$1` },
            { find: '@harmony/physics-bridge/wechat', replacement: `${sceneryPhysicsBridgeSourcePath}/wechat.ts` },
            { find: '@harmony/utils/http', replacement: `${utilsSrcPath}/http.ts` },
            { find: '@harmony/utils/mini-client', replacement: `${utilsSrcPath}/miniClient.ts` },
            { find: '@harmony/utils/scene-package-storage', replacement: `${utilsSrcPath}/scenePackageStorage.ts` },
            { find: '@harmony/utils/scene-package-fs', replacement: `${utilsSrcPath}/scenePackageFs.ts` },
            { find: '@harmony/utils/query', replacement: `${utilsSrcPath}/query.ts` },
            { find: /^@harmony\/utils$/, replacement: `${utilsSrcPath}/index.ts` },
            { find: /^@harmony\/utils\/(.*)$/, replacement: `${utilsSrcPath}/$1` },
          ]
        : [
            { find: /^@harmony\/schema$/, replacement: `${schemaMirrorPath}/index.ts` },
            { find: /^@harmony\/schema\/(.*)$/, replacement: `${schemaMirrorPath}/$1` },
            { find: /^@harmony\/physics-core$/, replacement: `${physicsCoreMirrorPath}/index.ts` },
            { find: /^@harmony\/physics-core\/(.*)$/, replacement: `${physicsCoreMirrorPath}/$1` },
            { find: /^@harmony\/physics-bridge$/, replacement: `${sceneryPhysicsBridgeMirrorPath}/index.ts` },
            { find: /^@harmony\/physics-bridge\/(.*)$/, replacement: `${sceneryPhysicsBridgeMirrorPath}/$1` },
            { find: '@harmony/physics-bridge/wechat', replacement: `${sceneryPhysicsBridgeMirrorPath}/wechat.ts` },
            { find: '@harmony/utils/http', replacement: `${utilsSrcPath}/http.ts` },
            { find: '@harmony/utils/mini-client', replacement: `${utilsSrcPath}/miniClient.ts` },
            { find: '@harmony/utils/scene-package-storage', replacement: `${utilsSrcPath}/scenePackageStorage.ts` },
            { find: '@harmony/utils/scene-package-fs', replacement: `${utilsSrcPath}/scenePackageFs.ts` },
            { find: '@harmony/utils/query', replacement: `${utilsSrcPath}/query.ts` },
            { find: /^@harmony\/utils$/, replacement: `${utilsSrcPath}/index.ts` },
            { find: /^@harmony\/utils\/(.*)$/, replacement: `${utilsSrcPath}/$1` },
          ]),
      { find: '@harmony/scenery-storage', replacement: fileURLToPath(new URL('./src/pages/scenery/runtime/sceneStorageProxy.ts', import.meta.url)) },
      { find: /^@harmony\/physics-bridge$/, replacement: `${sceneryPhysicsBridgeMirrorPath}/index.ts` },
      { find: /^@harmony\/physics-bridge\/(.*)$/, replacement: `${sceneryPhysicsBridgeMirrorPath}/$1` },
      { find: '@harmony/physics-bridge/wechat', replacement: `${sceneryPhysicsBridgeMirrorPath}/wechat.ts` },
      { find: '@harmony/utils/http', replacement: `${utilsSrcPath}/http.ts` },
      { find: '@harmony/utils/mini-client', replacement: `${utilsSrcPath}/miniClient.ts` },
      { find: '@harmony/utils/scene-package-storage', replacement: `${utilsSrcPath}/scenePackageStorage.ts` },
      { find: '@harmony/utils/scene-package-fs', replacement: `${utilsSrcPath}/scenePackageFs.ts` },
      { find: '@harmony/utils/query', replacement: `${utilsSrcPath}/query.ts` },
      { find: /^@harmony\/utils\/(.*)$/, replacement: `${utilsSrcPath}/$1` },
      { find: 'cannon-es', replacement: cannonEsEntryPath },
      ...(isMp
        ? [
            { find: /^ammojs3\/dist\/ammo\.wasm\.js$/, replacement: ammoJsWasmEntryPath },
            { find: /^ammojs3\/dist\/ammo\.wasm\.wasm\?url$/, replacement: `${ammoJsWasmBinaryPath}?url` },
          ]
        : []),
      { find: /^ammojs3$/, replacement: ammoJsEntryPath },
      { find: '@harmony/physics-ammo', replacement: fileURLToPath(new URL('./src/pages/physics-ammo/runtime.ts', import.meta.url)) },
      { find: '@harmony/physics-ammo-source', replacement: fileURLToPath(new URL('./src/pages/physics-ammo/engine', import.meta.url)) },
      { find: '@harmony/physics-cannon', replacement: fileURLToPath(new URL('./src/pages/physics-cannon/runtime.ts', import.meta.url)) },
      { find: '@harmony/physics-cannon-source', replacement: fileURLToPath(new URL('./src/pages/physics-cannon/engine', import.meta.url)) },
      { find: 'event-target-shim', replacement: eventTargetShimPath },
      { find: 'web-streams-polyfill', replacement: webStreamsPolyfillPath },
      { find: 'vue', replacement: vueRuntimeAlias },
    ],
  },
  server: {
    port: 8092,
    open: true,
    fs: {
      allow: [repoRootPath],
    },
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
