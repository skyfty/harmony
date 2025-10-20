import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchProfile, login as loginRequest, logout as logoutRequest } from '@/api/modules/auth'
import { persistToken, readPersistedToken } from '@/api/http'
import type { AuthProfileResponse, LoginRequest, LoginResponse, UserSummary } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<UserSummary | null>(null)
  const permissions = ref<string[]>([])
  const loading = ref(false)

  const derivedPermissions = computed(() => {
    const allPermissions = new Set<string>(permissions.value)
    return Array.from(allPermissions)
  })

  const isAuthenticated = computed(() => Boolean(token.value && user.value))

  function setSession(payload: LoginResponse | AuthProfileResponse & { token?: string | null }): void {
    if ('token' in payload && payload.token) {
      token.value = payload.token
      persistToken(payload.token)
    }
    user.value = payload.user
    permissions.value = payload.permissions
  }

  function clearSession(): void {
    token.value = null
    user.value = null
    permissions.value = []
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
      console.warn('Failed to restore session', error)
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
      console.warn('Failed to invoke logout endpoint', error)
    } finally {
      clearSession()
    }
  }

  function hasPermission(code?: string | null): boolean {
    if (!code) {
      return true
    }
    if (!isAuthenticated.value) {
      return false
    }
    const permissionSet = new Set(derivedPermissions.value)
    if (permissionSet.has('admin:super')) {
      return true
    }
    return permissionSet.has(code)
  }

  function canAccessRoute(name: string): boolean {
    if (!name) {
      return false
    }
    if (!isAuthenticated.value) {
      return false
    }
    if (hasPermission(`route:${name}`)) {
      return true
    }
    return true
  }

  return {
    token,
    user,
    permissions,
    loading,
    isAuthenticated,
    bootstrapFromStorage,
    login,
    logout,
    hasPermission,
    canAccessRoute,
    clearSession,
    setSession,
  }
})
