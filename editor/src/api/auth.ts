import { buildServerApiUrl } from '@/api/serverApiConfig'
import type { AuthSessionResponse } from '@/types/auth'

export interface LoginRequestPayload {
  username: string
  password: string
}

function parseJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>
  }
  return response.text().then((text) => {
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new Error(text || '服务器返回的响应无法解析')
    }
  })
}

function buildError(message: string, response: Response): Error {
  return new Error(`${message}（${response.status}）`)
}

export async function loginWithPassword(payload: LoginRequestPayload): Promise<AuthSessionResponse> {
  const url = buildServerApiUrl('/auth/login')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof body === 'string' ? body : body?.message
    throw new Error(message || '登录失败')
  }

  const session = await parseJsonResponse<AuthSessionResponse>(response)
  if (!session || !session.user) {
    throw new Error('服务器返回的会话信息无效')
  }
  return session
}

export async function fetchProfile(token: string): Promise<AuthSessionResponse> {
  const url = buildServerApiUrl('/auth/profile')
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 401) {
    throw new Error('认证已过期，请重新登录')
  }

  if (!response.ok) {
    throw buildError('获取用户信息失败', response)
  }

  const session = await parseJsonResponse<AuthSessionResponse>(response)
  if (!session || !session.user) {
    throw new Error('服务器返回的用户信息无效')
  }
  return session
}

export async function logoutSession(token: string): Promise<void> {
  const url = buildServerApiUrl('/auth/logout')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok && response.status !== 401) {
    const body = await response.text().catch(() => '')
    throw new Error(body || '退出登录失败')
  }
}
