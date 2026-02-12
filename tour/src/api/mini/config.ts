function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function getMiniApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_MINI_API_BASE
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return trimTrailingSlash(fromEnv.trim())
  }
  return 'http://127.0.0.1:4000/api/mini'
}
