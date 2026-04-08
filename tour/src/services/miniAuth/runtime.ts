import { setMiniAuthRecoveryHandler } from '@harmony/utils'
import { recoverMiniAuthSession } from './sessionManager'
import { miniAuthRecoveryDialogController } from './recoveryDialogController'
import { setMiniAuthRecoveryPresenter } from './recoveryPresenter'

let miniAuthRuntimeInstalled = false
const MINI_AUTH_RUNTIME_LOG_PREFIX = '[mini-auth-runtime]'

function logMiniAuthRuntime(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`${MINI_AUTH_RUNTIME_LOG_PREFIX} ${message}`)
    return
  }
  console.info(`${MINI_AUTH_RUNTIME_LOG_PREFIX} ${message}`, details)
}

export type { MiniAuthRecoveryOptions, MiniAuthRecoveryResult } from './types'

export function installMiniAuthRuntime(): void {
  if (miniAuthRuntimeInstalled) {
    logMiniAuthRuntime('install skipped, runtime already installed')
    return
  }

  miniAuthRuntimeInstalled = true
  logMiniAuthRuntime('install runtime start')
  setMiniAuthRecoveryPresenter((options) => miniAuthRecoveryDialogController.open(options))
  logMiniAuthRuntime('recovery presenter registered')
  setMiniAuthRecoveryHandler(async () => {
    logMiniAuthRuntime('mini client requested auth recovery, start silent session recovery')
    try {
      return await recoverMiniAuthSession()
    } catch (error) {
      logMiniAuthRuntime('auth recovery handler failed', error)
      console.error('Error during mini auth recovery:', error)
      return false
    }
  })
  logMiniAuthRuntime('mini client recovery handler registered')
}