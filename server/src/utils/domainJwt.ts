import jwt, { type SignOptions } from 'jsonwebtoken'
import { appConfig } from '@/config/env'

export interface AdminAuthTokenPayload {
  kind: 'admin'
  sub: string
  username: string
  roles: string[]
  permissions: string[]
}

export interface MiniAuthTokenPayload {
  kind: 'user'
  sub: string
  miniAppId?: string
  username?: string
  wxOpenId?: string
}

export function signAdminAuthToken(payload: AdminAuthTokenPayload): string {
  return jwt.sign(payload, appConfig.adminAuth.jwtSecret, {
    expiresIn: appConfig.adminAuth.expiresIn as SignOptions['expiresIn'],
    issuer: appConfig.adminAuth.issuer,
    audience: appConfig.adminAuth.audience,
  })
}

export function verifyAdminAuthToken(token: string): AdminAuthTokenPayload {
  return jwt.verify(token, appConfig.adminAuth.jwtSecret, {
    issuer: appConfig.adminAuth.issuer,
    audience: appConfig.adminAuth.audience,
  }) as AdminAuthTokenPayload
}

export function signMiniAuthToken(payload: MiniAuthTokenPayload): string {
  return jwt.sign(payload, appConfig.miniAuth.jwtSecret, {
    expiresIn: appConfig.miniAuth.expiresIn as SignOptions['expiresIn'],
    issuer: appConfig.miniAuth.issuer,
    audience: appConfig.miniAuth.audience,
  })
}

export function verifyMiniAuthToken(token: string): MiniAuthTokenPayload {
  return jwt.verify(token, appConfig.miniAuth.jwtSecret, {
    issuer: appConfig.miniAuth.issuer,
    audience: appConfig.miniAuth.audience,
  }) as MiniAuthTokenPayload
}
