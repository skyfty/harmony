import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchProfile, login as loginRequest, logout as logoutRequest } from '@/api/modules/auth'
import { persistToken, readPersistedToken } from '@/api/http'
import type { AuthProfileResponse, LoginRequest, LoginResponse, UserSummary } from '@/types'

const REMEMBER_STORAGE_KEY = (import.meta.env.VITE_REMEMBER_CREDENTIALS_KEY as string | undefined)?.trim() ||
  'harmony_uploader_credentials'

type RememberedCredentials = {
  username: string
  password: string
}

function readRememberedCredentials(): RememberedCredentials | null {
  try {
    const raw = window.localStorage.getItem(REMEMBER_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const decoded = atob(raw)
    const parsed = JSON.parse(decoded) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const username = typeof record.username === 'string' ? record.username : null
      const password = typeof record.password === 'string' ? record.password : null
      if (username && password) {
        return { username, password }
      }
    }
  } catch (error) {
    console.warn('[uploader] failed to parse remembered credentials', error)
  }
  return null
}

function persistRememberedCredentials(payload: RememberedCredentials | null): void {
  try {
    if (!payload) {
      window.localStorage.removeItem(REMEMBER_STORAGE_KEY)
      return
    }
    const encoded = btoa(JSON.stringify(payload))
    window.localStorage.setItem(REMEMBER_STORAGE_KEY, encoded)
  } catch (error) {
    console.warn('[uploader] failed to persist credentials', error)
  }
}

export const useAuthStore = defineStore('uploader-auth', () => {
  const token = ref<string | null>(null)
  const user = ref<UserSummary | null>(null)
  const permissions = ref<string[]>([])
  const initializing = ref<boolean>(false)
  const rememberCache = ref<RememberedCredentials | null>(readRememberedCredentials())

  const isAuthenticated = computed(() => Boolean(token.value && user.value))

  function setSession(payload: LoginResponse | (AuthProfileResponse & { token?: string | null })): void {
    if ('token' in payload && payload.token) {
      token.value = payload.token
      persistToken(payload.token)
    }
    user.value = payload.user
    permissions.value = payload.permissions ?? []
  }

  function clearSession(): void {
    token.value = null
    user.value = null
    permissions.value = []
    persistToken(null)
  }

  async function bootstrapFromStorage(): Promise<void> {
    if (initializing.value) {
      return
    }
    const storedToken = readPersistedToken()
    if (!storedToken) {
      clearSession()
      return
    }
    initializing.value = true
    token.value = storedToken
    try {
      const profile = await fetchProfile()
      setSession({ ...profile, token: storedToken })
    } catch (error) {
      console.warn('[uploader] unable to restore session', error)
      clearSession()
    } finally {
      initializing.value = false
    }
  }

  async function login(credentials: LoginRequest & { remember?: boolean }): Promise<void> {
    const session = await loginRequest(credentials)
    setSession(session)
    if (credentials.remember) {
      rememberCache.value = { username: credentials.username, password: credentials.password }
      persistRememberedCredentials(rememberCache.value)
    } else {
      rememberCache.value = null
      persistRememberedCredentials(null)
    }
  }

  async function logout(): Promise<void> {
    try {
      await logoutRequest()
    } catch (error) {
      console.warn('[uploader] logout request failed', error)
    } finally {
      clearSession()
    }
  }

  function restoreRemembered(): RememberedCredentials | null {
    rememberCache.value = readRememberedCredentials()
    return rememberCache.value
  }

  return {
    token,
    user,
    permissions,
    initializing,
    isAuthenticated,
    login,
    logout,
    bootstrapFromStorage,
    clearSession,
    restoreRemembered,
    rememberCache,
  }
})
