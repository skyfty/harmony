import { httpRequest, type HttpRequestOptions } from '@/api/http'
import { getMiniApiBaseUrl } from './config'
import { getAccessToken } from './session'

export async function miniRequest<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
  const base = getMiniApiBaseUrl()
  const token = getAccessToken()

  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return httpRequest<T>(`${base}${path}`, {
    ...options,
    headers,
  })
}
