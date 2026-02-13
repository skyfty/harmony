import jwt from 'jsonwebtoken'
import { appConfig } from '@/config/env'

export interface AuthTokenPayload {
  sub: string
  username: string
  roles: string[]
  permissions: string[]
  accountType?: 'admin' | 'super' | 'user'
}

const TOKEN_EXPIRES_IN = '12h'

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, appConfig.jwtSecret, { expiresIn: TOKEN_EXPIRES_IN })
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, appConfig.jwtSecret) as AuthTokenPayload
}
