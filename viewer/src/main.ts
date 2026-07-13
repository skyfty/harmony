// #ifdef MP-WEIXIN
import '@minisheep/mini-program-polyfill-core/wechat-polyfill';
// import '@minisheep/mini-program-polyfill-core/xml-addon'; // if the project needs DOMParser support later, import it here
// #endif
import { createSSRApp } from 'vue';
import App from './App.vue';
import { configureHarmonyRuntime } from '@harmony/utils';

configureHarmonyRuntime({
  http: {
    isDev: import.meta.env.DEV,
    apiBaseUrl: import.meta.env.VITE_MINI_TEST_API_BASE || import.meta.env.VITE_MINI_API_BASE,
    downloadCdnBaseUrl: import.meta.env.VITE_MINI_DOWNLOAD_CDN_BASE,
    testAccount: {
      username: import.meta.env.VITE_MINI_TEST_USER,
      password: import.meta.env.VITE_MINI_TEST_PASSWORD,
      displayName: import.meta.env.VITE_MINI_TEST_DISPLAY_NAME,
    },
  },
  scenery: {
    enableGltfDraco: String(import.meta.env.VITE_SCENERY_ENABLE_GLTF_DRACO ?? '').trim().toLowerCase() !== 'false',
  },
});

export function createApp() {
  const app = createSSRApp(App);
  return {
    app,
  };
}
