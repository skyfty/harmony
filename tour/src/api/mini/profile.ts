import type { Gender, UserProfile } from '@/types/profile'
import { getApiOrigin, miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'
import { getAccessToken, setAccessToken } from './token'

type MiniProfileUser = {
  id: string
  authProvider?: 'wechat-mini-program' | 'password'
  username?: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  phoneCountryCode?: string
  phoneBoundAt?: string
  hasBoundPhone?: boolean
  gender?: Gender
  birthDate?: string
  lastLoginAt?: string
}

type MiniProfileResponse = {
  token?: string
  user: MiniProfileUser
}

type UpdateProfilePayload = {
  displayName?: string
  avatarUrl?: string
  gender?: Gender
  birthDate?: string
}

type UploadAvatarResponse = {
  avatarUrl?: string
}

function toUserProfile(user: MiniProfileUser): UserProfile {
  return {
    id: user.id,
    displayName: user.displayName || user.username || '游客',
    email: user.email,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    phoneCountryCode: user.phoneCountryCode,
    phoneBoundAt: user.phoneBoundAt,
    hasBoundPhone: user.hasBoundPhone ?? Boolean(user.phone),
    authProvider: user.authProvider,
    gender: user.gender ?? 'other',
    birthDate: user.birthDate ? user.birthDate.slice(0, 10) : '',
    lastLoginAt: user.lastLoginAt,
  }
}

export async function getProfile(): Promise<UserProfile> {
  await ensureMiniAuth()
  const response = await miniRequest<MiniProfileResponse>('/mini-auth/profile', {
    method: 'GET',
  })
  return toUserProfile(response.user)
}

export async function saveProfile(profile: UserProfile): Promise<UserProfile> {
  await ensureMiniAuth()
  const payload: UpdateProfilePayload = {
    displayName: profile.displayName.trim(),
    avatarUrl: profile.avatarUrl,
    gender: profile.gender,
    birthDate: profile.birthDate || undefined,
  }
  const response = await miniRequest<MiniProfileResponse>('/mini-auth/profile', {
    method: 'PATCH',
    body: payload,
  })
  return toUserProfile(response.user)
}

export async function uploadProfileAvatar(filePath: string): Promise<string> {
  const localFilePath = String(filePath || '').trim()
  if (!localFilePath) {
    throw new Error('头像文件路径无效')
  }

  await ensureMiniAuth()
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

export async function bindWechatPhone(code: string): Promise<UserProfile> {
  await ensureMiniAuth()
  const response = await miniRequest<MiniProfileResponse>('/mini-auth/bind-phone', {
    method: 'POST',
    body: { code },
  })
  if (response.token) {
    setAccessToken(response.token)
  }
  return toUserProfile(response.user)
}
