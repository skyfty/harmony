import { getMiniPlatformAdapter } from '@/platform/adapter'

let miniProgramUpdateRuntimeInstalled = false

export function installMiniProgramUpdateRuntime(): void {
  if (miniProgramUpdateRuntimeInstalled) {
    return
  }

  miniProgramUpdateRuntimeInstalled = true
  getMiniPlatformAdapter().installUpdateManager?.()
}
