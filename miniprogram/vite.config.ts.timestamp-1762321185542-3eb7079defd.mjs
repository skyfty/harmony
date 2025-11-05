// vite.config.ts
import { defineConfig } from "file:///D:/harmony/miniprogram/node_modules/vite/dist/node/index.js";
import { fileURLToPath, URL } from "node:url";
import uni from "file:///D:/harmony/miniprogram/node_modules/@dcloudio/vite-plugin-uni/dist/index.js";
import threePlatformAdapter from "file:///D:/harmony/miniprogram/node_modules/@minisheep/three-platform-adapter/dist/plugin/plugin.mjs";
import glsl from "file:///D:/harmony/miniprogram/node_modules/vite-plugin-glsl/src/index.js";
import { visualizer } from "file:///D:/harmony/miniprogram/node_modules/rollup-plugin-visualizer/dist/plugin/index.js";
import { createMpChunkSplitterPlugin } from "file:///D:/harmony/miniprogram/node_modules/@minisheep/vite-plugin-mp-chunk-splitter/dist/index.mjs";
var __vite_injected_original_import_meta_url = "file:///D:/harmony/miniprogram/vite.config.ts";
var vite_config_default = defineConfig({
  optimizeDeps: {
    exclude: ["@minisheep/three-platform-adapter"]
  },
  resolve: {
    alias: {
      "@schema": fileURLToPath(new URL("../schema", __vite_injected_original_import_meta_url)),
      // Ensure modules imported from files outside project root (e.g. ../schema)
      // resolve "three" to this package's installed dependency
      "three": fileURLToPath(new URL("./node_modules/three", __vite_injected_original_import_meta_url)),
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
        config.resolve.preserveSymlinks = false;
      }
    }
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxoYXJtb255XFxcXG1pbmlwcm9ncmFtXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxoYXJtb255XFxcXG1pbmlwcm9ncmFtXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9oYXJtb255L21pbmlwcm9ncmFtL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBSb2xsdXAgfSBmcm9tIFwidml0ZVwiO1xyXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoLCBVUkwgfSBmcm9tICdub2RlOnVybCc7XHJcbmltcG9ydCB1bmkgZnJvbSAnQGRjbG91ZGlvL3ZpdGUtcGx1Z2luLXVuaSc7XHJcbmltcG9ydCB0aHJlZVBsYXRmb3JtQWRhcHRlciBmcm9tICdAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXIvcGx1Z2luJztcclxuaW1wb3J0IGdsc2wgZnJvbSAndml0ZS1wbHVnaW4tZ2xzbCc7XHJcbmltcG9ydCB7IHZpc3VhbGl6ZXIgfSBmcm9tICdyb2xsdXAtcGx1Z2luLXZpc3VhbGl6ZXInO1xyXG5pbXBvcnQgeyBjcmVhdGVNcENodW5rU3BsaXR0ZXJQbHVnaW4gfSBmcm9tIFwiQG1pbmlzaGVlcC92aXRlLXBsdWdpbi1tcC1jaHVuay1zcGxpdHRlclwiO1xyXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIG9wdGltaXplRGVwczoge1xyXG4gICAgZXhjbHVkZTogWydAbWluaXNoZWVwL3RocmVlLXBsYXRmb3JtLWFkYXB0ZXInXVxyXG4gIH0sICBcclxuICByZXNvbHZlOiB7XHJcbiAgICBhbGlhczoge1xyXG4gICAgICAnQHNjaGVtYSc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4vc2NoZW1hJywgaW1wb3J0Lm1ldGEudXJsKSksXHJcbiAgICAgIC8vIEVuc3VyZSBtb2R1bGVzIGltcG9ydGVkIGZyb20gZmlsZXMgb3V0c2lkZSBwcm9qZWN0IHJvb3QgKGUuZy4gLi4vc2NoZW1hKVxyXG4gICAgICAvLyByZXNvbHZlIFwidGhyZWVcIiB0byB0aGlzIHBhY2thZ2UncyBpbnN0YWxsZWQgZGVwZW5kZW5jeVxyXG4gICAgICAndGhyZWUnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vbm9kZV9tb2R1bGVzL3RocmVlJywgaW1wb3J0Lm1ldGEudXJsKSksXHJcbiAgICAgICd0aHJlZS9leGFtcGxlcyc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9ub2RlX21vZHVsZXMvdGhyZWUvZXhhbXBsZXMnLCBpbXBvcnQubWV0YS51cmwpKSxcclxuICAgICAgJ0B0aHJlZS1leGFtcGxlcyc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9ub2RlX21vZHVsZXMvdGhyZWUvZXhhbXBsZXMvanNtJywgaW1wb3J0Lm1ldGEudXJsKSksXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAgXHJcbiAgc2VydmVyOiB7XHJcbiAgICBwb3J0OiA4MDkyLFxyXG4gICAgb3BlbjogdHJ1ZSAvL1x1NTQyRlx1NTJBOFx1NTQwRVx1NjYyRlx1NTQyNlx1ODFFQVx1NTJBOFx1NjI1M1x1NUYwMFx1NkQ0Rlx1ODlDOFx1NTY2OFxyXG4gIH0sXHJcbiAgcGx1Z2luczogW1xyXG4gICAgLy8gZXNtLW9ubHkgXHU3Njg0XHU1MzA1XHJcbiAgICBnbHNsKCksXHJcbiAgICAvL0B0cy1leHBlY3QtZXJyb3IgXHU1RjUzXHU1MjREXHU3MjQ4XHU2NzJDXHU1NzI4XHU0RUU1IGVzbSBcdTVGNjJcdTVGMEZcdTVCRkNcdTUxRkFcdTY4M0NcdTVGMEZcdTVGMDJcdTVFMzhcclxuICAgIHVuaS5kZWZhdWx0KCksXHJcbiAgICB2aXN1YWxpemVyKHtcclxuICAgICAgZW1pdEZpbGU6IHRydWUsXHJcbiAgICB9KSxcclxuICAgIHRocmVlUGxhdGZvcm1BZGFwdGVyKCksXHJcbiAgICBjcmVhdGVNcENodW5rU3BsaXR0ZXJQbHVnaW4oe1xyXG4gICAgICBzaW5nbGVDaHVua01vZGU6IHRydWUsXHJcbiAgICAgIHBhY2thZ2VTaXplTGltaXQ6IDEuOCAqIDEwMjQgKiAxMDI0XHJcbiAgICB9KSxcclxuXHJcblxyXG4gICAgLy8gLy9cdTlFRDhcdThCQTRcdTYwQzVcdTUxQjUgdW5pLWFwcCBcdTRGMUFcdTVDMDZub2RlX21vZHVsZXNcdTRFMEJcdTc2ODRcdTZBMjFcdTU3NTdcdTUxNjhcdTkwRkRcdTYyNTNcdTUzMDVcdTU3MjggY29tbW9uL3ZlbmRvci5qc1xyXG4gICAgLy8gLy9cdTRGNjBcdTRFNUZcdTUzRUZcdTRFRTVcdTgxRUFcdTVCOUFcdTRFNDlcdThGOTNcdTUxRkFcdTc2RUVcdTVGNTVcdUZGMENcdTRGNDZcdTk3MDBcdTgxRUFcdTVERjFcdTYyOEFcdTYzQTdcdTRFMERcdTVGNzFcdTU0Q0RcdTVFOTRcdTc1MjhcdTUyQTBcdThGN0RcdTk4N0FcdTVFOEZcclxuICAgIC8vIC8vXHU1M0VGXHU0RUU1XHU4QkJFXHU3RjZFXHU3M0FGXHU1ODgzXHU1M0Q4XHU5MUNGXHU4RkRCXHU4ODRDXHU4QzAzXHU4QkQ1IFx1NTk4MiBjcm9zcy1lbnYgREVCVUc9bWluaXNoZWVwOnRvLWN1c3RvbS1jaHVuayB1bmkgYnVpbGQgLXAgbXAtd2VpeGluXHJcbiAgICAvLyB0b0N1c3RvbUNodW5rUGx1Z2luKHtcclxuICAgIC8vICAgJ2NvbW1vbi9teS12ZW5kb3InOiBbXHJcbiAgICAvLyAgICAgJ0BtaW5pc2hlZXAvdGhyZWUtcGxhdGZvcm0tYWRhcHRlcicsXHJcbiAgICAvLyAgICAgJ0BtaW5pc2hlZXAvdGhyZWUtcGxhdGZvcm0tYWRhcHRlci93ZWNoYXQnLFxyXG4gICAgLy8gICBdLFxyXG4gICAgLy8gICAnc3ViLXBhY2stMi92ZW5kb3InOiBbXHJcbiAgICAvLyAgICAgJ0BtaW5pc2hlZXAvdGhyZWUtcGxhdGZvcm0tYWRhcHRlci9kaXN0L3RocmVlLW92ZXJyaWRlL2pzbS8qKicsXHJcbiAgICAvLyAgICAgJ3RocmVlJyxcclxuICAgIC8vICAgICAndGhyZWUvZXhhbXBsZXMvanNtLyoqJyxcclxuICAgIC8vICAgXVxyXG4gICAgLy8gfSksXHJcblxyXG4gICAge1xyXG4gICAgICBuYW1lOidmaW5kLWRlcCcsXHJcbiAgICAgIGNvbmZpZyhjb25maWcpe1xyXG4gICAgICAgIC8vIHVuaSBcdTYzRDJcdTRFRjZcdTg5ODZcdTc2RDZcdTRFODZcdThGRDlcdTRFMkFcdTVCRkNcdTgxRjRcdTRFMERcdTgwRkRcdTZCNjNcdTc4NkVcdThCQzZcdTUyMkIgcG5wbSBcdTVCODlcdTg4QzVcdTZBMjFcdTU3NTdcdTc2ODRcdTRGOURcdThENTZcclxuICAgICAgICBjb25maWcucmVzb2x2ZSEucHJlc2VydmVTeW1saW5rcyA9IGZhbHNlO1xyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gIF0sXHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTBQLFNBQVMsb0JBQTRCO0FBQy9SLFNBQVMsZUFBZSxXQUFXO0FBQ25DLE9BQU8sU0FBUztBQUNoQixPQUFPLDBCQUEwQjtBQUNqQyxPQUFPLFVBQVU7QUFDakIsU0FBUyxrQkFBa0I7QUFDM0IsU0FBUyxtQ0FBbUM7QUFONkcsSUFBTSwyQ0FBMkM7QUFRMU0sSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFDLG1DQUFtQztBQUFBLEVBQy9DO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxXQUFXLGNBQWMsSUFBSSxJQUFJLGFBQWEsd0NBQWUsQ0FBQztBQUFBO0FBQUE7QUFBQSxNQUc5RCxTQUFTLGNBQWMsSUFBSSxJQUFJLHdCQUF3Qix3Q0FBZSxDQUFDO0FBQUEsTUFDdkUsa0JBQWtCLGNBQWMsSUFBSSxJQUFJLGlDQUFpQyx3Q0FBZSxDQUFDO0FBQUEsTUFDekYsbUJBQW1CLGNBQWMsSUFBSSxJQUFJLHFDQUFxQyx3Q0FBZSxDQUFDO0FBQUEsSUFDaEc7QUFBQSxFQUNGO0FBQUEsRUFFQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUE7QUFBQSxFQUNSO0FBQUEsRUFDQSxTQUFTO0FBQUE7QUFBQSxJQUVQLEtBQUs7QUFBQTtBQUFBLElBRUwsSUFBSSxRQUFRO0FBQUEsSUFDWixXQUFXO0FBQUEsTUFDVCxVQUFVO0FBQUEsSUFDWixDQUFDO0FBQUEsSUFDRCxxQkFBcUI7QUFBQSxJQUNyQiw0QkFBNEI7QUFBQSxNQUMxQixpQkFBaUI7QUFBQSxNQUNqQixrQkFBa0IsTUFBTSxPQUFPO0FBQUEsSUFDakMsQ0FBQztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQWtCRDtBQUFBLE1BQ0UsTUFBSztBQUFBLE1BQ0wsT0FBTyxRQUFPO0FBRVosZUFBTyxRQUFTLG1CQUFtQjtBQUFBLE1BQ3JDO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
