import type { Context, Next } from 'koa'
import { UserModel } from '@/models/User'
import { verifyAuthToken } from '@/utils/jwt'

async function assignUserState(ctx: Context, token: string): Promise<void> {
  const payload = verifyAuthToken(token)
  if (payload.roles.includes('editor')) {
    const user = await UserModel.findById(payload.sub).lean<{ editorSessionId?: string | null }>().exec()
    if (!user || user.editorSessionId !== (payload.editorSessionId ?? null)) {
      ctx.throw(401, 'SESSION_REPLACED')
    }
  }
  ctx.state.user = {
    id: payload.sub,
    username: payload.username,
    roles: payload.roles,
    permissions: payload.permissions,
    accountType: payload.accountType,
    editorSessionId: payload.editorSessionId ?? null,
  }
}

export async function authMiddleware(ctx: Context, next: Next): Promise<void> {
  const authorization = ctx.headers.authorization
  if (!authorization || !authorization.startsWith('Bearer ')) {
    ctx.throw(401, 'Unauthorized')
  }
  const token = authorization.slice('Bearer '.length)
  try {
    await assignUserState(ctx, token)
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_REPLACED') {
      ctx.throw(401, 'SESSION_REPLACED')
    }
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
    await assignUserState(ctx, token)
  } catch (error) {
    console.warn('Failed to decode optional auth token:', error)
  }
  await next()
}
