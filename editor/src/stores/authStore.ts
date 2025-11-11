import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { SessionUser } from '@/types/auth'
import { fetchProfile, loginWithPassword, logoutSession } from '@/api/auth'

type StoredSession = {
  user: SessionUser
  permissions: string[]
}

type LoginPayload = {
  username: string
  password: string
  rememberPassword: boolean
  keepLoggedIn: boolean
}

type LoginDefaults = {
  username: string
  password: string
  rememberPassword: boolean
  keepLoggedIn: boolean
}

const TOKEN_STORAGE_KEY = 'harmony:auth:token'
const SESSION_STORAGE_KEY = 'harmony:auth:session'
const PREFERENCES_STORAGE_KEY = 'harmony:auth:preferences'
const REMEMBER_STORAGE_KEY = 'harmony:auth:remembered'

function encodePassword(value: string): string {
  if (typeof window === 'undefined') {
    return value
  }
  const encoder = new TextEncoder()
  const bytes = encoder.encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return window.btoa(binary)
}

function decodePassword(value: string): string {
  if (typeof window === 'undefined') {
    return value
  }
  try {
    const binary = window.atob(value)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const decoder = new TextDecoder()
    return decoder.decode(bytes)
  } catch (_error) {
    return ''
  }
}

function resolveStorage(useLocal: boolean): Storage {
  return useLocal ? window.localStorage : window.sessionStorage
}

function safeRemove(storage: Storage, key: string) {
  try {
    storage.removeItem(key)
  } catch (_error) {
    /* noop */
  }
}

function safeSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value)
  } catch (_error) {
    /* noop */
  }
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch (_error) {
    return null
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch (_error) {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<SessionUser | null>(null)
  const permissions = ref<string[]>([])
  const loginDialogVisible = ref(false)
  const loginLoading = ref(false)
  const loginError = ref<string | null>(null)
  const initialized = ref(false)
  const keepLoggedInPreference = ref(false)
  const rememberedCredentials = ref<{ username: string; password: string } | null>(null)

  const authorizationHeader = computed(() => (token.value ? `Bearer ${token.value}` : null))
  const isAuthenticated = computed(() => !!token.value && !!user.value)
  const displayName = computed(() => user.value?.displayName ?? user.value?.username ?? '')
  const username = computed(() => user.value?.username ?? '')
  const avatarUrl = computed(() => user.value?.avatarUrl ?? null)

  function loadPreferences() {
    if (typeof window === 'undefined') {
      return
    }
    const raw = safeGet(window.localStorage, PREFERENCES_STORAGE_KEY)
    const parsed = parseJson<{ keepLoggedIn?: boolean }>(raw)
    keepLoggedInPreference.value = parsed?.keepLoggedIn ?? false
  }

  function persistPreferences() {
    if (typeof window === 'undefined') {
      return
    }
    safeSet(window.localStorage, PREFERENCES_STORAGE_KEY, JSON.stringify({ keepLoggedIn: keepLoggedInPreference.value }))
  }

  function loadRememberedCredentials() {
    if (typeof window === 'undefined') {
      return
    }
    const raw = safeGet(window.localStorage, REMEMBER_STORAGE_KEY)
    const parsed = parseJson<{ username: string; password: string }>(raw)
    if (parsed && typeof parsed.username === 'string' && typeof parsed.password === 'string') {
      rememberedCredentials.value = parsed
    } else {
      rememberedCredentials.value = null
    }
  }

  function persistRememberedCredentials(username: string, password: string) {
    if (typeof window === 'undefined') {
      return
    }
    rememberedCredentials.value = { username, password: encodePassword(password) }
    safeSet(window.localStorage, REMEMBER_STORAGE_KEY, JSON.stringify(rememberedCredentials.value))
  }

  function clearRememberedCredentials() {
    if (typeof window === 'undefined') {
      return
    }
    rememberedCredentials.value = null
    safeRemove(window.localStorage, REMEMBER_STORAGE_KEY)
  }

  function readPersistedToken(): { token: string | null; persistent: boolean } {
    if (typeof window === 'undefined') {
      return { token: null, persistent: false }
    }
    const localToken = safeGet(window.localStorage, TOKEN_STORAGE_KEY)
    if (localToken) {
      return { token: localToken, persistent: true }
    }
    const sessionToken = safeGet(window.sessionStorage, TOKEN_STORAGE_KEY)
    if (sessionToken) {
      return { token: sessionToken, persistent: false }
    }
    return { token: null, persistent: keepLoggedInPreference.value }
  }

  function persistToken(value: string | null, persistent: boolean) {
    if (typeof window === 'undefined') {
      token.value = value
      return
    }
    const target = resolveStorage(persistent)
    const alternate = resolveStorage(!persistent)
    if (value) {
      safeSet(target, TOKEN_STORAGE_KEY, value)
    } else {
      safeRemove(target, TOKEN_STORAGE_KEY)
    }
    safeRemove(alternate, TOKEN_STORAGE_KEY)
  }

  function persistSession(session: StoredSession | null, persistent: boolean) {
    if (typeof window === 'undefined') {
      return
    }
    const target = resolveStorage(persistent)
    const alternate = resolveStorage(!persistent)
    if (session) {
      safeSet(target, SESSION_STORAGE_KEY, JSON.stringify(session))
    } else {
      safeRemove(target, SESSION_STORAGE_KEY)
    }
    safeRemove(alternate, SESSION_STORAGE_KEY)
  }

  function readPersistedSession(persistent: boolean): StoredSession | null {
    if (typeof window === 'undefined') {
      return null
    }
    const target = resolveStorage(persistent)
    const raw = safeGet(target, SESSION_STORAGE_KEY)
    return parseJson<StoredSession>(raw)
  }

  function clearPersistedState() {
    if (typeof window === 'undefined') {
      return
    }
    safeRemove(window.localStorage, TOKEN_STORAGE_KEY)
    safeRemove(window.sessionStorage, TOKEN_STORAGE_KEY)
    safeRemove(window.localStorage, SESSION_STORAGE_KEY)
    safeRemove(window.sessionStorage, SESSION_STORAGE_KEY)
  }

  function applySession(session: StoredSession | null) {
    if (!session) {
      user.value = null
      permissions.value = []
      return
    }
    user.value = session.user
    permissions.value = session.permissions ?? []
  }

  function getLoginDefaults(): LoginDefaults {
    const remembered = rememberedCredentials.value
    return {
      username: remembered?.username ?? '',
      password: remembered ? decodePassword(remembered.password) : '',
      rememberPassword: !!remembered,
      keepLoggedIn: keepLoggedInPreference.value,
    }
  }

  async function initialize(): Promise<void> {
    if (initialized.value) {
      return
    }
    if (typeof window === 'undefined') {
      initialized.value = true
      return
    }
    loadPreferences()
    loadRememberedCredentials()
    const { token: storedToken, persistent } = readPersistedToken()
    const storedSession = readPersistedSession(persistent)
    if (storedToken) {
      token.value = storedToken
      keepLoggedInPreference.value = persistent
      applySession(storedSession)
      try {
        const session = await fetchProfile(storedToken)
        user.value = session.user
        permissions.value = session.permissions ?? []
        persistSession({ user: session.user, permissions: session.permissions ?? [] }, persistent)
      } catch (error) {
        console.warn('[auth] restore session failed', error)
        token.value = null
        user.value = null
        permissions.value = []
        clearPersistedState()
      }
    } else {
      token.value = null
      user.value = null
      permissions.value = []
      clearPersistedState()
    }
    initialized.value = true
  }

  function showLoginDialog() {
    loginError.value = null
    loginDialogVisible.value = true
  }

  function hideLoginDialog() {
    loginDialogVisible.value = false
    loginError.value = null
  }

  function setLoginDialogVisible(visible: boolean) {
    if (visible) {
      showLoginDialog()
    } else {
      hideLoginDialog()
    }
  }

  function clearSessionState() {
    token.value = null
    user.value = null
    permissions.value = []
    clearPersistedState()
  }

  async function login(payload: LoginPayload): Promise<void> {
    loginLoading.value = true
    loginError.value = null
    try {
      const session = await loginWithPassword({ username: payload.username, password: payload.password })
      if (!session.token) {
        throw new Error('服务器未返回登录令牌')
      }
      token.value = session.token
      user.value = session.user
      permissions.value = session.permissions ?? []
      keepLoggedInPreference.value = payload.keepLoggedIn
      persistPreferences()
      persistToken(session.token, payload.keepLoggedIn)
      persistSession({ user: session.user, permissions: session.permissions ?? [] }, payload.keepLoggedIn)
      if (payload.rememberPassword) {
        persistRememberedCredentials(payload.username, payload.password)
      } else {
        clearRememberedCredentials()
      }
      hideLoginDialog()
    } catch (error) {
      const message = (error as Error)?.message ?? '登录失败'
      loginError.value = message
      throw error
    } finally {
      loginLoading.value = false
    }
  }

  async function logout(): Promise<void> {
    if (!token.value) {
      clearSessionState()
      return
    }
    const currentToken = token.value
    clearSessionState()
    try {
      await logoutSession(currentToken)
    } catch (error) {
      console.warn('[auth] logout failed', error)
    }
  }

  return {
    token,
    user,
    permissions,
    loginDialogVisible,
    loginLoading,
    loginError,
    isAuthenticated,
    authorizationHeader,
    displayName,
    username,
    avatarUrl,
    keepLoggedInPreference,
    initialized,
    getLoginDefaults,
    initialize,
    login,
    logout,
    showLoginDialog,
    hideLoginDialog,
    setLoginDialogVisible,
  }
})
