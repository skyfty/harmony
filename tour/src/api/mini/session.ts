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

export async function loginWithWechatCode(code: string): Promise<string> {
  const miniAppId = getMiniAppId()
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
      if (shouldUseTestLogin()) {
        const username = String(import.meta.env.VITE_MINI_TEST_USERNAME ?? 'test')
        const password = String(import.meta.env.VITE_MINI_TEST_PASSWORD ?? 'test1234')
        logMiniAuth('using test login flow', { username })
        return await loginWithCredentials(username, password)
      }

      logMiniAuth('using wechat login flow')
      const code = await getWechatLoginCode()
      return await loginWithWechatCode(code)
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