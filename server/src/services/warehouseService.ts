import { Types } from 'mongoose'
import type { ClientSession } from 'mongoose'
import { WarehouseModel } from '@/models/Warehouse'
import type { ProductDocument } from '@/types/models'

interface AddProductOptions {
  userId: string
  product: ProductDocument
  orderId: Types.ObjectId
  quantity?: number
  session?: ClientSession
}

/**
 * Adds or updates the user's warehouse entry for the given optimize product.
 */
export async function addProductToWarehouse({ userId, product, orderId, quantity = 1, session }: AddProductOptions): Promise<void> {
  const now = new Date()
  const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 1))
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
      ...(session ? { session } : {}),
    },
  ).exec()
}
