export type Gender = 'male' | 'female' | 'other';

export interface UserProfile {
  id: string;
  avatarUrl?: string;
  displayName: string;
  gender: Gender;
  birthDate?: string; // YYYY-MM-DD
}
