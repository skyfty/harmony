import { defineConfig } from 'electron-vite'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const resolveFromRoot = (...segments) => resolve(rootDir, ...segments)

export default defineConfig({
	main: {
		build: {
			outDir: 'dist-electron/main',
			sourcemap: true,
			target: 'node20',
			emptyOutDir: true,
			lib: {
				entry: resolveFromRoot('electron/main.ts'),
				formats: ['cjs'],
				fileName: () => 'main',
			},
		},
		resolve: {
			alias: {
				'@electron-main': resolveFromRoot('electron'),
			},
		},
	},
	preload: {
		build: {
			outDir: 'dist-electron/preload',
			sourcemap: true,
			target: 'node20',
			emptyOutDir: true,
			lib: {
				entry: resolveFromRoot('electron/preload.ts'),
				formats: ['cjs'],
				fileName: () => 'preload',
			},
		},
	},
	renderer: {
		root: resolveFromRoot('.'),
		publicDir: resolveFromRoot('public'),
		resolve: {
			alias: {
				'@': resolveFromRoot('src'),
			},
		},
		plugins: [vue(), vuetify({ autoImport: true })],
		build: {
			outDir: 'dist-electron/renderer',
			rollupOptions: {
				input: resolveFromRoot('index.html'),
			},
		},
	},
})
