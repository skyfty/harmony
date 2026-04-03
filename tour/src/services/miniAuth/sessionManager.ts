import * as harmonyUtils from '@harmony/utils'
import { getAccessToken, setAccessToken } from '@/api/mini/token'
import {
  isMiniProfileIncomplete,
  normalizeMiniProfileText,
  setAnonymousDisplayEnabled,
  type MiniProfileDraft,
} from '@/utils/miniProfile'
import { syncMiniProfileDraft } from './profileSync'
import { requestMiniAuthRecovery } from './recoveryPresenter'
import type { MiniAuthLoginResponse, MiniAuthUser } from './types'

const { MiniApiError, miniRequest } = harmonyUtils

export { getAccessToken, setAccessToken }

let pendingAuthPromise: Promise<string> | null = null
let miniAuthInitialized = false
let pendingRecoveryProfile: MiniProfileDraft | null = null

const MINI_AUTH_LOG_PREFIX = '[mini-auth]'
const MINI_AUTH_SESSION_STORAGE_KEYS = [
  'tour:selectedVehicleId',
  'tour:selectedVehicle',
]

function logMiniAuth(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`${MINI_AUTH_LOG_PREFIX} ${message}`)
    return
  }
  console.info(`${MINI_AUTH_LOG_PREFIX} ${message}`, details)
}

function warnMiniAuth(message: string, details?: unknown): void {
  if (details === undefined) {
    console.warn(`${MINI_AUTH_LOG_PREFIX} ${message}`)
    return
  }
  console.warn(`${MINI_AUTH_LOG_PREFIX} ${message}`, details)
}

function errorMiniAuth(message: string, details?: unknown): void {
  if (details === undefined) {
    console.error(`${MINI_AUTH_LOG_PREFIX} ${message}`)
    return
  }
  console.error(`${MINI_AUTH_LOG_PREFIX} ${message}`, details)
}

function clearMiniAuthSessionStorage(): void {
  if (typeof uni === 'undefined' || typeof uni.removeStorageSync !== 'function') {
    return
  }

  MINI_AUTH_SESSION_STORAGE_KEYS.forEach((key) => {
    try {
      uni.removeStorageSync(key)
    } catch {
      // ignore storage cleanup errors
    }
  })
}

function clearMiniAuthLocalState(reason: string): void {
  setAccessToken('')
  clearMiniAuthSessionStorage()
  pendingRecoveryProfile = null
  if (reason === 'manual-reset' || reason === 'perform-auth-failed') {
    setAnonymousDisplayEnabled(false)
  }
  logMiniAuth('mini auth local state cleared', { reason })
}

function getMiniAppId(): string {
  return String(import.meta.env.VITE_MINI_APP_ID ?? '').trim()
}

function shouldUseTestLogin(): boolean {
  const raw = String(import.meta.env.VITE_MINI_USE_TEST_LOGIN ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function shouldAutoLogin(): boolean {
  const raw = String(import.meta.env.VITE_MINI_AUTO_LOGIN ?? '').trim().toLowerCase()
  if (!raw) {
    return true
  }
  return !(raw === '0' || raw === 'false' || raw === 'no')
}

function readTokenFromResponse(data: MiniAuthLoginResponse): string {
  return typeof data.accessToken === 'string' ? data.accessToken : typeof data.token === 'string' ? data.token : ''
}

async function fetchMiniAuthProfile(): Promise<MiniAuthUser> {
  const response = await miniRequest<{ user?: MiniAuthUser }>('/mini-auth/profile', {
    method: 'GET',
  })
  return response.user || {}
}

async function getWechatLoginCode(): Promise<string> {
  logMiniAuth('starting wx.login')
  return await new Promise<string>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (res: { code?: string }) => {
        if (!res.code) {
          errorMiniAuth('wx.login success callback without code')
          reject(new Error('Wechat login code not found'))
          return
        }
        logMiniAuth('wx.login success, got code')
        resolve(res.code)
      },
      fail: (error: unknown) => {
        errorMiniAuth('wx.login failed', error)
        reject(new Error('Wechat login failed'))
      },
    })
  })
}

