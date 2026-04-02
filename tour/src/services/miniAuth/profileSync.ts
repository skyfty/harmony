import { getApiOrigin, miniRequest } from '@harmony/utils'
import { getAccessToken } from '@/api/mini/token'
import {
  normalizeMiniProfileText,
  setAnonymousDisplayEnabled,
  type MiniProfileDraft,
} from '@/utils/miniProfile'

type MiniProfileUser = {
  displayName?: string
  avatarUrl?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
}

type MiniProfileResponse = {
  user: MiniProfileUser
}

type UpdateProfilePayload = {
  displayName?: string
  avatarUrl?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
}

type UploadAvatarResponse = {
  avatarUrl?: string
}

async function getRawProfile(): Promise<MiniProfileUser> {
  const response = await miniRequest<MiniProfileResponse>('/mini-auth/profile', {
    method: 'GET',
  })
  return response.user || {}
}

async function saveRawProfile(profile: MiniProfileUser): Promise<void> {
  const payload: UpdateProfilePayload = {
    displayName: normalizeMiniProfileText(profile.displayName),
    avatarUrl: normalizeMiniProfileText(profile.avatarUrl),
    gender: profile.gender,
    birthDate: profile.birthDate || undefined,
  }

  await miniRequest<MiniProfileResponse>('/mini-auth/profile', {
    method: 'PATCH',
    body: payload,
  })
}

async function uploadAvatar(filePath: string): Promise<string> {
  const localFilePath = String(filePath || '').trim()
  if (!localFilePath) {
    throw new Error('头像文件路径无效')
  }

  const token = getAccessToken()
  const target = `${getApiOrigin()}/api/mini-auth/avatar`

  const result = await new Promise<UploadAvatarResponse>((resolve, reject) => {
    uni.uploadFile({
      url: target,
      filePath: localFilePath,
      name: 'avatar',
      timeout: 30000,
      header: token ? { Authorization: `Bearer ${token}` } : undefined,
      success: (response) => {
        const statusCode = Number(response.statusCode ?? 0)
        const bodyText = typeof response.data === 'string' ? response.data : ''
        if (!bodyText) {
          reject(new Error('头像上传响应为空'))
          return
        }

        try {
          const parsed = JSON.parse(bodyText) as {
            code?: number
            data?: UploadAvatarResponse
            message?: string
          }
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(parsed.message || `头像上传失败(${statusCode || 'network'})`))
            return
          }
          if (parsed.code !== 0) {
            reject(new Error(parsed.message || '头像上传失败'))
            return
          }
          resolve(parsed.data ?? {})
        } catch {
          reject(new Error('头像上传响应格式错误'))
        }
      },
      fail: () => {
        reject(new Error('头像上传失败'))
      },
    })
  })

  const avatarUrl = String(result.avatarUrl || '').trim()
  if (!avatarUrl) {
    throw new Error('头像上传未返回有效地址')
  }
  return avatarUrl
}

export async function syncMiniProfileDraft(draft: MiniProfileDraft): Promise<boolean> {
  const currentProfile = await getRawProfile()
  const nextDisplayName = normalizeMiniProfileText(draft.displayName) ?? currentProfile.displayName

  let nextAvatarUrl = String(currentProfile.avatarUrl || '').trim()
  if (draft.avatarFilePath) {
    nextAvatarUrl = await uploadAvatar(draft.avatarFilePath)
  }

  const hasDisplayNameChanged = nextDisplayName !== currentProfile.displayName
  const hasAvatarChanged = nextAvatarUrl !== String(currentProfile.avatarUrl || '').trim()

  if (hasDisplayNameChanged || hasAvatarChanged) {
    await saveRawProfile({
      ...currentProfile,
      displayName: nextDisplayName,
      avatarUrl: nextAvatarUrl || undefined,
    })
  }

  setAnonymousDisplayEnabled(false)
  return true
}