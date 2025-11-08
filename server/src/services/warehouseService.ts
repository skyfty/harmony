import { Types } from 'mongoose'
import { OptimizeWarehouseModel } from '@/models/OptimizeWarehouse'
import type { OptimizeProductDocument } from '@/types/models'

interface AddProductOptions {
  userId: string
  product: OptimizeProductDocument
  orderId: Types.ObjectId
}

/**
 * Adds or updates the user's warehouse entry for the given optimize product.
 */
export async function addProductToWarehouse({ userId, product, orderId }: AddProductOptions): Promise<void> {
  const now = new Date()
  const snapshot = {
    name: product.name,
    category: product.category,
    price: product.price,
    imageUrl: product.imageUrl ?? undefined,
    description: product.description ?? undefined,
    usageConfig: product.usageConfig ?? undefined,
  }

  await OptimizeWarehouseModel.findOneAndUpdate(
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
        quantity: 1,
        totalPurchased: 1,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).exec()
}
