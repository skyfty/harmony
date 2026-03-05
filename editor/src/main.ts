import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import vuetify from './utils/vuetify'
import { createPersistedStatePlugin } from './utils/piniaPersist'
import { useAuthStore } from '@/stores/authStore'
import { useConsoleStore } from '@/stores/consoleStore'
import './style.css'
import VueViewer from 'v-viewer'
import 'viewerjs/dist/viewer.css'
import { configureAssetBlobDownloader } from '@schema/assetCache'
import { createWorkerAssetBlobDownloader } from '@/utils/assetDownloadWorkerPool'

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


;(async () => {
	try {
		await preloadRuntimeConfig()
	} catch (err) {
		console.warn('[editor] runtime config preload failed', err)
	}

	configureAssetBlobDownloader(
		createWorkerAssetBlobDownloader(() => {
			if (typeof Worker === 'undefined') {
				return null
			}
			try {
				return new Worker(new URL('./workers/assetDownload.worker.ts', import.meta.url), { type: 'module' })
			} catch {
				return null
			}
		}),
	)

	const app = createApp(App)
	const pinia = createPinia()
	pinia.use(createPersistedStatePlugin({ keyPrefix: 'harmony' }))

	app.use(pinia)
	app.use(router)
	app.use(vuetify)
	app.use(VueViewer)

	const consoleStore = useConsoleStore(pinia)
	consoleStore.startCapture()

	const authStore = useAuthStore(pinia)
	await authStore.initialize()


	// Disable browser right-click context menu everywhere inside the editor
	// but allow it on inputs, textareas, selects, contenteditable, or elements
	// explicitly opt-in via `data-allow-contextmenu`.
	document.addEventListener('contextmenu', (e: Event) => {
		const ev = e as MouseEvent
		const composedPath = (ev.composedPath && ev.composedPath()) || []
		const nodes: any[] = composedPath.length ? composedPath : [ev.target]

		for (const node of nodes) {
			if (!(node instanceof Element)) continue
			if (node.matches && node.matches('input, textarea, select')) return
			const ce = node.getAttribute && node.getAttribute('contenteditable')
			if (ce === '' || ce === 'true') return
			if (node.closest && node.closest('[data-allow-contextmenu]')) return
		}

		e.preventDefault()
	})

	app.mount('#app')

})()
