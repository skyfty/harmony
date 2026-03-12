import type { Gender, UserProfile } from '@/types/profile'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'
import { setAccessToken } from './token'

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
