import { ref } from 'vue'

type RecoveryResolve = (value: { success: boolean; displayName?: string; avatarUrl?: string }) => void

const visible = ref(false)
let resolver: RecoveryResolve | null = null

export function showRecoveryModal(): Promise<{ success: boolean; displayName?: string; avatarUrl?: string }> {
  visible.value = true
  return new Promise((resolve) => {
    resolver = resolve
  })
}

export function hideRecoveryModal(): void {
  visible.value = false
  resolver = null
}

export function resolveRecovery(result: { success: boolean; displayName?: string; avatarUrl?: string }): void {
  if (resolver) {
    resolver(result)
    resolver = null
  }
  visible.value = false
}

export function isRecoveryVisible() {
  return visible
}

export default {
  showRecoveryModal,
  hideRecoveryModal,
  resolveRecovery,
  isRecoveryVisible,
}
