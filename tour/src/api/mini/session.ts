import * as harmonyUtils from '@harmony/utils'
import { getAccessToken, setAccessToken } from './token'

const { MiniApiError, miniRequest } = harmonyUtils

export { getAccessToken, setAccessToken }

type LoginResponse = {
  token?: string
  accessToken?: string
}

let pendingAuthPromise: Promise<string> | null = null
let miniAuthInitialized = false
// Temporary profile provided by a user-gesture recovery flow. When set,
// `performMiniAuth` will include these fields in the next login attempt.
let pendingRecoveryProfile: { displayName?: string; avatarUrl?: string } | null = null
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

function readTokenFromResponse(data: LoginResponse): string {
  return typeof data.accessToken === 'string' ? data.accessToken : typeof data.token === 'string' ? data.token : ''
}

async function getWechatLoginCode(): Promise<string> {
  logMiniAuth('starting wx.login')
  return await new Promise<string>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (res) => {
        if (!res.code) {
          errorMiniAuth('wx.login success callback without code')
          reject(new Error('Wechat login code not found'))
          return
        }
        logMiniAuth('wx.login success, got code')
        resolve(res.code)
      },
      fail: (error) => {
        errorMiniAuth('wx.login failed', error)
        reject(new Error('Wechat login failed'))
      },
    })
  })
}

export async function loginWithCredentials(username: string, password: string): Promise<string> {
  const data = await miniRequest<LoginResponse>('/mini-auth/login', {
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

export async function loginWithWechatCode(code: string, displayName?: string, avatarUrl?: string): Promise<string> {
  const miniAppId = getMiniAppId()
  console.log(`${MINI_AUTH_LOG_PREFIX} 
    
    
    `, { code, miniAppId: miniAppId || '(empty)' })
  logMiniAuth('requesting /mini-auth/wechat-login', {
    miniAppId: miniAppId || '(empty)',
  })
  const data = await miniRequest<LoginResponse>('/mini-auth/wechat-login', {
    method: 'POST',
    auth: false,
    headers: miniAppId ? { 'X-Mini-App-Id': miniAppId } : undefined,
    body: {
      code,
      miniAppId: miniAppId || undefined,
      // optionally include profile fields when available so server can auto-register
      ...(typeof displayName === 'string' && displayName ? { displayName } : {}),
      ...(typeof avatarUrl === 'string' && avatarUrl ? { avatarUrl } : {}),
    },
  })

  logMiniAuth('/mini-auth/wechat-login response received', { hasToken: typeof data.accessToken === 'string' || typeof data.token === 'string' })

  const token = readTokenFromResponse(data)
  if (!token) {
    errorMiniAuth('wechat-login succeeded but token missing')
    throw new Error('Wechat login succeeded but no token returned')
  }

  setAccessToken(token)
  logMiniAuth('wechat-login success, token stored', { tokenLength: token.length })
  return token
}

async function performMiniAuth(force = false): Promise<string> {
  logMiniAuth('performMiniAuth invoked', { force })
  if (!force) {
    const token = getAccessToken()
    if (token) {
      logMiniAuth('existing token found, skip auto login request')
      return token
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
      // If a recovery profile was provided by a user-gesture flow, include it
      // in the login request so the server can auto-register/sync the profile.
      const profile = pendingRecoveryProfile
      pendingRecoveryProfile = null
      const token = await loginWithWechatCode(code, profile?.displayName, profile?.avatarUrl)

      // After successful login, check whether the server-side profile has displayName/avatarUrl.
      // If missing, prompt the user (user TAP gesture) to authorize profile access and PATCH the profile.
      try {
        const resp = await miniRequest<{ user: { displayName?: string; avatarUrl?: string } }>('/mini-auth/profile', {
          method: 'GET',
        })
        const user = resp.user || {}
        const needsDisplay = !user.displayName || !user.displayName.trim()
        const needsAvatar = !user.avatarUrl || !user.avatarUrl.trim()
        if (needsDisplay || needsAvatar) {
          try {
            const { showRecoveryModal } = await import('@/stores/miniAuthRecovery')
            const result = await showRecoveryModal()
            if (result && result.success) {
              const payload: Record<string, unknown> = {}
              if (result.displayName && result.displayName.trim()) payload.displayName = result.displayName.trim()
              if (result.avatarUrl && result.avatarUrl.trim()) payload.avatarUrl = result.avatarUrl.trim()
              if (Object.keys(payload).length) {
                await miniRequest('/mini-auth/profile', { method: 'PATCH', body: payload })
              }
            }
          } catch (err) {
            warnMiniAuth('profile recovery failed or cancelled', err)
          }
        }
      } catch (err) {
        // ignore profile fetch errors
        warnMiniAuth('failed to fetch profile after login', err)
      }

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

// Called by recovery handler to provide a profile obtained via user gesture.
export function setPendingRecoveryProfile(profile: { displayName?: string; avatarUrl?: string } | null): void {
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

  if (shouldAutoLogin()) {
    logMiniAuth('auto login enabled, trigger prewarmMiniAuth from initialize')
    void prewarmMiniAuth()
  } else {
    warnMiniAuth('auto login disabled, initialize will not prewarm')
  }
}

export async function ensureDevLogin(): Promise<string> {
  return await ensureMiniAuth()
}

export function isMiniAuthError(error: unknown): error is MiniApiError {
  return error instanceof MiniApiError && error.kind === 'auth'
}