const LOCAL_EDIT_KEY = 'localedit'

export function isLocalEditEnabled(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_EDIT_KEY) === '1'
  } catch (_error) {
    return false
  }
}

export function setLocalEditEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(LOCAL_EDIT_KEY, '1')
    } else {
      window.localStorage.removeItem(LOCAL_EDIT_KEY)
    }
  } catch (_error) {
    /* noop */
  }
}
