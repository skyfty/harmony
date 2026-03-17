import { startSession } from 'mongoose'
import type { ClientSession } from 'mongoose'
import { OrderModel } from '@/models/Order'
import { ProductModel } from '@/models/Product'
import { UserProductModel } from '@/models/UserProduct'
import { VehicleModel } from '@/models/Vehicle'
import { UserVehicleModel } from '@/models/UserVehicle'
import { addProductToWarehouse } from '@/services/warehouseService'
import { queryWechatOrderByOutTradeNo } from '@/services/paymentService'
import type { WechatTransaction } from '@/services/paymentService'

type SettlementSource = 'wechat-notify' | 'order-list-sync' | 'order-detail-sync'

interface SettlePaidOrderOptions {
	orderNumber: string
	source: SettlementSource
	transaction: WechatTransaction
	notifyId?: string
}

interface SyncOrderOptions {
	orderNumber: string
	source: Extract<SettlementSource, 'order-list-sync' | 'order-detail-sync'>
	miniAppId?: string
}

interface SyncOrderResult {
	orderFound: boolean
	changed: boolean
}

let transactionCapability: 'unknown' | 'supported' | 'unsupported' = 'unknown'
let transactionFallbackLogged = false

function isTransactionUnsupportedError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false
	}
	const maybeCode = (error as { code?: unknown }).code
	const maybeName = (error as { codeName?: unknown }).codeName
	const maybeMessage = (error as { message?: unknown }).message
	return (
		maybeCode === 20 ||
		maybeName === 'IllegalOperation' ||
		(typeof maybeMessage === 'string' &&
			maybeMessage.includes('Transaction numbers are only allowed on a replica set member or mongos'))
	)
}

function normalizeQuantity(quantity: unknown): number {
	return Math.max(1, Math.floor(Number(quantity) || 1))
}

function mergeOrderPaymentResult(
	original: Record<string, unknown> | null | undefined,
	input: {
		source: SettlementSource
		notifyId?: string
		success?: WechatTransaction
		wechatQuery?: WechatTransaction
	},
): Record<string, unknown> {
	return {
		...(original ?? {}),
		...(input.notifyId ? { notifyId: input.notifyId } : {}),
		...(input.success ? { success: input.success } : {}),
		...(input.wechatQuery ? { wechatQuery: input.wechatQuery } : {}),
		settlement: {
			source: input.source,
			at: new Date().toISOString(),
		},
	}
}

async function fulfillOrder(order: any, session?: ClientSession): Promise<void> {
	const now = new Date()
	for (const item of order.items ?? []) {
		if (!item?.productId) {
			continue
		}
		const quantity = normalizeQuantity(item.quantity)
		const productQuery = ProductModel.findById(item.productId)
		if (session) {
			productQuery.session(session)
		}
		const product = await productQuery.exec()
		if (!product) {
			console.warn('[order-settlement] product not found, skip item fulfillment', {
				orderNumber: order.orderNumber,
				productId: String(item.productId),
			})
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
			{ upsert: true, session },
		).exec()

		const boundVehicleQuery = VehicleModel.findOne({ productId: product._id }).select({ _id: 1 })
		if (session) {
			boundVehicleQuery.session(session)
		}
		const boundVehicle = await boundVehicleQuery.lean().exec()
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
				{ upsert: true, session },
			).exec()
		}

		await addProductToWarehouse({
			userId: order.userId.toString(),
			product: product.toObject() as any,
			orderId: order._id,
			quantity,
			session,
		})
	}
}

