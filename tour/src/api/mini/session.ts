import { MiniApiError, miniRequest, setMiniAuthRecoveryHandler } from '@harmony/utils'
import { getAccessToken, setAccessToken } from './token'

export { getAccessToken, setAccessToken }

type LoginResponse = {
  token?: string
  accessToken?: string
}

let pendingAuthPromise: Promise<string> | null = null
let miniAuthInitialized = false

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
  return await new Promise<string>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (res) => {
        if (!res.code) {
          reject(new Error('Wechat login code not found'))
          return
        }
        resolve(res.code)
      },
      fail: () => {
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
  const data = await miniRequest<LoginResponse>('/mini-auth/wechat-login', {
    method: 'POST',
    auth: false,
    headers: miniAppId ? { 'X-Mini-App-Id': miniAppId } : undefined,
    body: {
      code,
      miniAppId: miniAppId || undefined,
    },
  })

  const token = readTokenFromResponse(data)
  if (!token) {
    throw new Error('Wechat login succeeded but no token returned')
  }

  setAccessToken(token)
  return token
}

async function performMiniAuth(force = false): Promise<string> {
  if (!force) {
    const token = getAccessToken()
    if (token) {
      return token
    }
  } else {
    setAccessToken('')
  }

  if (!pendingAuthPromise) {
    pendingAuthPromise = (async () => {
      if (shouldUseTestLogin()) {
        const username = String(import.meta.env.VITE_MINI_TEST_USERNAME ?? 'test')
        const password = String(import.meta.env.VITE_MINI_TEST_PASSWORD ?? 'test1234')
        return await loginWithCredentials(username, password)
      }

      const code = await getWechatLoginCode()
      return await loginWithWechatCode(code)
    })()
      .catch((error) => {
        setAccessToken('')
        throw error
      })
      .finally(() => {
        pendingAuthPromise = null
      })
  }

  return await pendingAuthPromise
}

export async function ensureMiniAuth(force = false): Promise<string> {
  return await performMiniAuth(force)
}

export async function recoverMiniAuthSession(): Promise<boolean> {
  try {
    const token = await performMiniAuth(true)
    return Boolean(token)
  } catch {
    setAccessToken('')
    return false
  }
}

export async function prewarmMiniAuth(): Promise<string> {
  if (!shouldAutoLogin()) {
    return ''
  }

  try {
    return await ensureMiniAuth()
  } catch {
    return ''
  }
}

export function resetMiniAuthSession(): void {
  setAccessToken('')
}

export function initializeMiniAuth(): void {
  if (miniAuthInitialized) {
    return
  }

  miniAuthInitialized = true
  setMiniAuthRecoveryHandler(async ({ path }) => {
    if (path.startsWith('/mini-auth/')) {
      resetMiniAuthSession()
      return false
    }
    return await recoverMiniAuthSession()
  })

  if (shouldAutoLogin()) {
    void prewarmMiniAuth()
  }
}

export async function ensureDevLogin(): Promise<string> {
  return await ensureMiniAuth()
}

export function isMiniAuthError(error: unknown): error is MiniApiError {
  return error instanceof MiniApiError && error.kind === 'auth'
}