import { fileURLToPath, URL } from 'node:url';
import uni from '@dcloudio/vite-plugin-uni';
import threePlatformAdapter from '@minisheep/three-platform-adapter/plugin';
import glsl from 'vite-plugin-glsl';
import { visualizer } from 'rollup-plugin-visualizer';
import { createMpChunkSplitterPlugin } from "@minisheep/vite-plugin-mp-chunk-splitter";
import { toCustomChunkPlugin } from "@harmony/tools/vite";

// https://vitejs.dev/config/
const uniPlatform = process.env.UNI_PLATFORM;
const isMp = uniPlatform?.startsWith('mp-');

const vueRuntimeAlias = isMp
  ? '@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js'
  : '@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js';

export default {
    optimizeDeps: {
      exclude: ['@minisheep/three-platform-adapter']
    },
    resolve: {
      alias: {
        '@schema': fileURLToPath(new URL('../schema', import.meta.url)),
        '@harmony/schema': fileURLToPath(new URL('../schema', import.meta.url)),
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
      open: true //启动后是否自动打开浏览器
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
          worker: 'pages/scenery/workers',
          wasm: 'pages/scenery/wasms',
        },
      }),
      createMpChunkSplitterPlugin({
        subpackages: ['pages/scenery'],
        singleChunkMode: true,
        packageSizeLimit: 1.8 * 1024 * 1024
      }),

      // 默认情况 uni-app 会将 node_modules 下的模块打包在 common/vendor.js
      // 这里强制 three 相关依赖进入 scenery 子包，避免主包膨胀
      toCustomChunkPlugin({
        manualChunks: {
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
            'cannon'
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
