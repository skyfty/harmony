import type { Context } from 'koa'
import {
  createBusinessOrder,
  createBusinessOrderRenewalPayment,
  createBusinessOrderRenewal,
  getBusinessOrderAnalyticsByOrder,
  getBusinessOrderBootstrap,
  getBusinessOrderDetailForUser,
  getBusinessOrderRenewalPreview,
  listBusinessOrdersForUser,
} from '@/services/businessOrderService'
import { ensureMiniCheckoutUser } from './utils'

function ensureMiniUserId(ctx: Context): string {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  return userId
}

export async function getBusinessOrderBootstrapHandler(ctx: Context): Promise<void> {
  const userId = ensureMiniUserId(ctx)
  ctx.body = await getBusinessOrderBootstrap(userId, ctx.origin)
}

export async function createBusinessOrderHandler(ctx: Context): Promise<void> {
  const userId = ensureMiniUserId(ctx)
  try {
    const order = await createBusinessOrder({
      userId,
      scenicName: (ctx.request.body as Record<string, unknown>)?.scenicName as string,
      addressText: (ctx.request.body as Record<string, unknown>)?.addressText as string,
      location: (ctx.request.body as Record<string, unknown>)?.location as { lat?: number; lng?: number } | null,
      contactPhone: (ctx.request.body as Record<string, unknown>)?.contactPhone as string,
      scenicArea: (ctx.request.body as Record<string, unknown>)?.scenicArea as number | null,
      sceneSpotCategoryId: (ctx.request.body as Record<string, unknown>)?.sceneSpotCategoryId as string | null,
      specialLandscapeTags: (ctx.request.body as Record<string, unknown>)?.specialLandscapeTags as string[],
    }, ctx.origin)
    ctx.status = 201
    ctx.body = order
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Create business order failed')
  }
}

export async function listBusinessOrdersHandler(ctx: Context): Promise<void> {
  const userId = ensureMiniUserId(ctx)
  ctx.body = await listBusinessOrdersForUser(userId, ctx.origin)
}

export async function getBusinessOrderDetailHandler(ctx: Context): Promise<void> {
  const userId = ensureMiniUserId(ctx)
  try {
    const order = await getBusinessOrderDetailForUser(String(ctx.params?.id || ''), userId, ctx.origin)
    if (!order) {
      ctx.throw(404, 'Business order not found')
    }
    ctx.body = order
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Load business order failed')
  }
}

export async function getBusinessOrderRenewalPreviewHandler(ctx: Context): Promise<void> {
  const userId = ensureMiniUserId(ctx)
  try {
    ctx.body = await getBusinessOrderRenewalPreview(String(ctx.params?.id || ''), userId)
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Load renewal preview failed')
  }
}

export async function createBusinessOrderRenewalHandler(ctx: Context): Promise<void> {
  const userId = ensureMiniUserId(ctx)
  try {
    ctx.status = 201
    ctx.body = await createBusinessOrderRenewal(String(ctx.params?.id || ''), userId)
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Create renewal failed')
  }
}

export async function payBusinessOrderRenewalHandler(ctx: Context): Promise<void> {
  const checkoutUser = await ensureMiniCheckoutUser(ctx)
  try {
    const result = await createBusinessOrderRenewalPayment(
      String(ctx.params?.id || ''),
      checkoutUser.id,
      checkoutUser.miniAppId,
      checkoutUser.wxOpenId,
      ctx.origin,
    )
    ctx.status = 201
    ctx.body = {
      orderNumber: result.orderNumber,
      paymentStatus: result.paymentStatus,
      renewal: result.renewal,
      payParams: result.payParams,
    }
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Create renewal payment failed')
  }
}

export async function getBusinessOrderAnalyticsHandler(ctx: Context): Promise<void> {
  const userId = ensureMiniUserId(ctx)
  try {
    const { dimension, granularity, metric, limit, start, end } = ctx.query as Record<string, string>
    ctx.body = await getBusinessOrderAnalyticsByOrder(String(ctx.params?.id || ''), userId, {
      dimension: dimension === 'category' ? 'category' : 'checkpoint',
      granularity: granularity === 'month' ? 'month' : 'day',
      metric: metric === 'pv' || metric === 'uv' || metric === 'newUsers' || metric === 'punchCount' ? metric : 'uv',
      limit: Number(limit) || 8,
      start,
      end,
    })
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Load business order analytics failed')
  }
}
