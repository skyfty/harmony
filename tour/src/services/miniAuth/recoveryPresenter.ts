import type {
  MiniAuthRecoveryOptions,
  MiniAuthRecoveryPresenter,
  MiniAuthRecoveryResult,
} from './types'

let presenter: MiniAuthRecoveryPresenter | null = null
const MINI_AUTH_PRESENTER_LOG_PREFIX = '[mini-auth-presenter]'

function logMiniAuthPresenter(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`${MINI_AUTH_PRESENTER_LOG_PREFIX} ${message}`)
    return
  }
  console.info(`${MINI_AUTH_PRESENTER_LOG_PREFIX} ${message}`, details)
}

export function setMiniAuthRecoveryPresenter(nextPresenter: MiniAuthRecoveryPresenter | null): void {
  presenter = nextPresenter
  logMiniAuthPresenter('set presenter', { installed: Boolean(nextPresenter) })
}

export async function requestMiniAuthRecovery(
  options: MiniAuthRecoveryOptions = {},
): Promise<MiniAuthRecoveryResult> {
  const activePresenter = presenter
  logMiniAuthPresenter('request recovery', {
    hasPresenter: Boolean(activePresenter),
    title: options.title || '(empty)',
    confirmText: options.confirmText || '(empty)',
  })
  if (!activePresenter) {
    throw new Error('Mini auth recovery presenter unavailable')
  }

  const result = await activePresenter(options)
  logMiniAuthPresenter('recovery resolved', { action: result.action })
  return result
}