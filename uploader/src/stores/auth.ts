import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { login as loginRequest, fetchProfile, logout as logoutRequest } from '@/api/modules/auth'
import { persistToken, readPersistedToken } from '@/api/http'
import type { AuthProfileResponse, LoginRequest, LoginResponse, UserSummary } from '@/types'

export const useAuthStore = defineStore('uploader-auth', () => {
  const token = ref<string | null>(null)
  const user = ref<UserSummary | null>(null)
  const loading = ref(false)

  const isAuthenticated = computed(() => Boolean(token.value && user.value))

  function setSession(payload: LoginResponse | (AuthProfileResponse & { token?: string | null })): void {
    if ('token' in payload && payload.token) {
      token.value = payload.token
      persistToken(payload.token)
    }
    user.value = payload.user
  }

  function clearSession(): void {
    token.value = null
    user.value = null
    persistToken(null)
  }

  async function bootstrapFromStorage(): Promise<void> {
    const storedToken = readPersistedToken()
    if (!storedToken) {
      clearSession()
      return
    }
    token.value = storedToken
    try {
      loading.value = true
      const profile = await fetchProfile()
      setSession({ ...profile, token: storedToken })
    } catch (error) {
      console.warn('[uploader] failed to restore session', error)
      clearSession()
    } finally {
      loading.value = false
    }
  }

  async function login(credentials: LoginRequest): Promise<void> {
    try {
      loading.value = true
      const session = await loginRequest(credentials)
      setSession(session)
    } finally {
      loading.value = false
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

  return {
    token,
    user,
    loading,
    isAuthenticated,
    bootstrapFromStorage,
    login,
    logout,
    clearSession,
    setSession,
  }
})
