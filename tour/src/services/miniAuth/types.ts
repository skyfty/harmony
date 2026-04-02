import type { MiniProfileDraft, MiniProfileShape } from '@/utils/miniProfile'

export type MiniAuthUser = MiniProfileShape & {
  username?: string
}

export type MiniAuthLoginResponse = {
  token?: string
  accessToken?: string
  user?: MiniAuthUser
}

export type MiniAuthRecoveryResult =
  | ({ action: 'submit' } & MiniProfileDraft)
  | { action: 'skip' }

export type MiniAuthRecoveryOptions = {
  title?: string
  description?: string
  confirmText?: string
  skipText?: string
  initialDisplayName?: string
}

export type MiniAuthRecoveryPresenter = (options: MiniAuthRecoveryOptions) => Promise<MiniAuthRecoveryResult>

export type MiniAuthRecoveryDialogState = {
  visible: boolean
  options: MiniAuthRecoveryOptions
  activeHostId: number | null
}