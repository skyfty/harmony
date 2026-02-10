// vite.config.ts
import { defineConfig } from "file:///D:/harmony/viewer/node_modules/vite/dist/node/index.js";
import { fileURLToPath, URL } from "node:url";
import uni from "file:///D:/harmony/viewer/node_modules/@dcloudio/vite-plugin-uni/dist/index.js";
import threePlatformAdapter from "file:///D:/harmony/viewer/node_modules/@minisheep/three-platform-adapter/dist/plugin/plugin.mjs";
import glsl from "file:///D:/harmony/viewer/node_modules/vite-plugin-glsl/src/index.js";
import { visualizer } from "file:///D:/harmony/viewer/node_modules/rollup-plugin-visualizer/dist/plugin/index.js";
import { createMpChunkSplitterPlugin } from "file:///D:/harmony/viewer/node_modules/@minisheep/vite-plugin-mp-chunk-splitter/dist/index.mjs";
var __vite_injected_original_import_meta_url = "file:///D:/harmony/viewer/vite.config.ts";
var uniPlatform = process.env.UNI_PLATFORM;
var vueRuntimeAlias = uniPlatform?.startsWith("mp-") ? "@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js" : "@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js";
var vite_config_default = defineConfig({
  optimizeDeps: {
    exclude: ["@minisheep/three-platform-adapter"]
  },
  resolve: {
    alias: {
      "@schema": fileURLToPath(new URL("../schema", __vite_injected_original_import_meta_url)),
      "@harmony/schema": fileURLToPath(new URL("../schema", __vite_injected_original_import_meta_url)),
      "vue": vueRuntimeAlias,
      // Ensure modules imported from files outside project root (e.g. ../schema)
      // resolve "three" to this package's installed dependency
      "three": fileURLToPath(new URL("./node_modules/three", __vite_injected_original_import_meta_url)),
      "cannon-es": fileURLToPath(new URL("./node_modules/cannon-es", __vite_injected_original_import_meta_url)),
      "three/examples": fileURLToPath(new URL("./node_modules/three/examples", __vite_injected_original_import_meta_url)),
      "@three-examples": fileURLToPath(new URL("./node_modules/three/examples/jsm", __vite_injected_original_import_meta_url))
    }
  },
  server: {
    port: 8092,
    open: true
    //启动后是否自动打开浏览器
  },
  plugins: [
    // esm-only 的包
    glsl(),
    //@ts-expect-error 当前版本在以 esm 形式导出格式异常
    uni.default(),
    visualizer({
      emitFile: true
    }),
    threePlatformAdapter(),
    createMpChunkSplitterPlugin({
      subpackages: ["pages/scenery"],
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
      name: "find-dep",
      config(config) {
        config.resolve.preserveSymlinks = true;
      }
    }
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxoYXJtb255XFxcXHZpZXdlclwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcaGFybW9ueVxcXFx2aWV3ZXJcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L2hhcm1vbnkvdmlld2VyL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBSb2xsdXAgfSBmcm9tIFwidml0ZVwiO1xyXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoLCBVUkwgfSBmcm9tICdub2RlOnVybCc7XHJcbmltcG9ydCB1bmkgZnJvbSAnQGRjbG91ZGlvL3ZpdGUtcGx1Z2luLXVuaSc7XHJcbmltcG9ydCB0aHJlZVBsYXRmb3JtQWRhcHRlciBmcm9tICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXIvcGx1Z2luJztcclxuaW1wb3J0IGdsc2wgZnJvbSAndml0ZS1wbHVnaW4tZ2xzbCc7XHJcbmltcG9ydCB7IHZpc3VhbGl6ZXIgfSBmcm9tICdyb2xsdXAtcGx1Z2luLXZpc3VhbGl6ZXInO1xyXG5pbXBvcnQgeyBjcmVhdGVNcENodW5rU3BsaXR0ZXJQbHVnaW4gfSBmcm9tIFwiQG1pbmlzaGVlcC92aXRlLXBsdWdpbi1tcC1jaHVuay1zcGxpdHRlclwiO1xyXG5cclxuY29uc3QgdW5pUGxhdGZvcm0gPSBwcm9jZXNzLmVudi5VTklfUExBVEZPUk07XHJcbmNvbnN0IHZ1ZVJ1bnRpbWVBbGlhcyA9IHVuaVBsYXRmb3JtPy5zdGFydHNXaXRoKCdtcC0nKVxyXG4gID8gJ0BkY2xvdWRpby91bmktbXAtdnVlL2Rpc3QteC92dWUucnVudGltZS5lc20uanMnXHJcbiAgOiAnQGRjbG91ZGlvL3VuaS1oNS12dWUvZGlzdC14L3Z1ZS5ydW50aW1lLmVzbS5qcyc7XHJcblxyXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIG9wdGltaXplRGVwczoge1xyXG4gICAgZXhjbHVkZTogWydAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXInXVxyXG4gIH0sICBcclxuICByZXNvbHZlOiB7XHJcbiAgICBhbGlhczoge1xyXG4gICAgICAnQHNjaGVtYSc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4vc2NoZW1hJywgaW1wb3J0Lm1ldGEudXJsKSksXHJcbiAgICAgICdAaGFybW9ueS9zY2hlbWEnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4uL3NjaGVtYScsIGltcG9ydC5tZXRhLnVybCkpLFxyXG4gICAgICAndnVlJzogdnVlUnVudGltZUFsaWFzLFxyXG4gICAgICAvLyBFbnN1cmUgbW9kdWxlcyBpbXBvcnRlZCBmcm9tIGZpbGVzIG91dHNpZGUgcHJvamVjdCByb290IChlLmcuIC4uL3NjaGVtYSlcclxuICAgICAgLy8gcmVzb2x2ZSBcInRocmVlXCIgdG8gdGhpcyBwYWNrYWdlJ3MgaW5zdGFsbGVkIGRlcGVuZGVuY3lcclxuICAgICAgJ3RocmVlJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuL25vZGVfbW9kdWxlcy90aHJlZScsIGltcG9ydC5tZXRhLnVybCkpLFxyXG4gICAgICAnY2Fubm9uLWVzJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuL25vZGVfbW9kdWxlcy9jYW5ub24tZXMnLCBpbXBvcnQubWV0YS51cmwpKSxcclxuICAgICAgJ3RocmVlL2V4YW1wbGVzJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuL25vZGVfbW9kdWxlcy90aHJlZS9leGFtcGxlcycsIGltcG9ydC5tZXRhLnVybCkpLFxyXG4gICAgICAnQHRocmVlLWV4YW1wbGVzJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuL25vZGVfbW9kdWxlcy90aHJlZS9leGFtcGxlcy9qc20nLCBpbXBvcnQubWV0YS51cmwpKSxcclxuICAgIH0sXHJcbiAgfSxcclxuICBcclxuICBzZXJ2ZXI6IHtcclxuICAgIHBvcnQ6IDgwOTIsXHJcbiAgICBvcGVuOiB0cnVlIC8vXHU1NDJGXHU1MkE4XHU1NDBFXHU2NjJGXHU1NDI2XHU4MUVBXHU1MkE4XHU2MjUzXHU1RjAwXHU2RDRGXHU4OUM4XHU1NjY4XHJcbiAgfSxcclxuICBwbHVnaW5zOiBbXHJcbiAgICAvLyBlc20tb25seSBcdTc2ODRcdTUzMDVcclxuICAgIGdsc2woKSxcclxuICAgIC8vQHRzLWV4cGVjdC1lcnJvciBcdTVGNTNcdTUyNERcdTcyNDhcdTY3MkNcdTU3MjhcdTRFRTUgZXNtIFx1NUY2Mlx1NUYwRlx1NUJGQ1x1NTFGQVx1NjgzQ1x1NUYwRlx1NUYwMlx1NUUzOFxyXG4gICAgdW5pLmRlZmF1bHQoKSxcclxuICAgIHZpc3VhbGl6ZXIoe1xyXG4gICAgICBlbWl0RmlsZTogdHJ1ZSxcclxuICAgIH0pLFxyXG4gICAgdGhyZWVQbGF0Zm9ybUFkYXB0ZXIoKSxcclxuICAgIGNyZWF0ZU1wQ2h1bmtTcGxpdHRlclBsdWdpbih7XHJcbiAgICAgIHN1YnBhY2thZ2VzOiBbJ3BhZ2VzL3NjZW5lcnknXSxcclxuICAgICAgc2luZ2xlQ2h1bmtNb2RlOiB0cnVlLFxyXG4gICAgICBwYWNrYWdlU2l6ZUxpbWl0OiAxLjggKiAxMDI0ICogMTAyNFxyXG4gICAgfSksXHJcblxyXG5cclxuICAgIC8vIC8vXHU5RUQ4XHU4QkE0XHU2MEM1XHU1MUI1IHVuaS1hcHAgXHU0RjFBXHU1QzA2bm9kZV9tb2R1bGVzXHU0RTBCXHU3Njg0XHU2QTIxXHU1NzU3XHU1MTY4XHU5MEZEXHU2MjUzXHU1MzA1XHU1NzI4IGNvbW1vbi92ZW5kb3IuanNcclxuICAgIC8vIC8vXHU0RjYwXHU0RTVGXHU1M0VGXHU0RUU1XHU4MUVBXHU1QjlBXHU0RTQ5XHU4RjkzXHU1MUZBXHU3NkVFXHU1RjU1XHVGRjBDXHU0RjQ2XHU5NzAwXHU4MUVBXHU1REYxXHU2MjhBXHU2M0E3XHU0RTBEXHU1RjcxXHU1NENEXHU1RTk0XHU3NTI4XHU1MkEwXHU4RjdEXHU5ODdBXHU1RThGXHJcbiAgICAvLyAvL1x1NTNFRlx1NEVFNVx1OEJCRVx1N0Y2RVx1NzNBRlx1NTg4M1x1NTNEOFx1OTFDRlx1OEZEQlx1ODg0Q1x1OEMwM1x1OEJENSBcdTU5ODIgY3Jvc3MtZW52IERFQlVHPW1pbmlzaGVlcDp0by1jdXN0b20tY2h1bmsgdW5pIGJ1aWxkIC1wIG1wLXdlaXhpblxyXG4gICAgLy8gdG9DdXN0b21DaHVua1BsdWdpbih7XHJcbiAgICAvLyAgICdjb21tb24vbXktdmVuZG9yJzogW1xyXG4gICAgLy8gICAgICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXInLFxyXG4gICAgLy8gICAgICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXIvd2VjaGF0JyxcclxuICAgIC8vICAgXSxcclxuICAgIC8vICAgJ3N1Yi1wYWNrLTIvdmVuZG9yJzogW1xyXG4gICAgLy8gICAgICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXIvZGlzdC90aHJlZS1vdmVycmlkZS9qc20vKionLFxyXG4gICAgLy8gICAgICd0aHJlZScsXHJcbiAgICAvLyAgICAgJ3RocmVlL2V4YW1wbGVzL2pzbS8qKicsXHJcbiAgICAvLyAgIF1cclxuICAgIC8vIH0pLFxyXG5cclxuICAgIHtcclxuICAgICAgbmFtZTonZmluZC1kZXAnLFxyXG4gICAgICBjb25maWcoY29uZmlnKXtcclxuICAgICAgICAvLyB1bmkgXHU2M0QyXHU0RUY2XHU4OTg2XHU3NkQ2XHU0RTg2XHU4RkQ5XHU0RTJBXHU1QkZDXHU4MUY0XHU0RTBEXHU4MEZEXHU2QjYzXHU3ODZFXHU4QkM2XHU1MjJCIHBucG0gXHU1Qjg5XHU4OEM1XHU2QTIxXHU1NzU3XHU3Njg0XHU0RjlEXHU4RDU2XHJcbiAgICAgICAgY29uZmlnLnJlc29sdmUhLnByZXNlcnZlU3ltbGlua3MgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gIF0sXHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTJPLFNBQVMsb0JBQTRCO0FBQ2hSLFNBQVMsZUFBZSxXQUFXO0FBQ25DLE9BQU8sU0FBUztBQUNoQixPQUFPLDBCQUEwQjtBQUNqQyxPQUFPLFVBQVU7QUFDakIsU0FBUyxrQkFBa0I7QUFDM0IsU0FBUyxtQ0FBbUM7QUFObUcsSUFBTSwyQ0FBMkM7QUFRaE0sSUFBTSxjQUFjLFFBQVEsSUFBSTtBQUNoQyxJQUFNLGtCQUFrQixhQUFhLFdBQVcsS0FBSyxJQUNqRCxtREFDQTtBQUdKLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLGNBQWM7QUFBQSxJQUNaLFNBQVMsQ0FBQyxtQ0FBbUM7QUFBQSxFQUMvQztBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsV0FBVyxjQUFjLElBQUksSUFBSSxhQUFhLHdDQUFlLENBQUM7QUFBQSxNQUM5RCxtQkFBbUIsY0FBYyxJQUFJLElBQUksYUFBYSx3Q0FBZSxDQUFDO0FBQUEsTUFDdEUsT0FBTztBQUFBO0FBQUE7QUFBQSxNQUdQLFNBQVMsY0FBYyxJQUFJLElBQUksd0JBQXdCLHdDQUFlLENBQUM7QUFBQSxNQUN2RSxhQUFhLGNBQWMsSUFBSSxJQUFJLDRCQUE0Qix3Q0FBZSxDQUFDO0FBQUEsTUFDL0Usa0JBQWtCLGNBQWMsSUFBSSxJQUFJLGlDQUFpQyx3Q0FBZSxDQUFDO0FBQUEsTUFDekYsbUJBQW1CLGNBQWMsSUFBSSxJQUFJLHFDQUFxQyx3Q0FBZSxDQUFDO0FBQUEsSUFDaEc7QUFBQSxFQUNGO0FBQUEsRUFFQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUE7QUFBQSxFQUNSO0FBQUEsRUFDQSxTQUFTO0FBQUE7QUFBQSxJQUVQLEtBQUs7QUFBQTtBQUFBLElBRUwsSUFBSSxRQUFRO0FBQUEsSUFDWixXQUFXO0FBQUEsTUFDVCxVQUFVO0FBQUEsSUFDWixDQUFDO0FBQUEsSUFDRCxxQkFBcUI7QUFBQSxJQUNyQiw0QkFBNEI7QUFBQSxNQUMxQixhQUFhLENBQUMsZUFBZTtBQUFBLE1BQzdCLGlCQUFpQjtBQUFBLE1BQ2pCLGtCQUFrQixNQUFNLE9BQU87QUFBQSxJQUNqQyxDQUFDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBa0JEO0FBQUEsTUFDRSxNQUFLO0FBQUEsTUFDTCxPQUFPLFFBQU87QUFFWixlQUFPLFFBQVMsbUJBQW1CO0FBQUEsTUFDckM7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
