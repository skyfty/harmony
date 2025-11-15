import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import vuetify from './utils/vuetify'
import { createPersistedStatePlugin } from './utils/piniaPersist'
import { useAuthStore } from '@/stores/authStore'
import { useConsoleStore } from '@/stores/consoleStore'
import './style.css'

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
		console.warn('[editor] runtime config not found, fallback to env', err)
	}
}

preloadRuntimeConfig().finally(async () => {
	const app = createApp(App)
	const pinia = createPinia()
	pinia.use(createPersistedStatePlugin({ keyPrefix: 'harmony' }))

	app.use(pinia)
	app.use(router)
	app.use(vuetify)

	const consoleStore = useConsoleStore(pinia)
	consoleStore.startCapture()

	const authStore = useAuthStore(pinia)
	await authStore.initialize()

	app.mount('#app')
})
