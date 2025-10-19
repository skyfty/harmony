import type { Context, Next } from 'koa'
import { verifyAuthToken } from '@/utils/jwt'

export async function authMiddleware(ctx: Context, next: Next): Promise<void> {
  const authorization = ctx.headers.authorization
  if (!authorization || !authorization.startsWith('Bearer ')) {
    ctx.throw(401, 'Unauthorized')
  }
  const token = authorization.slice('Bearer '.length)
  try {
    const payload = verifyAuthToken(token)
    ctx.state.user = {
      id: payload.sub,
      username: payload.username,
      roles: payload.roles,
      permissions: payload.permissions,
    }
  } catch (error) {
    ctx.throw(401, 'Invalid token')
  }
  await next()
}
