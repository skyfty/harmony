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
    let verifyError: unknown
    try {
      payload = verifyMiniAuthToken(token)
    } catch (error) {
      verifyError = error
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

      // If the token is explicitly expired, respond with a clear auth envelope
      // so clients (miniRequest) treat it as an auth failure and can recover.
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        ctx.status = 401
        ctx.body = {
          code: 401,
          data: {},
          message: 'token expired',
        }
        return
      }
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

  // If we had a bearer token but didn't produce a payload (invalid token),
  // return a 401 business envelope so clients can detect an auth failure
  // and trigger the mini auth recovery flow. If there was no bearer token,
  // behave as before and throw Unauthorized.
  if (hasBearerToken) {
    ctx.status = 401
    ctx.body = {
      code: 401,
      data: {},
      message: 'Unauthorized',
    }
    return
  }

  ctx.throw(401, 'Unauthorized')
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
