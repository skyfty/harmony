import type { Context, Next } from 'koa'
import { appConfig } from '@/config/env'
import { AppUserModel } from '@/models/AppUser'

export async function requireMiniProfileComplete(ctx: Context, next: Next): Promise<void> {
  const userId = ctx.state.user?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
    return
  }

  const user = await AppUserModel.findById(userId).lean().exec()
  if (!user) {
    ctx.throw(401, 'Unauthorized')
    return
  }

  const displayName = typeof user.displayName === 'string' ? user.displayName.trim() : ''
  const avatarUrl = typeof user.avatarUrl === 'string' ? user.avatarUrl.trim() : ''
  const defaultDisplayName = String(appConfig.miniAuth.defaultDisplayName ?? '').trim()
  const hasRealDisplayName = Boolean(displayName) && (!defaultDisplayName || displayName !== defaultDisplayName)

  if (!hasRealDisplayName || !avatarUrl) {
    ctx.throw(412, '请先完善头像和昵称后再下单支付')
    return
  }

  await next()
}
