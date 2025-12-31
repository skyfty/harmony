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
import { initWasm } from './wasm_loader'

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

	// Initialize WebAssembly module (Rust -> wasm-bindgen)
	try {
		const wasmPkg = await initWasm()
		if (wasmPkg && typeof wasmPkg.add === 'function') {
			console.info('[wasm] add(1,2)=', wasmPkg.add(1, 2))
		}
	} catch (err) {
		console.warn('[wasm] initialization failed', err)
	}

	app.mount('#app')

})()
