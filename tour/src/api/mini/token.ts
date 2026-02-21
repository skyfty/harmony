import { clearAuthToken, getAuthToken, setAuthToken } from '@harmony/utils'

export function getAccessToken(): string {
  return getAuthToken() ?? ''
}

export function setAccessToken(token: string): void {
  if (token) {
    setAuthToken(token)
  } else {
    clearAuthToken()
  }
}
