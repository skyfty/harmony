import type { Context } from 'koa'
import { OrderModel } from '@/models/Order'
import {
  decryptWechatNotifyResource,
  parseWechatNotifyBody,
  verifyWechatCallbackSignature,
} from '@/services/paymentService'
import { settlePaidOrder } from '@/services/orderSettlementService'

const UNPARSED_BODY = Symbol.for('unparsedBody')

function getRawBody(ctx: Context): string {
  const requestBody = ctx.request.body as any
  const raw = requestBody?.[UNPARSED_BODY]
  if (typeof raw === 'string') {
    return raw
  }
  if (raw instanceof Uint8Array) {
    return new TextDecoder().decode(raw)
  }
  return JSON.stringify(requestBody ?? {})
}

function notifySuccess(ctx: Context): void {
  ctx.status = 200
  ctx.body = {
    code: 'SUCCESS',
    message: '成功',
  }
}

export async function wechatPayNotify(ctx: Context): Promise<void> {
  const miniAppId = ((ctx.params as { miniAppId?: string } | undefined)?.miniAppId ?? '').trim() || undefined
  const rawBody = getRawBody(ctx)
  const headers = ctx.request.headers as Record<string, string | string[] | undefined>

  const verified = await verifyWechatCallbackSignature(rawBody, headers, miniAppId)
  if (!verified) {
    ctx.status = 401
    ctx.body = {
      code: 'FAIL',
      message: '签名验证失败',
    }
    return
  }

  const notifyBody = parseWechatNotifyBody(ctx.request.body)
  const transaction = await decryptWechatNotifyResource(notifyBody.resource, miniAppId)

  const order = await OrderModel.findOne({ orderNumber: transaction.out_trade_no }).exec()
  if (!order) {
    notifySuccess(ctx)
    return
  }

  if (transaction.trade_state === 'SUCCESS') {
    try {
      await settlePaidOrder({
        orderNumber: transaction.out_trade_no,
        source: 'wechat-notify',
        notifyId: notifyBody.id,
        transaction,
      })
    } catch (error) {
      console.error('[wechat-pay] settlement failed, wait notify retry', {
        orderNumber: transaction.out_trade_no,
        transactionId: transaction.transaction_id,
        error,
      })
      ctx.status = 500
      ctx.body = {
        code: 'FAIL',
        message: '结算失败，请重试',
      }
      return
    }
    notifySuccess(ctx)
    return
  }

  order.paymentStatus = 'failed'
  order.paymentProvider = 'wechat'
  order.paymentResult = {
    ...(order.paymentResult ?? {}),
    notifyId: notifyBody.id,
    failed: transaction,
  }
  await order.save()

  notifySuccess(ctx)
}
