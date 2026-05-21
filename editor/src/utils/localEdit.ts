function normalizeFlagValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => normalizeFlagValue(entry))
  }
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  return false
}

export function hasLocalEditFlag(query: unknown): boolean {
  if (!query || typeof query !== 'object') {
    return false
  }
  return normalizeFlagValue((query as Record<string, unknown>).localedit)
}

export function withLocalEditQuery<T extends Record<string, unknown>>(query: T): T & { localedit: string } {
  return {
    ...query,
    localedit: '1',
  }
}
