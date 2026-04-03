export type MiniProfileShape = {
  displayName?: string
  avatarUrl?: string
}

export type MiniProfileDraft = {
  displayName?: string
  avatarFilePath?: string
}

const ANONYMOUS_DISPLAY_STORAGE_KEY = 'tour:mini-auth-anonymous-display'
const ANONYMOUS_DISPLAY_NAME = '匿名用户'
const PLACEHOLDER_DISPLAY_NAMES = new Set(['微信用户', '游客', ANONYMOUS_DISPLAY_NAME])

export function normalizeMiniProfileText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

export function getAnonymousDisplayName(): string {
  return ANONYMOUS_DISPLAY_NAME
}

export function isPlaceholderMiniDisplayName(value: unknown): boolean {
  const normalized = normalizeMiniProfileText(value)
  if (!normalized) {
    return true
  }
  return PLACEHOLDER_DISPLAY_NAMES.has(normalized)
}

export function isMiniProfileIncomplete(profile: MiniProfileShape | null | undefined): boolean {
  if (!profile) {
    return true
  }

  if (isPlaceholderMiniDisplayName(profile.displayName)) {
    return true
  }

  return !normalizeMiniProfileText(profile.avatarUrl)
}

export function isAnonymousDisplayEnabled(): boolean {
  try {
    return String(uni.getStorageSync(ANONYMOUS_DISPLAY_STORAGE_KEY) || '') === '1'
  } catch {
    return false
  }
}

export function setAnonymousDisplayEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      uni.setStorageSync(ANONYMOUS_DISPLAY_STORAGE_KEY, '1')
      return
    }

    uni.removeStorageSync(ANONYMOUS_DISPLAY_STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}

export function applyAnonymousProfileView<T extends MiniProfileShape>(profile: T): T & { isAnonymousDisplay: boolean } {
  if (!isAnonymousDisplayEnabled()) {
    return {
      ...profile,
      isAnonymousDisplay: false,
    }
  }

  return {
    ...profile,
    displayName: ANONYMOUS_DISPLAY_NAME,
    avatarUrl: '',
    isAnonymousDisplay: true,
  }
}