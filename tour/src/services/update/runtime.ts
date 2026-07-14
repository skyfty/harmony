import { getMiniPlatformAdapter } from '@/platform/adapter'
import { hasMiniCapability } from '@/platform/runtime'

let miniProgramUpdateRuntimeInstalled = false

export function installMiniProgramUpdateRuntime(): void {
  if (miniProgramUpdateRuntimeInstalled) {
    return
  }

  if (!hasMiniCapability('update')) {
    return
  }

  miniProgramUpdateRuntimeInstalled = true
  getMiniPlatformAdapter().installUpdateManager?.()
}
