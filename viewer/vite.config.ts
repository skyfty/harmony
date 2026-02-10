import { defineConfig, Rollup } from "vite";
import { fileURLToPath, URL } from 'node:url';
import uni from '@dcloudio/vite-plugin-uni';
import threePlatformAdapter from '@minisheep/three-platform-adapter/plugin';
import glsl from 'vite-plugin-glsl';
import { visualizer } from 'rollup-plugin-visualizer';
import { createMpChunkSplitterPlugin } from "@minisheep/vite-plugin-mp-chunk-splitter";

const uniPlatform = process.env.UNI_PLATFORM;
const vueRuntimeAlias = uniPlatform?.startsWith('mp-')
  ? '@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js'
  : '@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js';

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    exclude: ['@minisheep/three-platform-adapter']
  },  
  resolve: {
    alias: {
      '@schema': fileURLToPath(new URL('../schema', import.meta.url)),
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
    //@ts-expect-error 当前版本在以 esm 形式导出格式异常
    uni.default(),
    visualizer({
      emitFile: true,
    }),
    threePlatformAdapter(),
    createMpChunkSplitterPlugin({
      singleChunkMode: true,
      packageSizeLimit: 1.8 * 1024 * 1024
    }),


    // //默认情况 uni-app 会将node_modules下的模块全都打包在 common/vendor.js
    // //你也可以自定义输出目录，但需自己把控不影响应用加载顺序
    // //可以设置环境变量进行调试 如 cross-env DEBUG=minisheep:to-custom-chunk uni build -p mp-weixin
    // toCustomChunkPlugin({
    //   'common/my-vendor': [
    //     '@minisheep/three-platform-adapter',
    //     '@minisheep/three-platform-adapter/wechat',
    //   ],
    //   'sub-pack-2/vendor': [
    //     '@minisheep/three-platform-adapter/dist/three-override/jsm/**',
    //     'three',
    //     'three/examples/jsm/**',
    //   ]
    // }),

    {
      name:'find-dep',
      config(config){
        // uni 插件覆盖了这个导致不能正确识别 pnpm 安装模块的依赖
        config.resolve!.preserveSymlinks = false;
      }
    },
  ],
});
