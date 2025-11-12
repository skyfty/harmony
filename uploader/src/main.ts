import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useAuthStore } from './stores/auth'
import './assets/main.css'

async function preloadRuntimeConfig(): Promise<void> {
  try {
    const response = await fetch('/config/app-config.json', { cache: 'no-cache' })
    if (!response.ok) {
      return
    }
    const config = await response.json().catch(() => null)
    if (config && typeof config === 'object') {
      ;(window as any).__HARMONY_RUNTIME_CONFIG__ = config
    }
  } catch (error) {
    console.warn('[uploader] runtime config not found, falling back to env', error)
  }
}

preloadRuntimeConfig().finally(() => {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)

  const authStore = useAuthStore(pinia)
  authStore.bootstrapFromStorage().finally(() => {
    app.mount('#app')
  })
})
