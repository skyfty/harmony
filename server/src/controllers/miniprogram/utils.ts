import type { Context } from 'koa'
import { AppUserModel } from '@/models/AppUser'
import { MiniPlatformIdentityModel } from '@/models/MiniPlatformIdentity'

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

export async function ensureMiniCheckoutUser(ctx: Context): Promise<{
  id: string
  appKey?: string
  platform?: 'wechat' | 'douyin' | 'xiaohongshu'
  miniAppId?: string
  wxOpenId: string
  openId: string
  phone?: string
}> {
  const userId = ensureUserId(ctx)
  const user = await AppUserModel.findById(userId).lean().exec()
  if (!user) {
    ctx.throw(401, 'Unauthorized')
  }

  const platform =
    user.platform === 'douyin' || user.platform === 'xiaohongshu' || user.platform === 'wechat'
      ? user.platform
      : 'wechat'
  const identity = await MiniPlatformIdentityModel.findOne({
    userId: user._id,
    platform,
    ...(typeof user.appKey === 'string' && user.appKey.trim() ? { appKey: user.appKey.trim() } : {}),
  }).sort({ lastLoginAt: -1, updatedAt: -1 }).lean().exec()
  const openId = typeof identity?.openId === 'string' && identity.openId.trim()
    ? identity.openId.trim()
    : ''
  if (!openId) {
    ctx.throw(412, '当前账号未绑定平台身份，无法发起支付')
  }

  const phone = typeof user.phone === 'string' ? user.phone.trim() : ''

  return {
    id: userId,
    appKey: typeof user.appKey === 'string' ? user.appKey.trim() || undefined : undefined,
    platform,
    miniAppId: typeof user.miniAppId === 'string' ? user.miniAppId.trim() || undefined : undefined,
    wxOpenId: openId,
    openId,
    phone: phone || undefined,
  }
}
