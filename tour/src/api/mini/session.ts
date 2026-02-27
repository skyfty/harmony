import { miniRequest } from '@harmony/utils'
import { getAccessToken, setAccessToken } from './token'

export { getAccessToken, setAccessToken }

type LoginResponse = {
  token?: string
  accessToken?: string
}

let pendingAuthPromise: Promise<string> | null = null

function getMiniAppId(): string {
  return String(import.meta.env.VITE_MINI_APP_ID ?? 'tour').trim() || 'tour'
}

function shouldUseTestLogin(): boolean {
  const raw = String(import.meta.env.VITE_MINI_USE_TEST_LOGIN ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export async function loginWithCredentials(username: string, password: string): Promise<string> {
  const data = await miniRequest<LoginResponse>('/mini-auth/login', {
    method: 'POST',
    body: { username, password },
  })

  const token = typeof data.accessToken === 'string' ? data.accessToken : typeof data.token === 'string' ? data.token : ''
  if (!token) {
    throw new Error('Login succeeded but no token returned')
  }
  setAccessToken(token)
  return token
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

export async function loginWithWechatCode(code: string): Promise<string> {
  const miniAppId = getMiniAppId()
  const data = await miniRequest<LoginResponse>('/mini-auth/wechat-login', {
    method: 'POST',
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

export async function ensureMiniAuth(): Promise<string> {
  const token = getAccessToken()
  if (token) return token

  if (!pendingAuthPromise) {
    pendingAuthPromise = (async () => {
      try {
        if (shouldUseTestLogin()) {
          const username = String(import.meta.env.VITE_MINI_TEST_USERNAME ?? 'test')
          const password = String(import.meta.env.VITE_MINI_TEST_PASSWORD ?? 'test1234')
          return await loginWithCredentials(username, password)
        }
        const code = await getWechatLoginCode()
        return await loginWithWechatCode(code)
      } catch {
        return ''
      }
    })().finally(() => {
      pendingAuthPromise = null
    })
  }

  return await pendingAuthPromise
}

export async function ensureDevLogin(): Promise<string> {
  return await ensureMiniAuth()
}
