import axios, { AxiosHeaders } from 'axios'
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'

interface RuntimeConfig {
  serverApiBaseUrl?: string
  serverApiPrefix?: string
}

function readRuntimeConfig(): RuntimeConfig {
  const payload = (window as any).__HARMONY_RUNTIME_CONFIG__ as RuntimeConfig | undefined
  if (payload && typeof payload === 'object') {
    return payload
  }
  return {}
}

const TOKEN_STORAGE_KEY = 'harmony_uploader_token'

function resolveBaseUrl(): string {
  const runtime = readRuntimeConfig()
  const rawBase = runtime.serverApiBaseUrl?.trim() || import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:4000'
  const runtimePrefix = runtime.serverApiPrefix?.trim()
  const envPrefix = import.meta.env.VITE_API_PREFIX?.trim()
  const prefix = runtimePrefix ?? envPrefix ?? '/api'
  const normalizedBase = rawBase.replace(/\/$/, '')
  if (!prefix) {
    return normalizedBase
  }
  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
  return `${normalizedBase}${normalizedPrefix}`
}

export function readPersistedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch (error) {
    console.warn('[uploader] unable to read token', error)
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
    console.warn('[uploader] unable to persist token', error)
  }
}

const apiClient = axios.create({
  baseURL: resolveBaseUrl(),
  withCredentials: true,
  timeout: 30000,
})

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = readPersistedToken()
  if (token) {
    const headers = config.headers instanceof AxiosHeaders ? config.headers : new AxiosHeaders(config.headers ?? {})
    headers.set('Authorization', `Bearer ${token}`)
    config.headers = headers
  }
  return config
})

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      persistToken(null)
    }
    return Promise.reject(error)
  },
)

export { apiClient, TOKEN_STORAGE_KEY }
