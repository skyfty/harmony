import axios, { AxiosHeaders } from 'axios'
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'

const TOKEN_STORAGE_KEY = 'harmony_admin_token'

function getBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim()
  if (raw && raw.length) {
    return raw
  }
  return 'http://localhost:4000'
}

export function readPersistedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch (error) {
    console.warn('Unable to read token from storage', error)
    return null
  }
}

export function persistToken(token: string | null): void {
  try {
    if (!token) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch (error) {
    console.warn('Unable to persist token', error)
  }
}

const http = axios.create({
  baseURL: getBaseUrl(),
  withCredentials: true,
  timeout: 15000,
})

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = readPersistedToken()
  if (token) {
    const headers = config.headers instanceof AxiosHeaders ? config.headers : new AxiosHeaders(config.headers ?? {})
    headers.set('Authorization', `Bearer ${token}`)
    config.headers = headers
  }
  return config
})

http.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      persistToken(null)
    }
    return Promise.reject(error)
  },
)

export { http as apiClient, TOKEN_STORAGE_KEY }
