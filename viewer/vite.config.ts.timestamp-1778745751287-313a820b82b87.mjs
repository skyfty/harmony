// vite.config.ts
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
import uni from "file:///mnt/e/harmony/viewer/node_modules/.pnpm/@dcloudio+vite-plugin-uni@3.0.0-alpha-4050320250224001_postcss@8.5.6_rollup@4.57.1_vite_8a9dbbe3afe213f9a94e3f25785536cb/node_modules/@dcloudio/vite-plugin-uni/dist/index.js";
import threePlatformAdapter from "file:///mnt/e/harmony/viewer/node_modules/.pnpm/@minisheep+three-platform-adapter@2.0.4_@minisheep+mini-program-polyfill-core@1.1.5_min_cae90e6f2515f5c84e27a163e990b0ce/node_modules/@minisheep/three-platform-adapter/dist/plugin/plugin.mjs";
import glsl from "file:///mnt/e/harmony/viewer/node_modules/.pnpm/vite-plugin-glsl@1.5.5_@rollup+pluginutils@5.3.0_rollup@4.57.1__vite@5.4.21_@types+node_ecb7c8ab7b42fc4fb17e041197280bed/node_modules/vite-plugin-glsl/src/index.js";
import { visualizer } from "file:///mnt/e/harmony/viewer/node_modules/.pnpm/rollup-plugin-visualizer@5.14.0_rollup@4.57.1/node_modules/rollup-plugin-visualizer/dist/plugin/index.js";
import { createMpChunkSplitterPlugin } from "file:///mnt/e/harmony/viewer/node_modules/.pnpm/@minisheep+vite-plugin-mp-chunk-splitter@1.0.4_@rollup+pluginutils@5.3.0_rollup@4.57.1__7df224d7afd57d3683523d8a14268951/node_modules/@minisheep/vite-plugin-mp-chunk-splitter/dist/index.mjs";
import { toCustomChunkPlugin } from "file:///mnt/e/harmony/viewer/node_modules/.pnpm/@harmony+tools@file+..+tools/node_modules/@harmony/tools/dist/vite/index.js";
var __vite_injected_original_import_meta_url = "file:///mnt/e/harmony/viewer/vite.config.ts";
var uniPlatform = process.env.UNI_PLATFORM;
var isMp = uniPlatform?.startsWith("mp-");
var buildTarget = isMp ? "es2018" : "es2020";
var useBuiltHarmonyPackages = isMp && process.env.NODE_ENV === "production";
var rawVueRuntimeAlias = isMp ? "@dcloudio/uni-mp-vue/dist-x/vue.runtime.esm.js" : "@dcloudio/uni-h5-vue/dist-x/vue.runtime.esm.js";
var _require = createRequire(__vite_injected_original_import_meta_url);
var vueRuntimeAlias;
try {
  vueRuntimeAlias = _require.resolve(rawVueRuntimeAlias);
} catch {
  vueRuntimeAlias = "vue";
}
var isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
var shouldUsePolling = process.env.CHOKIDAR_USEPOLLING != null ? process.env.CHOKIDAR_USEPOLLING !== "0" : process.platform === "win32" || isWsl;
var parsedPollingInterval = Number.parseInt(process.env.CHOKIDAR_INTERVAL ?? "300", 10);
var pollingInterval = Number.isFinite(parsedPollingInterval) && parsedPollingInterval > 0 ? parsedPollingInterval : 300;
function resolveAssetFileName(assetInfo) {
  if (!isMp) {
    return void 0;
  }
  const assetName = assetInfo.name ?? "";
  if (/ammo\.wasm(?:\.[a-z0-9]+)?\.wasm$/i.test(assetName)) {
    return "pages/physics-ammo/wasms/[name]-[hash][extname]";
  }
  return void 0;
}
var vite_config_default = {
  define: {
    "import.meta.env.VITE_SCENERY_ENABLE_GLTF_DRACO": JSON.stringify("false"),
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
    target: buildTarget,
    rollupOptions: {
      output: {
        chunkFileNames: isMp ? "pages/shared/chunks/[hash].js" : "assets/chunks/[hash].js",
        entryFileNames: isMp ? "pages/shared/entries/[hash].js" : "assets/entries/[hash].js",
        assetFileNames(assetInfo) {
          return resolveAssetFileName(assetInfo) ?? "assets/[name].[hash][extname]";
        }
      }
    }
  },
  resolve: {
    alias: {
      "@schema": useBuiltHarmonyPackages ? fileURLToPath(new URL("../schema/dist", __vite_injected_original_import_meta_url)) : fileURLToPath(new URL("../schema", __vite_injected_original_import_meta_url)),
      "@harmony/schema": useBuiltHarmonyPackages ? fileURLToPath(new URL("../schema/dist", __vite_injected_original_import_meta_url)) : fileURLToPath(new URL("../schema", __vite_injected_original_import_meta_url)),
      "@harmony/physics-core": fileURLToPath(new URL("../physics-core/src", __vite_injected_original_import_meta_url)),
      "@harmony/physics-bridge": fileURLToPath(new URL("../physics-bridge/src", __vite_injected_original_import_meta_url)),
      "@harmony/physics-ammo": fileURLToPath(new URL("../physics-ammo/src", __vite_injected_original_import_meta_url)),
      "@harmony/physics-cannon": fileURLToPath(new URL("../physics-cannon/src", __vite_injected_original_import_meta_url)),
      "ammojs3": fileURLToPath(new URL("./node_modules/ammojs3", __vite_injected_original_import_meta_url)),
      "cannon-es": fileURLToPath(new URL("./node_modules/cannon-es", __vite_injected_original_import_meta_url)),
      "vue": vueRuntimeAlias,
      "three": fileURLToPath(new URL("./node_modules/three", __vite_injected_original_import_meta_url)),
      "three/examples": fileURLToPath(new URL("./node_modules/three/examples", __vite_injected_original_import_meta_url)),
      "@three-examples": fileURLToPath(new URL("./node_modules/three/examples/jsm", __vite_injected_original_import_meta_url))
    }
  },
  server: {
    port: 8092,
    open: true,
    watch: {
      usePolling: shouldUsePolling,
      interval: pollingInterval
    },
    hmr: true
  },
  plugins: [
    glsl(),
    getUniPlugin(),
    visualizer({
      emitFile: true
    }),
    // Keep adapter-emitted workers/wasms inside the scenery package boundary.
    threePlatformAdapter({
      assetsOutput: {
        worker: "pages/scenery/workers",
        wasm: "pages/scenery/wasms"
      }
    }),
    createMpChunkSplitterPlugin({
      subpackages: ["pages/scenery", "pages/physics-ammo", "pages/physics-cannon"],
      singleChunkMode: true,
      packageSizeLimit: 1.8 * 1024 * 1024
    }),
    toCustomChunkPlugin({
      manualChunks: {
        "pages/physics-ammo/chunks/vendor": [
          "@harmony/physics-core",
          "@harmony/physics-bridge",
          "@harmony/physics-ammo",
          "ammojs3",
          "ammojs3/**",
          "**/physics-core/src/**",
          "**/physics-bridge/src/**",
          "**/physics-ammo/src/**",
          "**/harmony/physics-core/**",
          "**/harmony/physics-bridge/**",
          "**/harmony/physics-ammo/**",
          "**/node_modules/ammojs3/**"
        ],
        "pages/physics-cannon/chunks/vendor": [
          "@harmony/physics-core",
          "@harmony/physics-bridge",
          "@harmony/physics-cannon",
          "cannon-es",
          "cannon-es/**",
          "**/physics-core/src/**",
          "**/physics-bridge/src/**",
          "**/physics-cannon/src/**",
          "**/harmony/physics-core/**",
          "**/harmony/physics-bridge/**",
          "**/harmony/physics-cannon/**",
          "**/node_modules/cannon-es/**"
        ],
        "pages/scenery/chunks/vendor": [
          "@minisheep/three-platform-adapter",
          "@minisheep/three-platform-adapter/wechat",
          "@minisheep/three-platform-adapter/dist/three-override/jsm/**",
          "three",
          "three/addons/**",
          "three/examples/**",
          "three/examples/jsm/**",
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvbW50L2UvaGFybW9ueS92aWV3ZXJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9tbnQvZS9oYXJtb255L3ZpZXdlci92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vbW50L2UvaGFybW9ueS92aWV3ZXIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBmaWxlVVJMVG9QYXRoLCBVUkwgfSBmcm9tICdub2RlOnVybCc7XG5pbXBvcnQgeyBjcmVhdGVSZXF1aXJlIH0gZnJvbSAnbm9kZTptb2R1bGUnO1xuaW1wb3J0IHVuaSBmcm9tICdAZGNsb3VkaW8vdml0ZS1wbHVnaW4tdW5pJztcbmltcG9ydCB0aHJlZVBsYXRmb3JtQWRhcHRlciBmcm9tICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXIvcGx1Z2luJztcbmltcG9ydCBnbHNsIGZyb20gJ3ZpdGUtcGx1Z2luLWdsc2wnO1xuaW1wb3J0IHsgdmlzdWFsaXplciB9IGZyb20gJ3JvbGx1cC1wbHVnaW4tdmlzdWFsaXplcic7XG5pbXBvcnQgeyBjcmVhdGVNcENodW5rU3BsaXR0ZXJQbHVnaW4gfSBmcm9tICdAbWluaXNoZWVwL3ZpdGUtcGx1Z2luLW1wLWNodW5rLXNwbGl0dGVyJztcbmltcG9ydCB7IHRvQ3VzdG9tQ2h1bmtQbHVnaW4gfSBmcm9tICdAaGFybW9ueS90b29scy92aXRlJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmNvbnN0IHVuaVBsYXRmb3JtID0gcHJvY2Vzcy5lbnYuVU5JX1BMQVRGT1JNO1xuY29uc3QgaXNNcCA9IHVuaVBsYXRmb3JtPy5zdGFydHNXaXRoKCdtcC0nKTtcbmNvbnN0IGJ1aWxkVGFyZ2V0ID0gaXNNcCA/ICdlczIwMTgnIDogJ2VzMjAyMCc7XG5jb25zdCB1c2VCdWlsdEhhcm1vbnlQYWNrYWdlcyA9IGlzTXAgJiYgcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdwcm9kdWN0aW9uJztcblxuY29uc3QgcmF3VnVlUnVudGltZUFsaWFzID0gaXNNcFxuICA/ICdAZGNsb3VkaW8vdW5pLW1wLXZ1ZS9kaXN0LXgvdnVlLnJ1bnRpbWUuZXNtLmpzJ1xuICA6ICdAZGNsb3VkaW8vdW5pLWg1LXZ1ZS9kaXN0LXgvdnVlLnJ1bnRpbWUuZXNtLmpzJztcblxuY29uc3QgX3JlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybCk7XG5sZXQgdnVlUnVudGltZUFsaWFzOiBzdHJpbmc7XG50cnkge1xuICB2dWVSdW50aW1lQWxpYXMgPSBfcmVxdWlyZS5yZXNvbHZlKHJhd1Z1ZVJ1bnRpbWVBbGlhcyk7XG59IGNhdGNoIHtcbiAgdnVlUnVudGltZUFsaWFzID0gJ3Z1ZSc7XG59XG5cbmNvbnN0IGlzV3NsID0gQm9vbGVhbihwcm9jZXNzLmVudi5XU0xfRElTVFJPX05BTUUgfHwgcHJvY2Vzcy5lbnYuV1NMX0lOVEVST1ApO1xuY29uc3Qgc2hvdWxkVXNlUG9sbGluZyA9XG4gIHByb2Nlc3MuZW52LkNIT0tJREFSX1VTRVBPTExJTkcgIT0gbnVsbFxuICAgID8gcHJvY2Vzcy5lbnYuQ0hPS0lEQVJfVVNFUE9MTElORyAhPT0gJzAnXG4gICAgOiBwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInIHx8IGlzV3NsO1xuY29uc3QgcGFyc2VkUG9sbGluZ0ludGVydmFsID0gTnVtYmVyLnBhcnNlSW50KHByb2Nlc3MuZW52LkNIT0tJREFSX0lOVEVSVkFMID8/ICczMDAnLCAxMCk7XG5jb25zdCBwb2xsaW5nSW50ZXJ2YWwgPVxuICBOdW1iZXIuaXNGaW5pdGUocGFyc2VkUG9sbGluZ0ludGVydmFsKSAmJiBwYXJzZWRQb2xsaW5nSW50ZXJ2YWwgPiAwXG4gICAgPyBwYXJzZWRQb2xsaW5nSW50ZXJ2YWxcbiAgICA6IDMwMDtcblxuZnVuY3Rpb24gcmVzb2x2ZUFzc2V0RmlsZU5hbWUoYXNzZXRJbmZvOiB7IG5hbWU/OiBzdHJpbmcgfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICghaXNNcCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBhc3NldE5hbWUgPSBhc3NldEluZm8ubmFtZSA/PyAnJztcbiAgaWYgKC9hbW1vXFwud2FzbSg/OlxcLlthLXowLTldKyk/XFwud2FzbSQvaS50ZXN0KGFzc2V0TmFtZSkpIHtcbiAgICByZXR1cm4gJ3BhZ2VzL3BoeXNpY3MtYW1tby93YXNtcy9bbmFtZV0tW2hhc2hdW2V4dG5hbWVdJztcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgZGVmaW5lOiB7XG4gICAgJ2ltcG9ydC5tZXRhLmVudi5WSVRFX1NDRU5FUllfRU5BQkxFX0dMVEZfRFJBQ08nOiBKU09OLnN0cmluZ2lmeSgnZmFsc2UnKSxcbiAgICAnaW1wb3J0Lm1ldGEuZW52LlZJVEVfU0NFTkVSWV9FTkFCTEVfR0xURl9LVFgyJzogSlNPTi5zdHJpbmdpZnkoJ2ZhbHNlJyksXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnQG1pbmlzaGVlcC90aHJlZS1wbGF0Zm9ybS1hZGFwdGVyJ10sXG4gICAgZXNidWlsZE9wdGlvbnM6IHtcbiAgICAgIHRhcmdldDogYnVpbGRUYXJnZXQsXG4gICAgfSxcbiAgfSxcbiAgZXNidWlsZDoge1xuICAgIHRhcmdldDogYnVpbGRUYXJnZXQsXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgdGFyZ2V0OiBidWlsZFRhcmdldCxcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgY2h1bmtGaWxlTmFtZXM6IGlzTXAgPyAncGFnZXMvc2hhcmVkL2NodW5rcy9baGFzaF0uanMnIDogJ2Fzc2V0cy9jaHVua3MvW2hhc2hdLmpzJyxcbiAgICAgICAgZW50cnlGaWxlTmFtZXM6IGlzTXAgPyAncGFnZXMvc2hhcmVkL2VudHJpZXMvW2hhc2hdLmpzJyA6ICdhc3NldHMvZW50cmllcy9baGFzaF0uanMnLFxuICAgICAgICBhc3NldEZpbGVOYW1lcyhhc3NldEluZm8pIHtcbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZUFzc2V0RmlsZU5hbWUoYXNzZXRJbmZvKSA/PyAnYXNzZXRzL1tuYW1lXS5baGFzaF1bZXh0bmFtZV0nO1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAc2NoZW1hJzogdXNlQnVpbHRIYXJtb255UGFja2FnZXNcbiAgICAgICAgPyBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4uL3NjaGVtYS9kaXN0JywgaW1wb3J0Lm1ldGEudXJsKSlcbiAgICAgICAgOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4uL3NjaGVtYScsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgICAgJ0BoYXJtb255L3NjaGVtYSc6IHVzZUJ1aWx0SGFybW9ueVBhY2thZ2VzXG4gICAgICAgID8gZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuLi9zY2hlbWEvZGlzdCcsIGltcG9ydC5tZXRhLnVybCkpXG4gICAgICAgIDogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuLi9zY2hlbWEnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgICdAaGFybW9ueS9waHlzaWNzLWNvcmUnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4uL3BoeXNpY3MtY29yZS9zcmMnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgICdAaGFybW9ueS9waHlzaWNzLWJyaWRnZSc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4vcGh5c2ljcy1icmlkZ2Uvc3JjJywgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgICAnQGhhcm1vbnkvcGh5c2ljcy1hbW1vJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuLi9waHlzaWNzLWFtbW8vc3JjJywgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgICAnQGhhcm1vbnkvcGh5c2ljcy1jYW5ub24nOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4uL3BoeXNpY3MtY2Fubm9uL3NyYycsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgICAgJ2FtbW9qczMnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vbm9kZV9tb2R1bGVzL2FtbW9qczMnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgICdjYW5ub24tZXMnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vbm9kZV9tb2R1bGVzL2Nhbm5vbi1lcycsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgICAgJ3Z1ZSc6IHZ1ZVJ1bnRpbWVBbGlhcyxcbiAgICAgICd0aHJlZSc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9ub2RlX21vZHVsZXMvdGhyZWUnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgICd0aHJlZS9leGFtcGxlcyc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9ub2RlX21vZHVsZXMvdGhyZWUvZXhhbXBsZXMnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgICdAdGhyZWUtZXhhbXBsZXMnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vbm9kZV9tb2R1bGVzL3RocmVlL2V4YW1wbGVzL2pzbScsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDgwOTIsXG4gICAgb3BlbjogdHJ1ZSxcbiAgICB3YXRjaDoge1xuICAgICAgdXNlUG9sbGluZzogc2hvdWxkVXNlUG9sbGluZyxcbiAgICAgIGludGVydmFsOiBwb2xsaW5nSW50ZXJ2YWwsXG4gICAgfSxcbiAgICBobXI6IHRydWUsXG4gIH0sXG4gIHBsdWdpbnM6IFtcbiAgICBnbHNsKCksXG4gICAgZ2V0VW5pUGx1Z2luKCksXG4gICAgdmlzdWFsaXplcih7XG4gICAgICBlbWl0RmlsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICAvLyBLZWVwIGFkYXB0ZXItZW1pdHRlZCB3b3JrZXJzL3dhc21zIGluc2lkZSB0aGUgc2NlbmVyeSBwYWNrYWdlIGJvdW5kYXJ5LlxuICAgIHRocmVlUGxhdGZvcm1BZGFwdGVyKHtcbiAgICAgIGFzc2V0c091dHB1dDoge1xuICAgICAgICB3b3JrZXI6ICdwYWdlcy9zY2VuZXJ5L3dvcmtlcnMnLFxuICAgICAgICB3YXNtOiAncGFnZXMvc2NlbmVyeS93YXNtcycsXG4gICAgICB9LFxuICAgIH0pLFxuICAgIGNyZWF0ZU1wQ2h1bmtTcGxpdHRlclBsdWdpbih7XG4gICAgICBzdWJwYWNrYWdlczogWydwYWdlcy9zY2VuZXJ5JywgJ3BhZ2VzL3BoeXNpY3MtYW1tbycsICdwYWdlcy9waHlzaWNzLWNhbm5vbiddLFxuICAgICAgc2luZ2xlQ2h1bmtNb2RlOiB0cnVlLFxuICAgICAgcGFja2FnZVNpemVMaW1pdDogMS44ICogMTAyNCAqIDEwMjQsXG4gICAgfSksXG4gICAgdG9DdXN0b21DaHVua1BsdWdpbih7XG4gICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgJ3BhZ2VzL3BoeXNpY3MtYW1tby9jaHVua3MvdmVuZG9yJzogW1xuICAgICAgICAgICdAaGFybW9ueS9waHlzaWNzLWNvcmUnLFxuICAgICAgICAgICdAaGFybW9ueS9waHlzaWNzLWJyaWRnZScsXG4gICAgICAgICAgJ0BoYXJtb255L3BoeXNpY3MtYW1tbycsXG4gICAgICAgICAgJ2FtbW9qczMnLFxuICAgICAgICAgICdhbW1vanMzLyoqJyxcbiAgICAgICAgICAnKiovcGh5c2ljcy1jb3JlL3NyYy8qKicsXG4gICAgICAgICAgJyoqL3BoeXNpY3MtYnJpZGdlL3NyYy8qKicsXG4gICAgICAgICAgJyoqL3BoeXNpY3MtYW1tby9zcmMvKionLFxuICAgICAgICAgICcqKi9oYXJtb255L3BoeXNpY3MtY29yZS8qKicsXG4gICAgICAgICAgJyoqL2hhcm1vbnkvcGh5c2ljcy1icmlkZ2UvKionLFxuICAgICAgICAgICcqKi9oYXJtb255L3BoeXNpY3MtYW1tby8qKicsXG4gICAgICAgICAgJyoqL25vZGVfbW9kdWxlcy9hbW1vanMzLyoqJyxcbiAgICAgICAgXSxcbiAgICAgICAgJ3BhZ2VzL3BoeXNpY3MtY2Fubm9uL2NodW5rcy92ZW5kb3InOiBbXG4gICAgICAgICAgJ0BoYXJtb255L3BoeXNpY3MtY29yZScsXG4gICAgICAgICAgJ0BoYXJtb255L3BoeXNpY3MtYnJpZGdlJyxcbiAgICAgICAgICAnQGhhcm1vbnkvcGh5c2ljcy1jYW5ub24nLFxuICAgICAgICAgICdjYW5ub24tZXMnLFxuICAgICAgICAgICdjYW5ub24tZXMvKionLFxuICAgICAgICAgICcqKi9waHlzaWNzLWNvcmUvc3JjLyoqJyxcbiAgICAgICAgICAnKiovcGh5c2ljcy1icmlkZ2Uvc3JjLyoqJyxcbiAgICAgICAgICAnKiovcGh5c2ljcy1jYW5ub24vc3JjLyoqJyxcbiAgICAgICAgICAnKiovaGFybW9ueS9waHlzaWNzLWNvcmUvKionLFxuICAgICAgICAgICcqKi9oYXJtb255L3BoeXNpY3MtYnJpZGdlLyoqJyxcbiAgICAgICAgICAnKiovaGFybW9ueS9waHlzaWNzLWNhbm5vbi8qKicsXG4gICAgICAgICAgJyoqL25vZGVfbW9kdWxlcy9jYW5ub24tZXMvKionLFxuICAgICAgICBdLFxuICAgICAgICAncGFnZXMvc2NlbmVyeS9jaHVua3MvdmVuZG9yJzogW1xuICAgICAgICAgICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXInLFxuICAgICAgICAgICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXIvd2VjaGF0JyxcbiAgICAgICAgICAnQG1pbmlzaGVlcC90aHJlZS1wbGF0Zm9ybS1hZGFwdGVyL2Rpc3QvdGhyZWUtb3ZlcnJpZGUvanNtLyoqJyxcbiAgICAgICAgICAndGhyZWUnLFxuICAgICAgICAgICd0aHJlZS9hZGRvbnMvKionLFxuICAgICAgICAgICd0aHJlZS9leGFtcGxlcy8qKicsXG4gICAgICAgICAgJ3RocmVlL2V4YW1wbGVzL2pzbS8qKicsXG4gICAgICAgICAgJyoqL2hhcm1vbnkvc2NoZW1hLyoqJyxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSksXG4gICAge1xuICAgICAgbmFtZTogJ2ZpbmQtZGVwJyxcbiAgICAgIGNvbmZpZyhjb25maWcpIHtcbiAgICAgICAgY29uc3QgcmVzb2x2ZSA9IChjb25maWcgYXMgeyByZXNvbHZlPzogeyBwcmVzZXJ2ZVN5bWxpbmtzPzogYm9vbGVhbiB9IH0pLnJlc29sdmU7XG4gICAgICAgIGlmIChyZXNvbHZlKSB7XG4gICAgICAgICAgcmVzb2x2ZS5wcmVzZXJ2ZVN5bWxpbmtzID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAoY29uZmlnIGFzIHsgcmVzb2x2ZTogeyBwcmVzZXJ2ZVN5bWxpbmtzOiBib29sZWFuIH0gfSkucmVzb2x2ZSA9IHsgcHJlc2VydmVTeW1saW5rczogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0sXG4gIF0sXG59O1xuXG5mdW5jdGlvbiBnZXRVbmlQbHVnaW4oKSB7XG4gIGNvbnN0IG1heWJlTW9kdWxlID0gdW5pIGFzIHVua25vd24gYXMgeyBkZWZhdWx0PzogKCkgPT4gdW5rbm93biB9O1xuICByZXR1cm4gdHlwZW9mIG1heWJlTW9kdWxlLmRlZmF1bHQgPT09ICdmdW5jdGlvbicgPyBtYXliZU1vZHVsZS5kZWZhdWx0KCkgOiB1bmk7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWlQLFNBQVMsZUFBZSxXQUFXO0FBQ3BSLFNBQVMscUJBQXFCO0FBQzlCLE9BQU8sU0FBUztBQUNoQixPQUFPLDBCQUEwQjtBQUNqQyxPQUFPLFVBQVU7QUFDakIsU0FBUyxrQkFBa0I7QUFDM0IsU0FBUyxtQ0FBbUM7QUFDNUMsU0FBUywyQkFBMkI7QUFQOEcsSUFBTSwyQ0FBMkM7QUFVbk0sSUFBTSxjQUFjLFFBQVEsSUFBSTtBQUNoQyxJQUFNLE9BQU8s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
