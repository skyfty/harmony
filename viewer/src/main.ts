import { createSSRApp } from "vue";
import { createPinia } from 'pinia';
import App from "./App.vue";


export function createApp() {
  const app = createSSRApp(App);
  const pinia = createPinia();
  app.use(pinia);
  console.log("App created");
  return {
    app,
    pinia,
  };
}
