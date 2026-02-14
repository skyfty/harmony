const TOKEN_KEY = 'tour:mini:accessToken'

export function getAccessToken(): string {
  const raw: unknown = uni.getStorageSync(TOKEN_KEY)
  return typeof raw === 'string' ? raw : ''
}

export function setAccessToken(token: string): void {
  if (token) {
    uni.setStorageSync(TOKEN_KEY, token)
  } else {
    uni.removeStorageSync(TOKEN_KEY)
  }
}
