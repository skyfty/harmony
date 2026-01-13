import type { InjectionKey } from 'vue'

export const PROJECT_MANAGER_OVERLAY_CLOSE_KEY: InjectionKey<() => void> = Symbol('PROJECT_MANAGER_OVERLAY_CLOSE')
