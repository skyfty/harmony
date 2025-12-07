// #ifndef H5
import '@minisheep/mini-program-polyfill-core/wechat-polyfill';
// import '@minisheep/mini-program-polyfill-core/xml-addon'; // 如果项目中使用了需要 DOMParser 支持的部分，也可以后续按需导入，避免影响主包大小
// #endif
import { createSSRApp } from "vue";
import { createPinia } from 'pinia';
import App from "./App.vue";
// #ifdef MP-WEIXIN
import '@minisheep/three-platform-adapter/wechat';
// #endif
// #ifdef H5
import Viewer from 'v-viewer';
import 'viewerjs/dist/viewer.css';
import '@mdi/font/css/materialdesignicons.css';
// #endif

export function createApp() {
  const app = createSSRApp(App);
  const pinia = createPinia();
  app.use(pinia);
  // #ifdef H5
  app.use(Viewer);
  // #endif
  return {
    app,
    pinia,
  };
}
