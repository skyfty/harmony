import type { Context, Next } from 'koa'
import { appConfig } from '@/config/env'
import { getMiniProgramTestSessionUser } from '@/services/miniAuthService'
import { verifyAdminAuthToken, verifyMiniAuthToken } from '@/utils/domainJwt'

function summarizeBearerToken(token: string): string {
  if (!token) {
    return 'none'
  }
  if (token.length <= 16) {
    return `${token.length}:${token}`
  }
  return `${token.length}:${token.slice(0, 8)}...${token.slice(-6)}`
}

function decodeJwtPayloadPreview(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length < 2) {
    return { validFormat: false }
  }
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  try {
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>
    return {
      validFormat: true,
      iss: payload.iss,
      aud: payload.aud,
      sub: payload.sub,
      exp: payload.exp,
      iat: payload.iat,
      kind: payload.kind,
      miniAppId: payload.miniAppId,
    }
  } catch {
    return { validFormat: false }
  }
}

function readBearerToken(ctx: Context): string {
  const authorization = ctx.headers.authorization
  if (!authorization || !authorization.startsWith('Bearer ')) {
    ctx.throw(401, 'Unauthorized')
  }
  return authorization.slice('Bearer '.length)
}

export async function requireAdminAuth(ctx: Context, next: Next): Promise<void> {
  const token = readBearerToken(ctx)
  try {
    const payload = verifyAdminAuthToken(token)
    ctx.state.adminAuthUser = {
      id: payload.sub,
      username: payload.username,
      roles: payload.roles,
      permissions: payload.permissions,
    }
  } catch {
    ctx.throw(401, 'Invalid admin token')
  }
  await next()
}

export async function requireMiniAuth(ctx: Context, next: Next): Promise<void> {
  const authorization = ctx.headers.authorization
  const hasBearerToken = Boolean(authorization && authorization.startsWith('Bearer '))

  if (hasBearerToken) {
    const token = authorization!.slice('Bearer '.length)
    let payload:
      | {
          sub: string
          miniAppId?: string
          username?: string
          wxOpenId?: string
        }
      | undefined
    try {
      payload = verifyMiniAuthToken(token)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const name = error instanceof Error ? error.name : 'UnknownError'
      console.warn('[mini-auth] token verification failed', {
        path: ctx.path,
        method: ctx.method,
        ip: ctx.ip || ctx.request.ip,
        tokenSummary: summarizeBearerToken(token),
        tokenPreview: decodeJwtPayloadPreview(token),
        errorName: name,
        errorMessage: message,
      })
    }

    if (payload) {
      ctx.state.miniAuthUser = {
        id: payload.sub,
        miniAppId: payload.miniAppId,
        username: payload.username,
        wxOpenId: payload.wxOpenId,
      }
      ctx.state.user = {
        id: payload.sub,
        username: payload.username ?? payload.wxOpenId ?? payload.sub,
        roles: [],
        permissions: [],
        accountType: 'user',
      }
      await next()
      return
    }
  }

  if (appConfig.miniAuth.allowTestBypassInNonProd) {
    const testUser = await getMiniProgramTestSessionUser()
    if (testUser) {
      ctx.state.miniAuthUser = {
        id: testUser.id,
        miniAppId: testUser.miniAppId,
        username: testUser.username,
        wxOpenId: testUser.wxOpenId,
      }
      ctx.state.user = {
        id: testUser.id,
        username: testUser.username ?? testUser.wxOpenId ?? testUser.id,
        roles: [],
        permissions: [],
        accountType: 'user',
      }
      await next()
      return
    }
  }

  if (!hasBearerToken) {
    ctx.throw(401, 'Unauthorized')
  }
}

export async function optionalMiniAuth(ctx: Context, next: Next): Promise<void> {
  const authorization = ctx.headers.authorization
  if (!authorization || !authorization.startsWith('Bearer ')) {
    await next()
    return
  }

  const token = authorization.slice('Bearer '.length)
  try {
    const payload = verifyMiniAuthToken(token)
    ctx.state.miniAuthUser = {
      id: payload.sub,
      miniAppId: payload.miniAppId,
      username: payload.username,
      wxOpenId: payload.wxOpenId,
    }
    ctx.state.user = {
      id: payload.sub,
      username: payload.username ?? payload.wxOpenId ?? payload.sub,
      roles: [],
      permissions: [],
      accountType: 'user',
    }
  } catch {
    // Ignore invalid optional token and continue as anonymous.
  }

  await next()
}
