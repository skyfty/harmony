import { ref } from 'vue'
import type { MiniProfileDraft } from '@/utils/miniProfile'

export type MiniAuthRecoveryResult =
  | ({ action: 'submit' } & MiniProfileDraft)
  | { action: 'skip' }

export type MiniAuthRecoveryOptions = {
  title?: string
  description?: string
  confirmText?: string
  skipText?: string
  initialDisplayName?: string
}

type RecoveryResolve = (value: MiniAuthRecoveryResult) => void

const visible = ref(false)
const options = ref<MiniAuthRecoveryOptions>({})
let resolver: RecoveryResolve | null = null

export function showRecoveryModal(nextOptions: MiniAuthRecoveryOptions = {}): Promise<MiniAuthRecoveryResult> {
  options.value = nextOptions
  visible.value = true
  return new Promise((resolve) => {
    resolver = resolve
  })
}

export function hideRecoveryModal(): void {
  visible.value = false
  options.value = {}
  resolver = null
}

export function resolveRecovery(result: MiniAuthRecoveryResult): void {
  if (resolver) {
    resolver(result)
    resolver = null
  }
  visible.value = false
  options.value = {}
}

export function isRecoveryVisible() {
  return visible
}

export function getRecoveryOptions() {
  return options
}

export default {
  showRecoveryModal,
  hideRecoveryModal,
  resolveRecovery,
  isRecoveryVisible,
  getRecoveryOptions,
}
