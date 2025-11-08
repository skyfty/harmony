import type { Context, Next } from 'koa'
import { verifyAuthToken } from '@/utils/jwt'

function assignUserState(ctx: Context, token: string): void {
  const payload = verifyAuthToken(token)
  ctx.state.user = {
    id: payload.sub,
    username: payload.username,
    roles: payload.roles,
    permissions: payload.permissions,
  }
}

export async function authMiddleware(ctx: Context, next: Next): Promise<void> {
  const authorization = ctx.headers.authorization
  if (!authorization || !authorization.startsWith('Bearer ')) {
    ctx.throw(401, 'Unauthorized')
  }
  const token = authorization.slice('Bearer '.length)
  try {
    assignUserState(ctx, token)
  } catch (error) {
    ctx.throw(401, 'Invalid token')
  }
  await next()
}

export async function optionalAuthMiddleware(ctx: Context, next: Next): Promise<void> {
  const authorization = ctx.headers.authorization
  if (!authorization || !authorization.startsWith('Bearer ')) {
    await next()
    return
  }
  const token = authorization.slice('Bearer '.length)
  try {
    assignUserState(ctx, token)
  } catch (error) {
    console.warn('Failed to decode optional auth token:', error)
  }
  await next()
}
