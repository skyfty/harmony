const LOCAL_EDIT_KEY = 'localedit'

/**
 * Local edit mode controls whether the editor can be used without signing in.
 * It is enabled by default so the editor works fully locally / offline; a
 * hosted deployment can explicitly opt out by storing `0` under the
 * `localedit` key (see `setLocalEditEnabled`), which restores the
 * login-required behavior.
 */
export function isLocalEditEnabled(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_EDIT_KEY) !== '0'
  } catch (_error) {
    // No storage access (SSR, hardened browser): keep the local-first default.
    return true
  }
}

export function setLocalEditEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(LOCAL_EDIT_KEY, enabled ? '1' : '0')
  } catch (_error) {
    /* noop */
  }
}
