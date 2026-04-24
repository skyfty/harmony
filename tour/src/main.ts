// #ifndef H5
import '@minisheep/mini-program-polyfill-core/wechat-polyfill';
// import '@minisheep/mini-program-polyfill-core/xml-addon'; // �����Ŀ��ʹ������Ҫ DOMParser ֧�ֵĲ��֣�Ҳ���Ժ������赼�룬����Ӱ��������С
// #endif
import { createSSRApp } from "vue";
import { createPinia } from 'pinia';
import App from "./App.vue";
import { installShareSupport } from '@/services/share';

export function createApp() {
  const app = createSSRApp(App);
  const pinia = createPinia();
  app.use(pinia);
  installShareSupport(app);
  return {
    app,
    pinia,
  };
}
