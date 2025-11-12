import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installVuetify } from './plugins/vuetify'
import { useAuthStore } from './stores/auth'
import './assets/main.scss'

async function preloadRuntimeConfig(): Promise<void> {
  try {
    const response = await fetch('/config/app-config.json', { cache: 'no-store' })
    if (response.ok) {
      const payload = await response.json().catch(() => null)
      if (payload && typeof payload === 'object') {
        ;(window as any).__HARMONY_RUNTIME_CONFIG__ = payload
      }
    }
  } catch (error) {
    console.warn('[uploader] runtime config not found, fallback to .env', error)
  }
}

preloadRuntimeConfig().finally(async () => {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  installVuetify(app)
  app.use(router)

  const authStore = useAuthStore()
  await authStore.bootstrapFromStorage()

  await router.isReady()
  app.mount('#app')
})
