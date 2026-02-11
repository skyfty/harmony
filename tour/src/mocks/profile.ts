import type { UserProfile } from '@/types/profile';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:profile:v1';

const seed: UserProfile = {
  id: 'user-1',
  avatarUrl: '',
  nickname: '游客',
  gender: 'other',
  birthDate: '2000-01-01',
};

export function getProfile(): UserProfile {
  const data = readStorageJson<UserProfile | null>(KEY, null);
  if (data && typeof data === 'object' && typeof (data as any).id === 'string') {
    return data as UserProfile;
  }
  writeStorageJson(KEY, seed);
  return seed;
}

export function saveProfile(profile: UserProfile): void {
  writeStorageJson(KEY, profile);
}
