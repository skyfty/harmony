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
} from '@/services/paymentService'
import { addProductToWarehouse } from '@/services/warehouseService'

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
    if (order.paymentStatus !== 'succeeded') {
      order.status = 'paid'
      order.orderStatus = 'paid'
      order.paymentStatus = 'succeeded'
      order.transactionId = transaction.transaction_id
      order.paidAt = transaction.success_time ? new Date(transaction.success_time) : new Date()
      order.paymentProvider = 'wechat'
      order.paymentMethod = order.paymentMethod || 'wechat'
      order.paymentResult = {
        ...(order.paymentResult ?? {}),
        notifyId: notifyBody.id,
        success: transaction,
      }
      await order.save()
      await fulfillPaidOrder(order)
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
