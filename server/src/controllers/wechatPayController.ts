import type { Context } from 'koa'
import { OrderModel } from '@/models/Order'
import { ProductModel } from '@/models/Product'
import { VehicleModel } from '@/models/Vehicle'
import { UserProductModel } from '@/models/UserProduct'
import { UserVehicleModel } from '@/models/UserVehicle'
import {
  decryptWechatNotifyResource,
  parseWechatNotifyBody,
  verifyWechatCallbackSignature,
  type WechatRefundTransaction,
} from '@/services/paymentService'
import { addProductToWarehouse, removeProductFromWarehouse } from '@/services/warehouseService'
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

async function fulfillPaidOrder(order: any): Promise<void> {
  const now = new Date()
  for (const item of order.items ?? []) {
    if (!item?.productId) {
      continue
    }
    const product = await ProductModel.findById(item.productId).exec()
    if (!product) {
      continue
    }
    const expiresAt = product.validityDays ? new Date(now.getTime() + product.validityDays * 86400000) : null
    await UserProductModel.updateOne(
      { userId: order.userId, productId: product._id },
      {
        $setOnInsert: {
          userId: order.userId,
          productId: product._id,
        },
        $set: {
          state: 'unused',
          usedAt: null,
          expiresAt,
          orderId: order._id,
          metadata: order.metadata ?? null,
          acquiredAt: now,
        },
      },
      { upsert: true },
    ).exec()

    const boundVehicle = await VehicleModel.findOne({ productId: product._id }).select({ _id: 1 }).lean().exec()
    if (boundVehicle?._id) {
      await UserVehicleModel.updateOne(
        { userId: order.userId, vehicleId: boundVehicle._id },
        {
          $setOnInsert: {
            userId: order.userId,
            vehicleId: boundVehicle._id,
            ownedAt: now,
          },
        },
        { upsert: true },
      ).exec()
    }

    await addProductToWarehouse({
      userId: order.userId.toString(),
      product: product.toObject() as any,
      orderId: order._id,
      quantity: Math.max(1, Number(item.quantity ?? 1)),
    })
  }
}

async function revokeRefundedOrderBenefits(order: any): Promise<void> {
  for (const item of order.items ?? []) {
    if (!item?.productId) {
      continue
    }

    const product = await ProductModel.findById(item.productId).exec()
    if (!product) {
      continue
    }

    await UserProductModel.deleteOne({
      userId: order.userId,
      productId: product._id,
      orderId: order._id,
    }).exec()

    const boundVehicle = await VehicleModel.findOne({ productId: product._id }).select({ _id: 1 }).lean().exec()
    if (boundVehicle?._id) {
      await UserVehicleModel.deleteOne({
        userId: order.userId,
        vehicleId: boundVehicle._id,
      }).exec()
    }

    await removeProductFromWarehouse({
      userId: order.userId.toString(),
      productId: product._id,
      quantity: Math.max(1, Number(item.quantity ?? 1)),
    })
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

export async function wechatRefundNotify(ctx: Context): Promise<void> {
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
  const refund = (await decryptWechatNotifyResource(notifyBody.resource, miniAppId)) as unknown as WechatRefundTransaction
  const filter: Record<string, unknown> = {}
  if (typeof refund.out_refund_no === 'string' && refund.out_refund_no) {
    filter.refundRequestNo = refund.out_refund_no
  } else if (typeof refund.out_trade_no === 'string' && refund.out_trade_no) {
    filter.orderNumber = refund.out_trade_no
  }

  const order = Object.keys(filter).length ? await OrderModel.findOne(filter).exec() : null
  if (!order) {
    notifySuccess(ctx)
    return
  }

  const previousRefundStatus = order.refundStatus
  order.paymentProvider = 'wechat'
  order.refundId = refund.refund_id || order.refundId
  order.refundRequestNo = refund.out_refund_no || order.refundRequestNo
  order.refundResult = {
    ...(order.refundResult ?? {}),
    notifyId: notifyBody.id,
    notify: refund,
  }

  if (refund.refund_status === 'SUCCESS') {
    order.refundStatus = 'succeeded'
    order.paymentStatus = 'refunded'
    order.refundedAt = refund.success_time ? new Date(refund.success_time) : new Date()
    await order.save()
    if (previousRefundStatus !== 'succeeded') {
      await revokeRefundedOrderBenefits(order)
    }
    notifySuccess(ctx)
    return
  }

  if (refund.refund_status === 'PROCESSING') {
    order.refundStatus = 'processing'
    await order.save()
    notifySuccess(ctx)
    return
  }

  order.refundStatus = 'failed'
  await order.save()
  notifySuccess(ctx)
}
