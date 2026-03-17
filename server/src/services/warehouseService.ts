import { Types } from 'mongoose'
import { WarehouseModel } from '@/models/Warehouse'
import type { ProductDocument } from '@/types/models'

interface AddProductOptions {
  userId: string
  product: ProductDocument
  orderId: Types.ObjectId
  quantity?: number
}

interface RemoveProductOptions {
  userId: string
  productId: Types.ObjectId
  quantity?: number
}

/**
 * Adds or updates the user's warehouse entry for the given optimize product.
 */
export async function addProductToWarehouse({ userId, product, orderId, quantity = 1 }: AddProductOptions): Promise<void> {
  const now = new Date()
  const safeQuantity = Math.max(1, Math.floor(quantity))
  const snapshot = {
    name: product.name,
    price: product.price,
    coverUrl: product.coverUrl ?? undefined,
    description: product.description ?? undefined,
    usageConfig: product.usageConfig ?? undefined,
  }

  await WarehouseModel.findOneAndUpdate(
    {
      userId: new Types.ObjectId(userId),
      productId: product._id,
    },
    {
      $set: {
        productSnapshot: snapshot,
        latestOrderId: orderId,
        lastPurchasedAt: now,
      },
      $inc: {
        quantity: safeQuantity,
        totalPurchased: safeQuantity,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).exec()
}

export async function removeProductFromWarehouse({ userId, productId, quantity = 1 }: RemoveProductOptions): Promise<void> {
  const safeQuantity = Math.max(1, Math.floor(quantity))
  const row = await WarehouseModel.findOne({
    userId: new Types.ObjectId(userId),
    productId,
  }).exec()
  if (!row) {
    return
  }

  row.quantity = Math.max(0, row.quantity - safeQuantity)
  row.totalPurchased = Math.max(row.totalConsumed, row.totalPurchased - safeQuantity)
  row.updatedAt = new Date()
  await row.save()
}