async function promptForIncompleteProfile(currentUsername?: string): Promise<void> {
  try {
    logMiniAuth('profile incomplete, requesting recovery dialog', {
      currentUsername: currentUsername || '(empty)',
    })
    const result = await requestMiniAuthRecovery({
      title: '完善微信资料',
      description: '检测到当前账号缺少微信头像或昵称。你可以现在同步，也可以先匿名使用。',
      confirmText: '同步资料',
      skipText: '暂时匿名使用',
      initialDisplayName: currentUsername,
    })

    if (result.action === 'submit') {
      await syncMiniProfileDraft({
        displayName: normalizeMiniProfileText(result.displayName),
        avatarFilePath: result.avatarFilePath,
      })
      return
    }

    setAnonymousDisplayEnabled(true)
  } catch (error) {
    warnMiniAuth('profile recovery prompt unavailable, fallback to anonymous mode', error)
    setAnonymousDisplayEnabled(true)
  }
}

async function ensureProfileCompleteness(profile: MiniAuthUser | null | undefined): Promise<void> {
  if (pendingRecoveryProfile) {
    return
  }

  if (isMiniProfileIncomplete(profile)) {
    await promptForIncompleteProfile(profile?.username)
    return
  }

  logMiniAuth('profile already complete, skip recovery dialog')
  setAnonymousDisplayEnabled(false)
}

async function performMiniAuth(force = false): Promise<string> {
  logMiniAuth('performMiniAuth invoked', { force })
  if (!force) {
    const token = getAccessToken()
    if (token) {
      logMiniAuth('existing token found, skip auto login request')
      try {
        const currentProfile = await fetchMiniAuthProfile()
        await ensureProfileCompleteness(currentProfile)
        return token
      } catch (err: any) {
        const msg = err && err.message ? String(err.message) : ''
        if (
          msg.includes('User not found') ||
          msg.includes('401') ||
          msg.includes('token') ||
          msg.includes('未登录')
        ) {
          warnMiniAuth('token invalid, clear and re-auth', msg)
          clearMiniAuthLocalState('token-invalid')
          return await performMiniAuth(true)
        }
        throw err
      }
    }
  } else {
    logMiniAuth('force=true, clear token before re-auth')
    clearMiniAuthLocalState('force-re-auth')
  }

  if (!pendingAuthPromise) {
    logMiniAuth('creating new pending auth promise')
    pendingAuthPromise = (async () => {
      logMiniAuth('using wechat login flow')
      const code = await getWechatLoginCode()
      const profile = pendingRecoveryProfile
      pendingRecoveryProfile = null
      const response = await loginWithWechatCode(code, normalizeMiniProfileText(profile?.displayName))
      const token = readTokenFromResponse(response)
      if (!token) {
        throw new Error('Wechat login succeeded but no token returned')
      }

      if (profile) {
        try {
          await syncMiniProfileDraft(profile)
        } catch (error) {
          warnMiniAuth('failed to sync submitted recovery profile after login', error)
        }
      }

      const currentUser = await fetchMiniAuthProfile().catch((error) => {
        warnMiniAuth('failed to fetch canonical profile after login, fallback to login response user', error)
        return response.user || {}
      })
      await ensureProfileCompleteness(currentUser)

      return token
    })()
      .catch((error) => {
        errorMiniAuth('performMiniAuth failed, token cleared', error)
        clearMiniAuthLocalState('perform-auth-failed')
        throw error
      })
      .finally(() => {
        logMiniAuth('pending auth promise settled, reset pending state')
        pendingAuthPromise = null
      })
  } else {
    logMiniAuth('reuse existing pending auth promise')
  }

  return await pendingAuthPromise
}

