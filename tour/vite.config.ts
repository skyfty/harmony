import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import uni from '@dcloudio/vite-plugin-uni';
import threePlatformAdapter from '@minisheep/three-platform-adapter/plugin';
import glsl from 'vite-plugin-glsl';
import { visualizer } from 'rollup-plugin-visualizer';
import { createMpChunkSplitterPlugin } from "@minisheep/vite-plugin-mp-chunk-splitter";
import { toCustomChunkPlugin } from "@harmony/tools/vite";

// https://vitejs.dev/config/
const uniPlatform = process.env.UNI_PLATFORM;
const isMp = uniPlatform?.startsWith('mp-');
const buildTarget = isMp ? 'es2018' : 'es2020';

const rawVueRuntimeAlias = isMp
  ? '@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js'
  : '@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js';

const _require = createRequire(import.meta.url);
let vueRuntimeAlias: string;
try {
  vueRuntimeAlias = _require.resolve(rawVueRuntimeAlias);
} catch (e) {
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

function rewriteWorkerWasmPaths() {
  const rewriteSource = (fileName: string, source: string) => {
    if (!fileName.startsWith('workers/') || !source.includes('setWASMInstantiateInputMapper')) {
      return source;
    }

    return source.replace(
      /setWASMInstantiateInputMapper\(\(\) => '([^']+)'\)/g,
      (_match, wasmPath: string) => {
        const relativePath = path.posix.relative(path.posix.dirname(fileName), wasmPath);
        const normalizedPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
        return `setWASMInstantiateInputMapper(() => '${normalizedPath}')`;
      },
    );
  };

  return {
    name: 'rewrite-worker-wasm-paths',
    async writeBundle(outputOptions: { dir?: string }) {
      if (!outputOptions.dir) {
        return;
      }

      const outputDir = outputOptions.dir;
      const workersDir = path.join(outputDir, 'workers');

      const visit = async (currentDir: string): Promise<void> => {
        let entries: Awaited<ReturnType<typeof fs.readdir>>;
        try {
          entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          const entryPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await visit(entryPath);
            continue;
          }

          if (!entry.isFile() || !entry.name.endsWith('.js')) {
            continue;
          }

          const source = await fs.readFile(entryPath, 'utf8');
          const normalizedFileName = path.relative(outputDir, entryPath).split(path.sep).join('/');
          const rewrittenSource = rewriteSource(normalizedFileName, source);
          if (rewrittenSource !== source) {
            await fs.writeFile(entryPath, rewrittenSource, 'utf8');
          }
        }

      };

      await visit(workersDir);
    },
  };
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
    },
    resolve: {
      alias: {
        '@schema': fileURLToPath(new URL('../schema', import.meta.url)),
        '@harmony/schema': fileURLToPath(new URL('../schema', import.meta.url)),
        '@harmony/physics-core': fileURLToPath(new URL('../physics-core/src', import.meta.url)),
        '@harmony/physics-ammo': fileURLToPath(new URL('../physics-ammo/src', import.meta.url)),
        '@harmony/physics-bridge': fileURLToPath(new URL('../physics-bridge/src', import.meta.url)),
        'vue': vueRuntimeAlias,
        // Ensure modules imported from files outside project root (e.g. ../schema)
        // resolve "three" to this package's installed dependency
        'three': fileURLToPath(new URL('./node_modules/three', import.meta.url)),
        'cannon-es': fileURLToPath(new URL('./node_modules/cannon-es', import.meta.url)),
        'three/examples': fileURLToPath(new URL('./node_modules/three/examples', import.meta.url)),
        '@three-examples': fileURLToPath(new URL('./node_modules/three/examples/jsm', import.meta.url)),
      },
    },

    server: {
      port: 8092,
      open: true, //启动后是否自动打开浏览器
      watch: {
        usePolling: shouldUsePolling,
        interval: pollingInterval,
      },
      hmr: true,
    },
    plugins: [
      // esm-only 的包
      glsl(),
      getUniPlugin(),
      visualizer({
        emitFile: true,
      }),
      // Ensure adapter-emitted workers/wasms are placed under the scenery subpackage.
      // Safe for H5: the plugin only emits these assets for non-web platforms.
      threePlatformAdapter({
        assetsOutput: {
          worker: 'workers',
          wasm: 'wasms',
        },
      }),
      rewriteWorkerWasmPaths(),
      createMpChunkSplitterPlugin({
        subpackages: ['pages/scenery', 'pages/physics'],
        singleChunkMode: true,
        packageSizeLimit: 1.8 * 1024 * 1024
      }),

      // 默认情况 uni-app 会将 node_modules 下的模块打包在 common/vendor.js
      // 这里强制 three 相关依赖进入 scenery 子包，避免主包膨胀
      toCustomChunkPlugin({
        manualChunks: {
          'pages/physics/chunks/vendor': [
            '@harmony/physics-core',
            '@harmony/physics-ammo',
            '@harmony/physics-bridge',
            'ammojs3',
            'ammojs3/**',
            '**/harmony/physics-core/**',
            '**/harmony/physics-ammo/**',
            '**/harmony/physics-bridge/**',
            '**/node_modules/ammojs3/**',
          ],
          'pages/scenery/chunks/vendor': [
            '@minisheep/three-platform-adapter',
            '@minisheep/three-platform-adapter/wechat',
            '@minisheep/three-platform-adapter/dist/three-override/jsm/**',
            'three',
            // three@0.150+ exposes examples via `three/addons/*` (maps to examples/jsm)
            'three/addons/**',
            // Catch any other examples entrypoints (legacy or non-jsm)
            'three/examples/**',
            'three/examples/jsm/**',
            'cannon-es',
            // @harmony/schema 通过 alias 解析到项目根目录之外 (../schema)，
            // createMpChunkSplitterPlugin 无法识别其归属分包，
            // 必须显式路由到 scenery 子包，否则会落入 common/vendor.js 并产生跨包 require
            '**/harmony/schema/**',
          ]
        }
      }),

      {
        name:'find-dep',
        config(config){
          // uni 插件覆盖了这个导致不能正确识别 pnpm 安装模块的依赖
          const resolve = (config as { resolve?: { preserveSymlinks?: boolean } }).resolve;
          if (resolve) {
            resolve.preserveSymlinks = true;
          } else {
            (config as { resolve: { preserveSymlinks: boolean } }).resolve = { preserveSymlinks: true };
          }
        }
      },
    ],
  };

function getUniPlugin() {
  // vite-plugin-uni 当前版本在以 ESM 形式导出格式异常（默认导出被挂在 default 上）
  const maybeModule = uni as unknown as { default?: () => unknown };
  return typeof maybeModule.default === 'function' ? maybeModule.default() : uni;
}
