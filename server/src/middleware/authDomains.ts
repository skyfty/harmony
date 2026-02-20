import type { Context, Next } from 'koa'
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
  const token = readBearerToken(ctx)
  try {
    const payload = verifyMiniAuthToken(token)
    ctx.state.miniAuthUser = {
      id: payload.sub,
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
    ctx.throw(401, 'Invalid user token')
  }
  await next()
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
