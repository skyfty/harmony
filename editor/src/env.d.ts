/// <reference types="vite/client" />

declare module 'vuetify/styles'

declare module 'splitpanes' {
	import type { DefineComponent } from 'vue'
	export const Splitpanes: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
	export const Pane: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
}

declare module '*.vue' {
	import type { DefineComponent } from 'vue'
	const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
	export default component
}

declare module 'viewerjs' {
	export interface ViewerOptions {
		inline?: boolean
		button?: boolean
		navbar?: boolean
		title?: boolean
		toolbar?: boolean
		tooltip?: boolean
		movable?: boolean
		zoomable?: boolean
		rotatable?: boolean
		scalable?: boolean
		transition?: boolean
		fullscreen?: boolean
		zIndex?: number
		[key: string]: unknown
	}

	export default class Viewer {
		constructor(element: Element, options?: ViewerOptions)
		view(index?: number): void
		update(): void
		hide(): void
		show(): void
		destroy(): void
	}
}

declare module 'v-viewer' {
	import type { Plugin } from 'vue'
	const plugin: Plugin
	export default plugin
}

interface ImportMetaEnv {}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
