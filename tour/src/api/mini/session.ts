import { miniRequest } from '@harmony/utils'
import { getAccessToken, setAccessToken } from './token'

export { getAccessToken, setAccessToken }

type LoginResponse = {
  token?: string
  accessToken?: string
}

let pendingAuthPromise: Promise<string> | null = null

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
  const data = await miniRequest<LoginResponse>('/mini-auth/wechat-login', {
    method: 'POST',
    body: { code },
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

  const username = String(import.meta.env.VITE_MINI_TEST_USERNAME ?? 'test')
  const password = String(import.meta.env.VITE_MINI_TEST_PASSWORD ?? 'test1234')

  try {
    return await loginWithCredentials(username, password)
  } catch {
    return ''
  }
  // if (!pendingAuthPromise) {
  //   pendingAuthPromise = (async () => {
  //     try {
  //       const code = await getWechatLoginCode()
  //       return await loginWithWechatCode(code)
  //     } catch {
  //       return ''
  //     }
  //   })().finally(() => {
  //     pendingAuthPromise = null
  //   })
  // }

  // return await pendingAuthPromise
}

export async function ensureDevLogin(): Promise<string> {
  return await ensureMiniAuth()
}