export async function settlePaidOrder(options: SettlePaidOrderOptions): Promise<SyncOrderResult> {
	const safeOrderNumber = options.orderNumber.trim()
	if (!safeOrderNumber) {
		return { orderFound: false, changed: false }
	}

	const session = await startSession()
	try {
		let result: SyncOrderResult = { orderFound: false, changed: false }

		const settleCore = async (activeSession?: ClientSession): Promise<void> => {
			const orderQuery = OrderModel.findOne({ orderNumber: safeOrderNumber })
			if (activeSession) {
				orderQuery.session(activeSession)
			}
			const order = await orderQuery.exec()
			if (!order) {
				result = { orderFound: false, changed: false }
				return
			}

			result.orderFound = true
			if (options.transaction.trade_state !== 'SUCCESS') {
				return
			}

			const alreadyPaid = order.paymentStatus === 'succeeded' && (order.orderStatus ?? order.status) === 'paid'
			const alreadyFulfilled = order.fulfillmentStatus === 'fulfilled'
			if (alreadyPaid && alreadyFulfilled) {
				return
			}

			order.status = 'paid'
			order.orderStatus = 'paid'
			order.paymentStatus = 'succeeded'
			order.transactionId = options.transaction.transaction_id ?? order.transactionId
			order.paidAt = options.transaction.success_time ? new Date(options.transaction.success_time) : order.paidAt ?? new Date()
			order.paymentProvider = 'wechat'
			order.paymentMethod = order.paymentMethod || 'wechat'

			await fulfillOrder(order, activeSession)

			order.fulfillmentStatus = 'fulfilled'
			order.fulfilledAt = new Date()
			order.paymentResult = mergeOrderPaymentResult(order.paymentResult, {
				source: options.source,
				notifyId: options.notifyId,
				success: options.transaction,
			})

			if (activeSession) {
				await order.save({ session: activeSession })
			} else {
				await order.save()
			}
			result.changed = true
		}

		if (transactionCapability === 'unsupported') {
			await settleCore()
			return result
		}

		try {
			await session.withTransaction(async () => {
				await settleCore(session)
			})
			transactionCapability = 'supported'
		} catch (error) {
			if (!isTransactionUnsupportedError(error)) {
				throw error
			}
			transactionCapability = 'unsupported'
			if (!transactionFallbackLogged) {
				console.warn('[order-settlement] transaction unavailable, fallback to non-transaction settlement', {
					orderNumber: safeOrderNumber,
					source: options.source,
				})
				transactionFallbackLogged = true
			}
			await settleCore()
		}

		return result
	} finally {
		await session.endSession()
	}
}

function shouldActiveSyncOrder(order: {
	paymentStatus?: string
	fulfillmentStatus?: string
	orderStatus?: string
	status?: string
}): boolean {
	if (order.fulfillmentStatus !== 'fulfilled' && order.paymentStatus === 'succeeded') {
		return true
	}
	if (order.paymentStatus === 'unpaid' || order.paymentStatus === 'processing') {
		return true
	}
	const orderStatus = order.orderStatus ?? order.status
	return orderStatus === 'pending'
}

export async function syncOrderWithWechat(options: SyncOrderOptions): Promise<SyncOrderResult> {
	const safeOrderNumber = options.orderNumber.trim()
	if (!safeOrderNumber) {
		return { orderFound: false, changed: false }
	}

	const order = await OrderModel.findOne({ orderNumber: safeOrderNumber })
		.select({ orderNumber: 1, paymentStatus: 1, fulfillmentStatus: 1, orderStatus: 1, status: 1, paymentResult: 1 })
		.lean()
		.exec()
	if (!order) {
		return { orderFound: false, changed: false }
	}
	if (!shouldActiveSyncOrder(order as any)) {
		return { orderFound: true, changed: false }
	}

	const transaction = await queryWechatOrderByOutTradeNo(safeOrderNumber, options.miniAppId)
	if (transaction.trade_state === 'SUCCESS') {
		return settlePaidOrder({
			orderNumber: safeOrderNumber,
			source: options.source,
			transaction,
		})
	}

	const update: Record<string, unknown> = {
		paymentProvider: 'wechat',
		paymentResult: mergeOrderPaymentResult((order as any).paymentResult, {
			source: options.source,
			wechatQuery: transaction,
		}),
	}
	if (transaction.trade_state === 'PAYERROR' || transaction.trade_state === 'CLOSED') {
		update.paymentStatus = 'failed'
	} else if (transaction.trade_state === 'REFUND') {
		update.paymentStatus = 'refunded'
	} else if (transaction.trade_state === 'USERPAYING' || transaction.trade_state === 'NOTPAY') {
		update.paymentStatus = 'processing'
	}

	const updated = await OrderModel.updateOne({ orderNumber: safeOrderNumber }, { $set: update }).exec()
	return {
		orderFound: true,
		changed: Boolean(updated.modifiedCount),
	}
}
