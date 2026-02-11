// #ifndef H5
import '@minisheep/mini-program-polyfill-core/wechat-polyfill';
// #endif

import { createSSRApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

export function createApp() {
  const app = createSSRApp(App);
  const pinia = createPinia();
  app.use(pinia);
  return {
    app,
    pinia,
  };
}
