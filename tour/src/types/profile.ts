export type Gender = 'male' | 'female' | 'other';

export type AuthProvider = 'wechat-mini-program' | 'password';

export interface UserProfile {
  id: string;
  avatarUrl?: string;
  displayName: string;
  isAnonymousDisplay?: boolean;
  email?: string;
  phone?: string;
  phoneCountryCode?: string;
  phoneBoundAt?: string;
  hasBoundPhone?: boolean;
  authProvider?: AuthProvider;
  gender: Gender;
  birthDate?: string; // YYYY-MM-DD
  lastLoginAt?: string;
  contractStatus?: 'unsigned' | 'signed';
}
