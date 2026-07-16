import type { Context } from 'koa'
import {
  advanceBusinessOrderProduction,
  approveBusinessOrderRenewal,
  bindBusinessOrderDelivery,
  completeBusinessOrderOperation,
  completeBusinessOrderProduction,
  completeBusinessOrderPublish,
  getBusinessOrderAnalyticsByOrder,
  getBusinessOrderById,
  listBusinessOrderRenewals,
  listBusinessOrders,
  markBusinessOrderSigned,
  updateBusinessOrderAdminFields,
} from '@/services/businessOrderService'

function getErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Business order not found' || message === 'Scene spot not found') {
    return 404
  }
  if (message === 'Invalid business order id' || message === 'Invalid scene spot id' || message === 'Invalid scene id') {
    return 400
  }
  return 400
}

export async function listBusinessOrdersHandler(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, promoterPhone, topStage, contractStatus, userId, serviceStatus } = ctx.query as Record<string, string>
  const result = await listBusinessOrders({
    page: Number(page),
    pageSize: Number(pageSize),
    keyword,
    promoterPhone,
    topStage,
    contractStatus,
    userId,
    serviceStatus,
    origin: ctx.origin,
  })
  ctx.body = result
}

export async function getBusinessOrderHandler(ctx: Context): Promise<void> {
  try {
    const order = await getBusinessOrderById(String(ctx.params?.id || ''), { includeRenewals: true, origin: ctx.origin })
    if (!order) {
      ctx.throw(404, 'Business order not found')
    }
    ctx.body = order
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Load business order failed')
  }
}

export async function markBusinessOrderSignedHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await markBusinessOrderSigned(String(ctx.params?.id || ''), ctx.origin)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Sign business order failed')
  }
}

export async function advanceBusinessOrderProductionHandler(ctx: Context): Promise<void> {
  try {
    const remark = (ctx.request.body as Record<string, unknown>)?.remark
    ctx.body = await advanceBusinessOrderProduction(String(ctx.params?.id || ''), typeof remark === 'string' ? remark : null, ctx.origin)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Advance production failed')
  }
}

export async function completeBusinessOrderProductionHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await completeBusinessOrderProduction(String(ctx.params?.id || ''), ctx.origin)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Complete production failed')
  }
}

export async function completeBusinessOrderPublishHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await completeBusinessOrderPublish(String(ctx.params?.id || ''), ctx.origin)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Complete publish failed')
  }
}

export async function completeBusinessOrderOperationHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await completeBusinessOrderOperation(String(ctx.params?.id || ''), ctx.origin)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Complete operation failed')
  }
}

export async function updateBusinessOrderHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await updateBusinessOrderAdminFields(String(ctx.params?.id || ''), (ctx.request.body ?? {}) as Record<string, unknown>, ctx.origin)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Update business order failed')
  }
}

export async function bindBusinessOrderDeliveryHandler(ctx: Context): Promise<void> {
  try {
    const sceneSpotId = (ctx.request.body as Record<string, unknown>)?.sceneSpotId
    ctx.body = await bindBusinessOrderDelivery(
      String(ctx.params?.id || ''),
      typeof sceneSpotId === 'string' ? sceneSpotId : '',
      ctx.origin,
    )
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Bind business order delivery failed')
  }
}

export async function approveBusinessOrderRenewalHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await approveBusinessOrderRenewal(String(ctx.params?.id || ''), ctx.origin)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Approve business order renewal failed')
  }
}

export async function listBusinessOrderRenewalsHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await listBusinessOrderRenewals(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Load business order renewals failed')
  }
}

export async function getBusinessOrderAnalyticsHandler(ctx: Context): Promise<void> {
  try {
    const { dimension, granularity, metric, limit, start, end } = ctx.query as Record<string, string>
    ctx.body = await getBusinessOrderAnalyticsByOrder(String(ctx.params?.id || ''), undefined, {
      dimension: dimension === 'category' ? 'category' : 'checkpoint',
      granularity: granularity === 'month' ? 'month' : 'day',
      metric: metric === 'pv' || metric === 'uv' || metric === 'newUsers' || metric === 'punchCount' ? metric : 'uv',
      limit: Number(limit) || 8,
      start,
      end,
    })
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Load business order analytics failed')
  }
}
