import type { Context } from 'koa'
import { AppUserModel } from '@/models/AppUser'
import {
  createBusinessHubRenewalPaymentForPhone,
  closeBusinessHubReminderForPhone,
  getBusinessHubBootstrapForPhone,
  getBusinessHubProjectForPhone,
  getBusinessHubRenewalPreviewForPhone,
  listBusinessHubProjectsForPhone,
  decideBusinessHubApprovalForPhone,
  updateBusinessHubTaskForPhone,
} from '@/services/businessHubService'

async function resolveMiniBusinessOwner(ctx: Context): Promise<{
  userId: string
  phone: string | null
  openId: string | null
  miniAppId: string | null
}> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }

  const user = await AppUserModel.findById(userId).lean().exec()
  if (!user) {
    ctx.throw(401, 'Unauthorized')
  }

  const phone = typeof user.phone === 'string' ? user.phone.trim() : ''
  const openId = typeof user.wxOpenId === 'string' ? user.wxOpenId.trim() : ''
  const miniAppId = typeof ctx.state.miniAuthUser?.miniAppId === 'string' ? ctx.state.miniAuthUser.miniAppId.trim() : ''
  return {
    userId,
    phone: phone || null,
    openId: openId || null,
    miniAppId: miniAppId || null,
  }
}

export async function getBusinessHubBootstrapHandler(ctx: Context): Promise<void> {
  const { phone } = await resolveMiniBusinessOwner(ctx)
  ctx.body = await getBusinessHubBootstrapForPhone(phone)
}

export async function listBusinessHubProjectsHandler(ctx: Context): Promise<void> {
  const { phone } = await resolveMiniBusinessOwner(ctx)
  ctx.body = await listBusinessHubProjectsForPhone(phone)
}

export async function getBusinessHubProjectHandler(ctx: Context): Promise<void> {
  const { phone } = await resolveMiniBusinessOwner(ctx)
  try {
    ctx.body = await getBusinessHubProjectForPhone(String(ctx.params?.id || ''), phone)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Load business project failed'
    if (message.includes('无权访问')) {
      ctx.throw(403, message)
    }
    if (message.includes('请先绑定手机号')) {
      ctx.throw(412, message)
    }
    ctx.throw(404, message)
  }
}

export async function getBusinessHubRenewalPreviewHandler(ctx: Context): Promise<void> {
  const { phone } = await resolveMiniBusinessOwner(ctx)
  try {
    ctx.body = await getBusinessHubRenewalPreviewForPhone(String(ctx.params?.id || ''), phone)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Load renewal preview failed'
    if (message.includes('无权访问')) {
      ctx.throw(403, message)
    }
    if (message.includes('请先绑定手机号')) {
      ctx.throw(412, message)
    }
    ctx.throw(400, message)
  }
}

export async function createBusinessHubRenewalHandler(ctx: Context): Promise<void> {
  const { phone, openId, miniAppId } = await resolveMiniBusinessOwner(ctx)
  try {
    if (!openId) {
      ctx.throw(412, '请先完成微信授权后再发起续费支付')
      return
    }
    const body = (ctx.request.body as Record<string, unknown>) || {}
    const renewal = await createBusinessHubRenewalPaymentForPhone(String(ctx.params?.id || ''), phone, openId, miniAppId ?? undefined, {
      durationDays: body.durationDays,
      price: body.price,
      remark: body.remark as string | null | undefined,
    })
    ctx.status = 201
    ctx.body = renewal
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Create renewal failed'
    if (message.includes('无权访问')) {
      ctx.throw(403, message)
    }
    if (message.includes('请先绑定手机号')) {
      ctx.throw(412, message)
    }
    ctx.throw(400, message)
  }
}

export async function updateBusinessHubTaskHandler(ctx: Context): Promise<void> {
  const { phone } = await resolveMiniBusinessOwner(ctx)
  try {
    const body = (ctx.request.body as Record<string, unknown>) || {}
    const status = body.status
    if (status !== 'todo' && status !== 'doing' && status !== 'done' && status !== 'blocked') {
      ctx.throw(400, '任务状态无效')
      return
    }
    ctx.body = await updateBusinessHubTaskForPhone(String(ctx.params?.taskId || ''), phone, {
      status,
      remark: body.remark as string | null | undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update task failed'
    if (message.includes('无权访问')) {
      ctx.throw(403, message)
    }
    if (message.includes('请先绑定手机号')) {
      ctx.throw(412, message)
    }
    ctx.throw(400, message)
  }
}

export async function closeBusinessHubReminderHandler(ctx: Context): Promise<void> {
  const { phone } = await resolveMiniBusinessOwner(ctx)
  try {
    ctx.body = await closeBusinessHubReminderForPhone(String(ctx.params?.reminderId || ''), phone)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Close reminder failed'
    if (message.includes('无权访问')) {
      ctx.throw(403, message)
    }
    if (message.includes('请先绑定手机号')) {
      ctx.throw(412, message)
    }
    ctx.throw(400, message)
  }
}

export async function decideBusinessHubApprovalHandler(ctx: Context): Promise<void> {
  const { phone } = await resolveMiniBusinessOwner(ctx)
  try {
    const body = (ctx.request.body as Record<string, unknown>) || {}
    const status = body.status
    if (status !== 'approved' && status !== 'rejected') {
      ctx.throw(400, '审批状态无效')
      return
    }
    ctx.body = await decideBusinessHubApprovalForPhone(String(ctx.params?.approvalId || ''), phone, status, body.remark as string | null | undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Decide approval failed'
    if (message.includes('无权访问')) {
      ctx.throw(403, message)
    }
    if (message.includes('请先绑定手机号')) {
      ctx.throw(412, message)
    }
    ctx.throw(400, message)
  }
}
