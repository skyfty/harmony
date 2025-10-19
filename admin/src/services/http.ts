import axios from 'axios'
import type { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'

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

http.interceptors.request.use((config: AxiosRequestConfig) => {
  const token = readPersistedToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
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
