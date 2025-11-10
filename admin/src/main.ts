import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installVuetify } from './plugins/vuetify'
import { useAuthStore } from './stores/auth'
import './assets/main.scss'

// 在应用启动前异步加载运行时配置（/config/app-config.json）
async function preloadRuntimeConfig() {
  try {
    const resp = await fetch('/config/app-config.json', { cache: 'no-cache' })
    if (resp.ok) {
      const cfg = await resp.json().catch(() => null)
      if (cfg && typeof cfg === 'object') {
        ;(window as any).__HARMONY_RUNTIME_CONFIG__ = cfg
      }
    }
  } catch (err) {
    console.warn('[admin] runtime config not found, fallback to env', err)
  }
}

preloadRuntimeConfig().finally(() => {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  installVuetify(app)
  app.use(router)

  const authStore = useAuthStore()
  authStore.bootstrapFromStorage()

  router.isReady().then(() => {
    app.mount('#app')
  })
})
