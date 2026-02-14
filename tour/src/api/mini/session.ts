import { miniRequest } from './client'
import { getAccessToken, setAccessToken } from './token'

export { getAccessToken, setAccessToken }

type LoginResponse = {
  token?: string
  accessToken?: string
}

export async function loginWithCredentials(username: string, password: string): Promise<string> {
  const data = await miniRequest<LoginResponse>('/users/login', {
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
