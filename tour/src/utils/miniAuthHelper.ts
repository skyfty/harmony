import { getAccessToken } from '@/api/mini/token'
import { ensureMiniAuth } from '@/api/mini/session'
import { redirectToNav } from '@/utils/navKey'
import {
  normalizeMiniProfileText,
} from '@/utils/miniProfile'
import {
  type MiniAuthRecoveryOptions,
} from '@/services/miniAuth/types'
import { requestMiniAuthRecovery } from '@/services/miniAuth/recoveryPresenter'
import { syncMiniProfileDraft } from '@/services/miniAuth/profileSync'

const MINI_AUTH_HELPER_LOG_PREFIX = '[mini-auth-helper]'

function logMiniAuthHelper(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`${MINI_AUTH_HELPER_LOG_PREFIX} ${message}`)
    return
  }
  console.info(`${MINI_AUTH_HELPER_LOG_PREFIX} ${message}`, details)
}

const DEFAULT_MANUAL_RECOVERY_OPTIONS: MiniAuthRecoveryOptions = {
  title: '获取微信头像昵称',
  description: '补充微信头像和昵称后，会自动更新到当前账号。',
  confirmText: '同步到账号',
  skipText: '暂不处理',
}

async function promptMiniProfileRecovery(options?: MiniAuthRecoveryOptions) {
  logMiniAuthHelper('promptMiniProfileRecovery invoked', {
    title: options?.title || '(empty)',
  })
  return await requestMiniAuthRecovery(options ?? DEFAULT_MANUAL_RECOVERY_OPTIONS)
}

export async function ensureAuthThenNavigate(key: string): Promise<boolean> {
  try {
    logMiniAuthHelper('ensureAuthThenNavigate invoked', {
      key,
      hasToken: Boolean(getAccessToken()),
    })
    if (getAccessToken()) {
      // already logged in
      logMiniAuthHelper('token already exists, navigate directly', { key })
      redirectToNav(key as any)
      return true
    }

    await ensureMiniAuth()
    logMiniAuthHelper('ensureMiniAuth resolved for navigation', { key })
    redirectToNav(key as any)
    return true
  } catch {
    logMiniAuthHelper('ensureAuthThenNavigate failed, fallback navigation attempt', { key })
    try {
      redirectToNav(key as any)
    } catch {}
    return false
  }
}

export async function requestProfileAndSync(options: MiniAuthRecoveryOptions = DEFAULT_MANUAL_RECOVERY_OPTIONS): Promise<boolean> {
  try {
    logMiniAuthHelper('requestProfileAndSync invoked', {
      title: options.title || '(empty)',
      hasToken: Boolean(getAccessToken()),
    })
    const result = await promptMiniProfileRecovery(options)
    logMiniAuthHelper('promptMiniProfileRecovery resolved for profile sync', {
      action: result.action,
    })
    if (result.action !== 'submit') {
      return false
    }

    await ensureMiniAuth(false, { allowProfilePrompt: false })
    logMiniAuthHelper('ensureMiniAuth resolved for profile sync')

    return await syncMiniProfileDraft({
      displayName: normalizeMiniProfileText(result.displayName),
      avatarFilePath: result.avatarFilePath,
    })
  } catch {
    logMiniAuthHelper('requestProfileAndSync failed')
    return false
  }
}
