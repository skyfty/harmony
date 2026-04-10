// vite.config.ts
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
import uni from "file:///mnt/d/harmony/tour/node_modules/.pnpm/@dcloudio+vite-plugin-uni@3.0.0-alpha-4050320250224001_postcss@8.5.6_rollup@4.57.1_vite_8a9dbbe3afe213f9a94e3f25785536cb/node_modules/@dcloudio/vite-plugin-uni/dist/index.js";
import threePlatformAdapter from "file:///mnt/d/harmony/tour/node_modules/.pnpm/@minisheep+three-platform-adapter@2.0.4_@minisheep+mini-program-polyfill-core@1.1.5_min_cae90e6f2515f5c84e27a163e990b0ce/node_modules/@minisheep/three-platform-adapter/dist/plugin/plugin.mjs";
import glsl from "file:///mnt/d/harmony/tour/node_modules/.pnpm/vite-plugin-glsl@1.5.5_@rollup+pluginutils@5.3.0_rollup@4.57.1__vite@5.4.21_@types+node_ecb7c8ab7b42fc4fb17e041197280bed/node_modules/vite-plugin-glsl/src/index.js";
import { visualizer } from "file:///mnt/d/harmony/tour/node_modules/.pnpm/rollup-plugin-visualizer@5.14.0_rollup@4.57.1/node_modules/rollup-plugin-visualizer/dist/plugin/index.js";
import { createMpChunkSplitterPlugin } from "file:///mnt/d/harmony/tour/node_modules/.pnpm/@minisheep+vite-plugin-mp-chunk-splitter@1.0.4_@rollup+pluginutils@5.3.0_rollup@4.57.1__7df224d7afd57d3683523d8a14268951/node_modules/@minisheep/vite-plugin-mp-chunk-splitter/dist/index.mjs";
import { toCustomChunkPlugin } from "file:///mnt/d/harmony/tour/node_modules/.pnpm/@harmony+tools@file+..+tools/node_modules/@harmony/tools/dist/vite/index.js";
var __vite_injected_original_import_meta_url = "file:///mnt/d/harmony/tour/vite.config.ts";
var uniPlatform = process.env.UNI_PLATFORM;
var isMp = uniPlatform?.startsWith("mp-");
var buildTarget = isMp ? "es2018" : "es2020";
var rawVueRuntimeAlias = isMp ? "@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js" : "@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js";
var _require = createRequire(__vite_injected_original_import_meta_url);
var vueRuntimeAlias;
try {
  vueRuntimeAlias = _require.resolve(rawVueRuntimeAlias);
} catch (e) {
  vueRuntimeAlias = "vue";
}
var isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
var shouldUsePolling = process.env.CHOKIDAR_USEPOLLING != null ? process.env.CHOKIDAR_USEPOLLING !== "0" : process.platform === "win32" || isWsl;
var parsedPollingInterval = Number.parseInt(process.env.CHOKIDAR_INTERVAL ?? "300", 10);
var pollingInterval = Number.isFinite(parsedPollingInterval) && parsedPollingInterval > 0 ? parsedPollingInterval : 300;
var vite_config_default = {
  define: {
    "import.meta.env.VITE_SCENERY_ENABLE_GLTF_KTX2": JSON.stringify("false")
  },
  optimizeDeps: {
    exclude: ["@minisheep/three-platform-adapter"],
    esbuildOptions: {
      target: buildTarget
    }
  },
  esbuild: {
    target: buildTarget
  },
  build: {
    target: buildTarget
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
    open: true,
    //启动后是否自动打开浏览器
    watch: {
      usePolling: shouldUsePolling,
      interval: pollingInterval
    },
    hmr: true
  },
  plugins: [
    // esm-only 的包
    glsl(),
    getUniPlugin(),
    visualizer({
      emitFile: true
    }),
    // Ensure adapter-emitted workers/wasms are placed under the scenery subpackage.
    // Safe for H5: the plugin only emits these assets for non-web platforms.
    threePlatformAdapter({
      assetsOutput: {
        worker: "pages/scenery/workers",
        wasm: "pages/scenery/wasms"
      }
    }),
    createMpChunkSplitterPlugin({
      subpackages: ["pages/scenery"],
      singleChunkMode: true,
      packageSizeLimit: 1.8 * 1024 * 1024
    }),
    // 默认情况 uni-app 会将 node_modules 下的模块打包在 common/vendor.js
    // 这里强制 three 相关依赖进入 scenery 子包，避免主包膨胀
    toCustomChunkPlugin({
      manualChunks: {
        "pages/scenery/chunks/vendor": [
          "@minisheep/three-platform-adapter",
          "@minisheep/three-platform-adapter/wechat",
          "@minisheep/three-platform-adapter/dist/three-override/jsm/**",
          "three",
          // three@0.150+ exposes examples via `three/addons/*` (maps to examples/jsm)
          "three/addons/**",
          // Catch any other examples entrypoints (legacy or non-jsm)
          "three/examples/**",
          "three/examples/jsm/**",
          "cannon-es",
          // @harmony/schema 通过 alias 解析到项目根目录之外 (../schema)，
          // createMpChunkSplitterPlugin 无法识别其归属分包，
          // 必须显式路由到 scenery 子包，否则会落入 common/vendor.js 并产生跨包 require
          "**/harmony/schema/**"
        ]
      }
    }),
    {
      name: "find-dep",
      config(config) {
        const resolve = config.resolve;
        if (resolve) {
          resolve.preserveSymlinks = true;
        } else {
          config.resolve = { preserveSymlinks: true };
        }
      }
    }
  ]
};
function getUniPlugin() {
  const maybeModule = uni;
  return typeof maybeModule.default === "function" ? maybeModule.default() : uni;
}
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvbW50L2QvaGFybW9ueS90b3VyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvbW50L2QvaGFybW9ueS90b3VyL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9tbnQvZC9oYXJtb255L3RvdXIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBmaWxlVVJMVG9QYXRoLCBVUkwgfSBmcm9tICdub2RlOnVybCc7XHJcbmltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tICdub2RlOm1vZHVsZSc7XHJcbmltcG9ydCB1bmkgZnJvbSAnQGRjbG91ZGlvL3ZpdGUtcGx1Z2luLXVuaSc7XHJcbmltcG9ydCB0aHJlZVBsYXRmb3JtQWRhcHRlciBmcm9tICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXIvcGx1Z2luJztcclxuaW1wb3J0IGdsc2wgZnJvbSAndml0ZS1wbHVnaW4tZ2xzbCc7XHJcbmltcG9ydCB7IHZpc3VhbGl6ZXIgfSBmcm9tICdyb2xsdXAtcGx1Z2luLXZpc3VhbGl6ZXInO1xyXG5pbXBvcnQgeyBjcmVhdGVNcENodW5rU3BsaXR0ZXJQbHVnaW4gfSBmcm9tIFwiQG1pbmlzaGVlcC92aXRlLXBsdWdpbi1tcC1jaHVuay1zcGxpdHRlclwiO1xyXG5pbXBvcnQgeyB0b0N1c3RvbUNodW5rUGx1Z2luIH0gZnJvbSBcIkBoYXJtb255L3Rvb2xzL3ZpdGVcIjtcclxuXHJcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXHJcbmNvbnN0IHVuaVBsYXRmb3JtID0gcHJvY2Vzcy5lbnYuVU5JX1BMQVRGT1JNO1xyXG5jb25zdCBpc01wID0gdW5pUGxhdGZvcm0/LnN0YXJ0c1dpdGgoJ21wLScpO1xyXG5jb25zdCBidWlsZFRhcmdldCA9IGlzTXAgPyAnZXMyMDE4JyA6ICdlczIwMjAnO1xyXG5cclxuY29uc3QgcmF3VnVlUnVudGltZUFsaWFzID0gaXNNcFxyXG4gID8gJ0BkY2xvdWRpby91bmktbXAtdnVlL2Rpc3QteC92dWUucnVudGltZS5lc20uanMnXHJcbiAgOiAnQGRjbG91ZGlvL3VuaS1oNS12dWUvZGlzdC14L3Z1ZS5ydW50aW1lLmVzbS5qcyc7XHJcblxyXG5jb25zdCBfcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKTtcclxubGV0IHZ1ZVJ1bnRpbWVBbGlhczogc3RyaW5nO1xyXG50cnkge1xyXG4gIHZ1ZVJ1bnRpbWVBbGlhcyA9IF9yZXF1aXJlLnJlc29sdmUocmF3VnVlUnVudGltZUFsaWFzKTtcclxufSBjYXRjaCAoZSkge1xyXG4gIHZ1ZVJ1bnRpbWVBbGlhcyA9ICd2dWUnO1xyXG59XHJcblxyXG5jb25zdCBpc1dzbCA9IEJvb2xlYW4ocHJvY2Vzcy5lbnYuV1NMX0RJU1RST19OQU1FIHx8IHByb2Nlc3MuZW52LldTTF9JTlRFUk9QKTtcclxuY29uc3Qgc2hvdWxkVXNlUG9sbGluZyA9XHJcbiAgcHJvY2Vzcy5lbnYuQ0hPS0lEQVJfVVNFUE9MTElORyAhPSBudWxsXHJcbiAgICA/IHByb2Nlc3MuZW52LkNIT0tJREFSX1VTRVBPTExJTkcgIT09ICcwJ1xyXG4gICAgOiBwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInIHx8IGlzV3NsO1xyXG5jb25zdCBwYXJzZWRQb2xsaW5nSW50ZXJ2YWwgPSBOdW1iZXIucGFyc2VJbnQocHJvY2Vzcy5lbnYuQ0hPS0lEQVJfSU5URVJWQUwgPz8gJzMwMCcsIDEwKTtcclxuY29uc3QgcG9sbGluZ0ludGVydmFsID1cclxuICBOdW1iZXIuaXNGaW5pdGUocGFyc2VkUG9sbGluZ0ludGVydmFsKSAmJiBwYXJzZWRQb2xsaW5nSW50ZXJ2YWwgPiAwXHJcbiAgICA/IHBhcnNlZFBvbGxpbmdJbnRlcnZhbFxyXG4gICAgOiAzMDA7XHJcblxyXG5leHBvcnQgZGVmYXVsdCB7XHJcbiAgICBkZWZpbmU6IHtcclxuICAgICAgJ2ltcG9ydC5tZXRhLmVudi5WSVRFX1NDRU5FUllfRU5BQkxFX0dMVEZfS1RYMic6IEpTT04uc3RyaW5naWZ5KCdmYWxzZScpLFxyXG4gICAgfSxcclxuICAgIG9wdGltaXplRGVwczoge1xyXG4gICAgICBleGNsdWRlOiBbJ0BtaW5pc2hlZXAvdGhyZWUtcGxhdGZvcm0tYWRhcHRlciddLFxyXG4gICAgICBlc2J1aWxkT3B0aW9uczoge1xyXG4gICAgICAgIHRhcmdldDogYnVpbGRUYXJnZXQsXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgZXNidWlsZDoge1xyXG4gICAgICB0YXJnZXQ6IGJ1aWxkVGFyZ2V0LFxyXG4gICAgfSxcclxuICAgIGJ1aWxkOiB7XHJcbiAgICAgIHRhcmdldDogYnVpbGRUYXJnZXQsXHJcbiAgICB9LFxyXG4gICAgcmVzb2x2ZToge1xyXG4gICAgICBhbGlhczoge1xyXG4gICAgICAgICdAc2NoZW1hJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuLi9zY2hlbWEnLCBpbXBvcnQubWV0YS51cmwpKSxcclxuICAgICAgICAnQGhhcm1vbnkvc2NoZW1hJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuLi9zY2hlbWEnLCBpbXBvcnQubWV0YS51cmwpKSxcclxuICAgICAgICAndnVlJzogdnVlUnVudGltZUFsaWFzLFxyXG4gICAgICAgIC8vIEVuc3VyZSBtb2R1bGVzIGltcG9ydGVkIGZyb20gZmlsZXMgb3V0c2lkZSBwcm9qZWN0IHJvb3QgKGUuZy4gLi4vc2NoZW1hKVxyXG4gICAgICAgIC8vIHJlc29sdmUgXCJ0aHJlZVwiIHRvIHRoaXMgcGFja2FnZSdzIGluc3RhbGxlZCBkZXBlbmRlbmN5XHJcbiAgICAgICAgJ3RocmVlJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuL25vZGVfbW9kdWxlcy90aHJlZScsIGltcG9ydC5tZXRhLnVybCkpLFxyXG4gICAgICAgICdjYW5ub24tZXMnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vbm9kZV9tb2R1bGVzL2Nhbm5vbi1lcycsIGltcG9ydC5tZXRhLnVybCkpLFxyXG4gICAgICAgICd0aHJlZS9leGFtcGxlcyc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9ub2RlX21vZHVsZXMvdGhyZWUvZXhhbXBsZXMnLCBpbXBvcnQubWV0YS51cmwpKSxcclxuICAgICAgICAnQHRocmVlLWV4YW1wbGVzJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuL25vZGVfbW9kdWxlcy90aHJlZS9leGFtcGxlcy9qc20nLCBpbXBvcnQubWV0YS51cmwpKSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcblxyXG4gICAgc2VydmVyOiB7XHJcbiAgICAgIHBvcnQ6IDgwOTIsXHJcbiAgICAgIG9wZW46IHRydWUsIC8vXHU1NDJGXHU1MkE4XHU1NDBFXHU2NjJGXHU1NDI2XHU4MUVBXHU1MkE4XHU2MjUzXHU1RjAwXHU2RDRGXHU4OUM4XHU1NjY4XHJcbiAgICAgIHdhdGNoOiB7XHJcbiAgICAgICAgdXNlUG9sbGluZzogc2hvdWxkVXNlUG9sbGluZyxcclxuICAgICAgICBpbnRlcnZhbDogcG9sbGluZ0ludGVydmFsLFxyXG4gICAgICB9LFxyXG4gICAgICBobXI6IHRydWUsXHJcbiAgICB9LFxyXG4gICAgcGx1Z2luczogW1xyXG4gICAgICAvLyBlc20tb25seSBcdTc2ODRcdTUzMDVcclxuICAgICAgZ2xzbCgpLFxyXG4gICAgICBnZXRVbmlQbHVnaW4oKSxcclxuICAgICAgdmlzdWFsaXplcih7XHJcbiAgICAgICAgZW1pdEZpbGU6IHRydWUsXHJcbiAgICAgIH0pLFxyXG4gICAgICAvLyBFbnN1cmUgYWRhcHRlci1lbWl0dGVkIHdvcmtlcnMvd2FzbXMgYXJlIHBsYWNlZCB1bmRlciB0aGUgc2NlbmVyeSBzdWJwYWNrYWdlLlxyXG4gICAgICAvLyBTYWZlIGZvciBINTogdGhlIHBsdWdpbiBvbmx5IGVtaXRzIHRoZXNlIGFzc2V0cyBmb3Igbm9uLXdlYiBwbGF0Zm9ybXMuXHJcbiAgICAgIHRocmVlUGxhdGZvcm1BZGFwdGVyKHtcclxuICAgICAgICBhc3NldHNPdXRwdXQ6IHtcclxuICAgICAgICAgIHdvcmtlcjogJ3BhZ2VzL3NjZW5lcnkvd29ya2VycycsXHJcbiAgICAgICAgICB3YXNtOiAncGFnZXMvc2NlbmVyeS93YXNtcycsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSksXHJcbiAgICAgIGNyZWF0ZU1wQ2h1bmtTcGxpdHRlclBsdWdpbih7XHJcbiAgICAgICAgc3VicGFja2FnZXM6IFsncGFnZXMvc2NlbmVyeSddLFxyXG4gICAgICAgIHNpbmdsZUNodW5rTW9kZTogdHJ1ZSxcclxuICAgICAgICBwYWNrYWdlU2l6ZUxpbWl0OiAxLjggKiAxMDI0ICogMTAyNFxyXG4gICAgICB9KSxcclxuXHJcbiAgICAgIC8vIFx1OUVEOFx1OEJBNFx1NjBDNVx1NTFCNSB1bmktYXBwIFx1NEYxQVx1NUMwNiBub2RlX21vZHVsZXMgXHU0RTBCXHU3Njg0XHU2QTIxXHU1NzU3XHU2MjUzXHU1MzA1XHU1NzI4IGNvbW1vbi92ZW5kb3IuanNcclxuICAgICAgLy8gXHU4RkQ5XHU5MUNDXHU1RjNBXHU1MjM2IHRocmVlIFx1NzZGOFx1NTE3M1x1NEY5RFx1OEQ1Nlx1OEZEQlx1NTE2NSBzY2VuZXJ5IFx1NUI1MFx1NTMwNVx1RkYwQ1x1OTA3Rlx1NTE0RFx1NEUzQlx1NTMwNVx1ODFBOFx1ODBDMFxyXG4gICAgICB0b0N1c3RvbUNodW5rUGx1Z2luKHtcclxuICAgICAgICBtYW51YWxDaHVua3M6IHtcclxuICAgICAgICAgICdwYWdlcy9zY2VuZXJ5L2NodW5rcy92ZW5kb3InOiBbXHJcbiAgICAgICAgICAgICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXInLFxyXG4gICAgICAgICAgICAnQG1pbmlzaGVlcC90aHJlZS1wbGF0Zm9ybS1hZGFwdGVyL3dlY2hhdCcsXHJcbiAgICAgICAgICAgICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXIvZGlzdC90aHJlZS1vdmVycmlkZS9qc20vKionLFxyXG4gICAgICAgICAgICAndGhyZWUnLFxyXG4gICAgICAgICAgICAvLyB0aHJlZUAwLjE1MCsgZXhwb3NlcyBleGFtcGxlcyB2aWEgYHRocmVlL2FkZG9ucy8qYCAobWFwcyB0byBleGFtcGxlcy9qc20pXHJcbiAgICAgICAgICAgICd0aHJlZS9hZGRvbnMvKionLFxyXG4gICAgICAgICAgICAvLyBDYXRjaCBhbnkgb3RoZXIgZXhhbXBsZXMgZW50cnlwb2ludHMgKGxlZ2FjeSBvciBub24tanNtKVxyXG4gICAgICAgICAgICAndGhyZWUvZXhhbXBsZXMvKionLFxyXG4gICAgICAgICAgICAndGhyZWUvZXhhbXBsZXMvanNtLyoqJyxcclxuICAgICAgICAgICAgJ2Nhbm5vbi1lcycsXHJcbiAgICAgICAgICAgIC8vIEBoYXJtb255L3NjaGVtYSBcdTkwMUFcdThGQzcgYWxpYXMgXHU4OUUzXHU2NzkwXHU1MjMwXHU5ODc5XHU3NkVFXHU2ODM5XHU3NkVFXHU1RjU1XHU0RTRCXHU1OTE2ICguLi9zY2hlbWEpXHVGRjBDXHJcbiAgICAgICAgICAgIC8vIGNyZWF0ZU1wQ2h1bmtTcGxpdHRlclBsdWdpbiBcdTY1RTBcdTZDRDVcdThCQzZcdTUyMkJcdTUxNzZcdTVGNTJcdTVDNUVcdTUyMDZcdTUzMDVcdUZGMENcclxuICAgICAgICAgICAgLy8gXHU1RkM1XHU5ODdCXHU2NjNFXHU1RjBGXHU4REVGXHU3NTMxXHU1MjMwIHNjZW5lcnkgXHU1QjUwXHU1MzA1XHVGRjBDXHU1NDI2XHU1MjE5XHU0RjFBXHU4NDNEXHU1MTY1IGNvbW1vbi92ZW5kb3IuanMgXHU1RTc2XHU0RUE3XHU3NTFGXHU4REU4XHU1MzA1IHJlcXVpcmVcclxuICAgICAgICAgICAgJyoqL2hhcm1vbnkvc2NoZW1hLyoqJyxcclxuICAgICAgICAgIF1cclxuICAgICAgICB9XHJcbiAgICAgIH0pLFxyXG5cclxuICAgICAge1xyXG4gICAgICAgIG5hbWU6J2ZpbmQtZGVwJyxcclxuICAgICAgICBjb25maWcoY29uZmlnKXtcclxuICAgICAgICAgIC8vIHVuaSBcdTYzRDJcdTRFRjZcdTg5ODZcdTc2RDZcdTRFODZcdThGRDlcdTRFMkFcdTVCRkNcdTgxRjRcdTRFMERcdTgwRkRcdTZCNjNcdTc4NkVcdThCQzZcdTUyMkIgcG5wbSBcdTVCODlcdTg4QzVcdTZBMjFcdTU3NTdcdTc2ODRcdTRGOURcdThENTZcclxuICAgICAgICAgIGNvbnN0IHJlc29sdmUgPSAoY29uZmlnIGFzIHsgcmVzb2x2ZT86IHsgcHJlc2VydmVTeW1saW5rcz86IGJvb2xlYW4gfSB9KS5yZXNvbHZlO1xyXG4gICAgICAgICAgaWYgKHJlc29sdmUpIHtcclxuICAgICAgICAgICAgcmVzb2x2ZS5wcmVzZXJ2ZVN5bWxpbmtzID0gdHJ1ZTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIChjb25maWcgYXMgeyByZXNvbHZlOiB7IHByZXNlcnZlU3ltbGlua3M6IGJvb2xlYW4gfSB9KS5yZXNvbHZlID0geyBwcmVzZXJ2ZVN5bWxpbmtzOiB0cnVlIH07XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgXSxcclxuICB9O1xyXG5cclxuZnVuY3Rpb24gZ2V0VW5pUGx1Z2luKCkge1xyXG4gIC8vIHZpdGUtcGx1Z2luLXVuaSBcdTVGNTNcdTUyNERcdTcyNDhcdTY3MkNcdTU3MjhcdTRFRTUgRVNNIFx1NUY2Mlx1NUYwRlx1NUJGQ1x1NTFGQVx1NjgzQ1x1NUYwRlx1NUYwMlx1NUUzOFx1RkYwOFx1OUVEOFx1OEJBNFx1NUJGQ1x1NTFGQVx1ODhBQlx1NjMwMlx1NTcyOCBkZWZhdWx0IFx1NEUwQVx1RkYwOVxyXG4gIGNvbnN0IG1heWJlTW9kdWxlID0gdW5pIGFzIHVua25vd24gYXMgeyBkZWZhdWx0PzogKCkgPT4gdW5rbm93biB9O1xyXG4gIHJldHVybiB0eXBlb2YgbWF5YmVNb2R1bGUuZGVmYXVsdCA9PT0gJ2Z1bmN0aW9uJyA/IG1heWJlTW9kdWxlLmRlZmF1bHQoKSA6IHVuaTtcclxufVxyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTJPLFNBQVMsZUFBZSxXQUFXO0FBQzlRLFNBQVMscUJBQXFCO0FBQzlCLE9BQU8sU0FBUztBQUNoQixPQUFPLDBCQUEwQjtBQUNqQyxPQUFPLFVBQVU7QUFDakIsU0FBUyxrQkFBa0I7QUFDM0IsU0FBUyxtQ0FBbUM7QUFDNUMsU0FBUywyQkFBMkI7QUFQMEcsSUFBTSwyQ0FBMkM7QUFVL0wsSUFBTSxjQUFjLFFBQVEsSUFBSTtBQUNoQyxJQUFNLE9BQU8sYUFBYSxXQUFXLEtBQUs7QUFDMUMsSUFBTSxjQUFjLE9BQU8sV0FBVztBQUV0QyxJQUFNLHFCQUFxQixPQUN2QixtREFDQTtBQUVKLElBQU0sV0FBVyxjQUFjLHdDQUFlO0FBQzlDLElBQUk7QUFDSixJQUFJO0FBQ0Ysb0JBQWtCLFNBQVMsUUFBUSxrQkFBa0I7QUFDdkQsU0FBUyxHQUFHO0FBQ1Ysb0JBQWtCO0FBQ3BCO0FBRUEsSUFBTSxRQUFRLFFBQVEsUUFBUSxJQUFJLG1CQUFtQixRQUFRLElBQUksV0FBVztBQUM1RSxJQUFNLG1CQUNKLFFBQVEsSUFBSSx1QkFBdUIsT0FDL0IsUUFBUSxJQUFJLHdCQUF3QixNQUNwQyxRQUFRLGFBQWEsV0FBVztBQUN0QyxJQUFNLHdCQUF3QixPQUFPLFNBQVMsUUFBUSxJQUFJLHFCQUFxQixPQUFPLEVBQUU7QUFDeEYsSUFBTSxrQkFDSixPQUFPLFNBQVMscUJBQXFCLEtBQUssd0JBQXdCLElBQzlELHdCQUNBO0FBRU4sSUFBTyxzQkFBUTtBQUFBLEVBQ1gsUUFBUTtBQUFBLElBQ04saURBQWlELEtBQUssVUFBVSxPQUFPO0FBQUEsRUFDekU7QUFBQSxFQUNBLGNBQWM7QUFBQSxJQUNaLFNBQVMsQ0FBQyxtQ0FBbUM7QUFBQSxJQUM3QyxnQkFBZ0I7QUFBQSxNQUNkLFFBQVE7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsUUFBUTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxFQUNWO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxXQUFXLGNBQWMsSUFBSSxJQUFJLGFBQWEsd0NBQWUsQ0FBQztBQUFBLE1BQzlELG1CQUFtQixjQUFjLElBQUksSUFBSSxhQUFhLHdDQUFlLENBQUM7QUFBQSxNQUN0RSxPQUFPO0FBQUE7QUFBQTtBQUFBLE1BR1AsU0FBUyxjQUFjLElBQUksSUFBSSx3QkFBd0Isd0NBQWUsQ0FBQztBQUFBLE1BQ3ZFLGFBQWEsY0FBYyxJQUFJLElBQUksNEJBQTRCLHdDQUFlLENBQUM7QUFBQSxNQUMvRSxrQkFBa0IsY0FBYyxJQUFJLElBQUksaUNBQWlDLHdDQUFlLENBQUM7QUFBQSxNQUN6RixtQkFBbUIsY0FBYyxJQUFJLElBQUkscUNBQXFDLHdDQUFlLENBQUM7QUFBQSxJQUNoRztBQUFBLEVBQ0Y7QUFBQSxFQUVBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsWUFBWTtBQUFBLE1BQ1osVUFBVTtBQUFBLElBQ1o7QUFBQSxJQUNBLEtBQUs7QUFBQSxFQUNQO0FBQUEsRUFDQSxTQUFTO0FBQUE7QUFBQSxJQUVQLEtBQUs7QUFBQSxJQUNMLGFBQWE7QUFBQSxJQUNiLFdBQVc7QUFBQSxNQUNULFVBQVU7QUFBQSxJQUNaLENBQUM7QUFBQTtBQUFBO0FBQUEsSUFHRCxxQkFBcUI7QUFBQSxNQUNuQixjQUFjO0FBQUEsUUFDWixRQUFRO0FBQUEsUUFDUixNQUFNO0FBQUEsTUFDUjtBQUFBLElBQ0YsQ0FBQztBQUFBLElBQ0QsNEJBQTRCO0FBQUEsTUFDMUIsYUFBYSxDQUFDLGVBQWU7QUFBQSxNQUM3QixpQkFBaUI7QUFBQSxNQUNqQixrQkFBa0IsTUFBTSxPQUFPO0FBQUEsSUFDakMsQ0FBQztBQUFBO0FBQUE7QUFBQSxJQUlELG9CQUFvQjtBQUFBLE1BQ2xCLGNBQWM7QUFBQSxRQUNaLCtCQUErQjtBQUFBLFVBQzdCO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUE7QUFBQSxVQUVBO0FBQUE7QUFBQSxVQUVBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQTtBQUFBO0FBQUE7QUFBQSxVQUlBO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGLENBQUM7QUFBQSxJQUVEO0FBQUEsTUFDRSxNQUFLO0FBQUEsTUFDTCxPQUFPLFFBQU87QUFFWixjQUFNLFVBQVcsT0FBd0Q7QUFDekUsWUFBSSxTQUFTO0FBQ1gsa0JBQVEsbUJBQW1CO0FBQUEsUUFDN0IsT0FBTztBQUNMLFVBQUMsT0FBc0QsVUFBVSxFQUFFLGtCQUFrQixLQUFLO0FBQUEsUUFDNUY7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVGLFNBQVMsZUFBZTtBQUV0QixRQUFNLGNBQWM7QUFDcEIsU0FBTyxPQUFPLFlBQVksWUFBWSxhQUFhLFlBQVksUUFBUSxJQUFJO0FBQzdFOyIsCiAgIm5hbWVzIjogW10KfQo=
