import type { Context, Next } from 'koa'
import { appConfig } from '@/config/env'
import { getMiniProgramTestSessionUser } from '@/services/miniAuthService'
import { verifyAdminAuthToken, verifyMiniAuthToken } from '@/utils/domainJwt'

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
      await next()
      return
    } catch {
      // Fall through to optional non-production bypass.
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
  ctx.throw(401, 'Invalid user token')
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