export async function loginWithCredentials(username: string, password: string): Promise<string> {
  const data = await miniRequest<MiniAuthLoginResponse>('/mini-auth/login', {
    method: 'POST',
    body: { username, password },
    auth: false,
  })

  const token = readTokenFromResponse(data)
  if (!token) {
    throw new Error('Login succeeded but no token returned')
  }

  setAccessToken(token)
  return token
}

export async function loginWithWechatCode(code: string, displayName?: string): Promise<MiniAuthLoginResponse> {
  const miniAppId = getMiniAppId()
  logMiniAuth('requesting /mini-auth/wechat-login', {
    miniAppId: miniAppId || '(empty)',
  })
  const data = await miniRequest<MiniAuthLoginResponse>('/mini-auth/wechat-login', {
    method: 'POST',
    auth: false,
    headers: miniAppId ? { 'X-Mini-App-Id': miniAppId } : undefined,
    body: {
      code,
      miniAppId: miniAppId || undefined,
      ...(typeof displayName === 'string' && displayName ? { displayName } : {}),
    },
  })

  logMiniAuth('/mini-auth/wechat-login response received', {
    hasToken: typeof data.accessToken === 'string' || typeof data.token === 'string',
  })

  const token = readTokenFromResponse(data)
  if (!token) {
    errorMiniAuth('wechat-login succeeded but token missing')
    throw new Error('Wechat login succeeded but no token returned')
  }

  setAccessToken(token)
  logMiniAuth('wechat-login success, token stored', { tokenLength: token.length })
  return data
}

export function setPendingRecoveryProfile(profile: MiniProfileDraft | null): void {
  pendingRecoveryProfile = profile
}

export async function ensureMiniAuth(force = false): Promise<string> {
  return await performMiniAuth(force)
}

export async function recoverMiniAuthSession(): Promise<boolean> {
  logMiniAuth('recoverMiniAuthSession invoked')
  try {
    const token = await performMiniAuth(true)
    logMiniAuth('recoverMiniAuthSession success', { hasToken: Boolean(token) })
    return Boolean(token)
  } catch (error) {
    errorMiniAuth('recoverMiniAuthSession failed', error)
    clearMiniAuthLocalState('recover-failed')
    return false
  }
}

export async function prewarmMiniAuth(): Promise<string> {
  const autoLoginEnabled = shouldAutoLogin()
  logMiniAuth('prewarmMiniAuth invoked', {
    autoLoginEnabled,
    useTestLogin: shouldUseTestLogin(),
    miniAppId: getMiniAppId() || '(empty)',
    hasExistingToken: Boolean(getAccessToken()),
  })
  if (!autoLoginEnabled) {
    warnMiniAuth('auto login disabled by VITE_MINI_AUTO_LOGIN')
    return ''
  }

  try {
    const token = await ensureMiniAuth()
    logMiniAuth('prewarmMiniAuth success', { hasToken: Boolean(token) })
    return token
  } catch (error) {
    errorMiniAuth('prewarmMiniAuth failed', error)
    return ''
  }
}

export function resetMiniAuthSession(): void {
  clearMiniAuthLocalState('manual-reset')
}

export function initializeMiniAuth(): void {
  logMiniAuth('initializeMiniAuth invoked')
  if (miniAuthInitialized) {
    logMiniAuth('initializeMiniAuth skipped, already initialized')
    return
  }

  miniAuthInitialized = true
  logMiniAuth('mini auth initialized')

  if (!shouldAutoLogin()) {
    warnMiniAuth('auto login disabled, initialize will not prewarm')
    return
  }

  if (!getAccessToken()) {
    logMiniAuth('skip cold-start auth without token; wait for user gesture to begin login')
    return
  }

  logMiniAuth('existing token detected, trigger prewarmMiniAuth from initialize')
  void prewarmMiniAuth()
}

export async function ensureDevLogin(): Promise<string> {
  return await ensureMiniAuth()
}

export function isMiniAuthError(error: unknown): boolean {
  const candidate = error as { kind?: unknown }
  return error instanceof MiniApiError && candidate.kind === 'auth'
}