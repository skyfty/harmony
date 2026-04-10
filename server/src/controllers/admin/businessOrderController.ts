import type { Context } from 'koa'
import {
  advanceBusinessOrderProduction,
  completeBusinessOrderProduction,
  completeBusinessOrderPublish,
  getBusinessOrderById,
  listBusinessOrders,
  markBusinessOrderSigned,
  updateBusinessOrderAdminFields,
} from '@/services/businessOrderService'

function getErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Business order not found') {
    return 404
  }
  if (message === 'Invalid business order id') {
    return 400
  }
  return 400
}

export async function listBusinessOrdersHandler(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, topStage, contractStatus } = ctx.query as Record<string, string>
  const result = await listBusinessOrders({
    page: Number(page),
    pageSize: Number(pageSize),
    keyword,
    topStage,
    contractStatus,
  })
  ctx.body = result
}

export async function getBusinessOrderHandler(ctx: Context): Promise<void> {
  try {
    const order = await getBusinessOrderById(String(ctx.params?.id || ''))
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
    ctx.body = await markBusinessOrderSigned(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Sign business order failed')
  }
}

export async function advanceBusinessOrderProductionHandler(ctx: Context): Promise<void> {
  try {
    const remark = (ctx.request.body as Record<string, unknown>)?.remark
    ctx.body = await advanceBusinessOrderProduction(String(ctx.params?.id || ''), typeof remark === 'string' ? remark : null)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Advance production failed')
  }
}

export async function completeBusinessOrderProductionHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await completeBusinessOrderProduction(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Complete production failed')
  }
}

export async function completeBusinessOrderPublishHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await completeBusinessOrderPublish(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Complete publish failed')
  }
}

export async function updateBusinessOrderHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await updateBusinessOrderAdminFields(String(ctx.params?.id || ''), (ctx.request.body ?? {}) as Record<string, unknown>)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Update business order failed')
  }
}