import { setMiniAuthRecoveryHandler } from '@harmony/utils'
import { setPendingRecoveryProfile, recoverMiniAuthSession } from './sessionManager'
import { miniAuthRecoveryDialogController } from './recoveryDialogController'
import { requestMiniAuthRecovery, setMiniAuthRecoveryPresenter } from './recoveryPresenter'
import type { MiniAuthRecoveryResult } from './types'
import { normalizeMiniProfileText, setAnonymousDisplayEnabled } from '@/utils/miniProfile'

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

export function applyRecoveryResultForNextLogin(result: MiniAuthRecoveryResult): void {
  logMiniAuthRuntime('applyRecoveryResultForNextLogin invoked', { action: result.action })
  if (result.action === 'submit') {
    setAnonymousDisplayEnabled(false)
    setPendingRecoveryProfile({
      displayName: normalizeMiniProfileText(result.displayName),
      avatarFilePath: result.avatarFilePath,
    })
    return
  }

  setPendingRecoveryProfile(null)
  setAnonymousDisplayEnabled(true)
}

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
    logMiniAuthRuntime('mini client requested auth recovery')
    try {
      const result = await requestMiniAuthRecovery({
        title: '登录已失效',
        description: '请补充微信头像和昵称后重新完成登录；如果暂时不想授权，也可以先匿名使用。',
        confirmText: '继续登录',
        skipText: '匿名继续',
      })
      logMiniAuthRuntime('auth recovery presenter resolved', { action: result.action })
      applyRecoveryResultForNextLogin(result)
      return await recoverMiniAuthSession()
    } catch (error) {
      logMiniAuthRuntime('auth recovery handler failed', error)
      console.error('Error during mini auth recovery:', error)
      return false
    }
  })
  logMiniAuthRuntime('mini client recovery handler registered')
}