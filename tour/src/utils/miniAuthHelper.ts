import { getProfile, saveProfile, uploadProfileAvatar } from '@/api/mini'
import { getAccessToken } from '@/api/mini/token'
import { setPendingRecoveryProfile, ensureMiniAuth } from '@/api/mini/session'
import { redirectToNav } from '@/utils/navKey'
import {
  normalizeMiniProfileText,
  setAnonymousDisplayEnabled,
  type MiniProfileDraft,
} from '@/utils/miniProfile'
import {
  showRecoveryModal,
  type MiniAuthRecoveryOptions,
  type MiniAuthRecoveryResult,
} from '@/stores/miniAuthRecovery'

const DEFAULT_AUTH_RECOVERY_OPTIONS: MiniAuthRecoveryOptions = {
  title: '完善微信资料',
  description: '请填写微信昵称并选择头像，授权后会自动同步到账号资料。',
  confirmText: '同步并继续',
  skipText: '暂时匿名使用',
}

const DEFAULT_MANUAL_RECOVERY_OPTIONS: MiniAuthRecoveryOptions = {
  title: '获取微信头像昵称',
  description: '补充微信头像和昵称后，会自动更新到当前账号。',
  confirmText: '同步到账号',
  skipText: '暂不处理',
}

function resolveRecoveryOptions(options?: MiniAuthRecoveryOptions): MiniAuthRecoveryOptions {
  return {
    ...DEFAULT_AUTH_RECOVERY_OPTIONS,
    ...(options ?? {}),
  }
}

async function promptMiniProfileRecovery(options?: MiniAuthRecoveryOptions): Promise<MiniAuthRecoveryResult> {
  return await showRecoveryModal(resolveRecoveryOptions(options))
}

export async function syncMiniProfileDraft(draft: MiniProfileDraft): Promise<boolean> {
  const currentProfile = await getProfile()
  const nextDisplayName = normalizeMiniProfileText(draft.displayName) ?? currentProfile.displayName

  let nextAvatarUrl = String(currentProfile.avatarUrl || '').trim()
  if (draft.avatarFilePath) {
    nextAvatarUrl = await uploadProfileAvatar(draft.avatarFilePath)
  }

  const hasDisplayNameChanged = nextDisplayName !== currentProfile.displayName
  const hasAvatarChanged = nextAvatarUrl !== String(currentProfile.avatarUrl || '').trim()

  if (hasDisplayNameChanged || hasAvatarChanged) {
    await saveProfile({
      ...currentProfile,
      displayName: nextDisplayName,
      avatarUrl: nextAvatarUrl || undefined,
    })
  }

  setAnonymousDisplayEnabled(false)
  return true
}

export async function ensureAuthThenNavigate(key: string): Promise<boolean> {
  try {
    if (getAccessToken()) {
      // already logged in
      redirectToNav(key as any)
      return true
    }

    const result = await promptMiniProfileRecovery()
    if (result.action === 'submit') {
      setAnonymousDisplayEnabled(false)
      setPendingRecoveryProfile({
        displayName: normalizeMiniProfileText(result.displayName),
        avatarFilePath: result.avatarFilePath,
      })
    } else {
      setPendingRecoveryProfile(null)
      setAnonymousDisplayEnabled(true)
    }

    await ensureMiniAuth()
    redirectToNav(key as any)
    return true
  } catch {
    try {
      redirectToNav(key as any)
    } catch {}
    return false
  }
}

export async function requestProfileAndSync(options: MiniAuthRecoveryOptions = DEFAULT_MANUAL_RECOVERY_OPTIONS): Promise<boolean> {
  try {
    const result = await promptMiniProfileRecovery(options)
    if (result.action !== 'submit') {
      return false
    }

    return await syncMiniProfileDraft({
      displayName: normalizeMiniProfileText(result.displayName),
      avatarFilePath: result.avatarFilePath,
    })
  } catch {
    return false
  }
}
