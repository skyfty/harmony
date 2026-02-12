import { httpRequest } from '@/api/http'
import { getMiniApiBaseUrl } from './config'

const TOKEN_KEY = 'tour:mini:accessToken'

export function getAccessToken(): string {
  const raw: unknown = uni.getStorageSync(TOKEN_KEY)
  return typeof raw === 'string' ? raw : ''
}

export function setAccessToken(token: string): void {
  if (token) {
    uni.setStorageSync(TOKEN_KEY, token)
  } else {
    uni.removeStorageSync(TOKEN_KEY)
  }
}

type LoginResponse = {
  token?: string
  accessToken?: string
}

export async function loginWithCredentials(username: string, password: string): Promise<string> {
  const base = getMiniApiBaseUrl()
  const data = await httpRequest<LoginResponse>(`${base}/users/login`, {
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

export async function ensureDevLogin(): Promise<string> {
  const token = getAccessToken()
  if (token) return token

  const isDev = import.meta.env.DEV
  const autoLogin = String(import.meta.env.VITE_MINI_AUTO_LOGIN ?? '') === '1'
  if (!isDev || !autoLogin) {
    return ''
  }

  const username = String(import.meta.env.VITE_MINI_TEST_USERNAME ?? 'test')
  const password = String(import.meta.env.VITE_MINI_TEST_PASSWORD ?? 'test1234')

  try {
    return await loginWithCredentials(username, password)
  } catch {
    return ''
  }
}
