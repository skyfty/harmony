/// <reference types="vite/client" />

declare module 'vuetify/styles'

declare module 'splitpanes' {
	import type { DefineComponent } from 'vue'
	export const Splitpanes: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
	export const Pane: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
}

interface ImportMetaEnv {}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
