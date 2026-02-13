import axios, { AxiosHeaders } from 'axios'
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'

type ApiEnvelope<T = unknown> = {
  code: number
  data: T
  message: string
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string'
}

type RuntimeConfig = {
  serverApiBaseUrl?: string
  serverApiPrefix?: string
}

const TOKEN_STORAGE_KEY = 'harmony_uploader_token'

function readRuntimeConfig(): RuntimeConfig {
  const runtime = (window as any).__HARMONY_RUNTIME_CONFIG__ as RuntimeConfig | undefined
  if (runtime && typeof runtime === 'object') {
    return runtime
  }
  return {}
}

function normalizeBaseUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  if (!trimmed.length) {
    return null
  }
  return trimmed.replace(/\/$/, '')
}

function normalizePrefix(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') {
    return ''
  }
  const trimmed = raw.trim()
  if (!trimmed.length) {
    return ''
  }
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`
  }
  return trimmed.replace(/\/$/, '')
}

function resolveBaseUrl(): string {
  const runtime = readRuntimeConfig()
  const runtimeBase = normalizeBaseUrl(runtime.serverApiBaseUrl)
  if (runtimeBase) {
    return runtimeBase
  }
  const envBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)
  if (envBase) {
    return envBase
  }
  return 'http://localhost:4000'
}

function resolvePrefix(): string {
  const runtime = readRuntimeConfig()
  const runtimePrefix = normalizePrefix(runtime.serverApiPrefix)
  if (runtimePrefix) {
    return runtimePrefix
  }
  const envPrefix = normalizePrefix(import.meta.env.VITE_API_PREFIX)
  if (envPrefix) {
    return envPrefix
  }
  return '/api'
}

const apiClient = axios.create({
  baseURL: `${resolveBaseUrl()}${resolvePrefix()}`,
  withCredentials: true,
  timeout: 20000,
})

export function readPersistedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch (error) {
    console.warn('[uploader] unable to read auth token from storage', error)
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
    console.warn('[uploader] unable to persist auth token', error)
  }
}

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
  (response: AxiosResponse) => {
    const payload = response.data
    if (!isApiEnvelope(payload)) {
      return response
    }
    if (payload.code !== 0) {
      return Promise.reject(new Error(payload.message || `请求失败(${response.status})`))
    }
    response.data = payload.data
    return response
  },
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      persistToken(null)
    }
    return Promise.reject(error)
  },
)

export { apiClient, TOKEN_STORAGE_KEY }
