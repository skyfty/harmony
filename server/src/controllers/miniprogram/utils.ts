import type { Context } from 'koa'

export function ensureUserId(ctx: Context): string {
  const userId = ctx.state.user?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  return userId
}

export function getOptionalUserId(ctx: Context): string | undefined {
  return ctx.state.user?.id
}
