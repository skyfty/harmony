import type { Gender, UserProfile } from '@/types/profile'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

type MiniProfileUser = {
  id: string
  username?: string
  displayName?: string
  avatarUrl?: string
  gender?: Gender
  birthDate?: string
}

type MiniProfileResponse = {
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
    avatarUrl: user.avatarUrl,
    gender: user.gender ?? 'other',
    birthDate: user.birthDate ? user.birthDate.slice(0, 10) : '',
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
