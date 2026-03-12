import type { Context } from 'koa'
import { AppUserModel } from '@/models/AppUser'

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
  miniAppId?: string
  wxOpenId: string
  phone: string
}> {
  const userId = ensureUserId(ctx)
  const user = await AppUserModel.findById(userId).lean().exec()
  if (!user) {
    ctx.throw(401, 'Unauthorized')
  }

  const wxOpenId = typeof user.wxOpenId === 'string' ? user.wxOpenId.trim() : ''
  if (!wxOpenId) {
    ctx.throw(412, '当前账号未绑定微信身份，无法发起支付')
  }

  const phone = typeof user.phone === 'string' ? user.phone.trim() : ''
  if (!phone) {
    ctx.throw(412, '请先绑定手机号后再下单支付')
  }

  return {
    id: userId,
    miniAppId: typeof user.miniAppId === 'string' ? user.miniAppId.trim() || undefined : undefined,
    wxOpenId,
    phone,
  }
}
