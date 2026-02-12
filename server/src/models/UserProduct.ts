import { Schema, model } from 'mongoose'
import type { UserProductDocument } from '@/types/models'

const userProductSchema = new Schema<UserProductDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    state: { type: String, enum: ['locked', 'unused', 'used', 'expired'], default: 'unused' },
    acquiredAt: { type: Date, default: Date.now },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

userProductSchema.index({ userId: 1, productId: 1 }, { unique: true })
userProductSchema.index({ userId: 1, state: 1, expiresAt: 1 })

export const UserProductModel = model<UserProductDocument>('UserProduct', userProductSchema)
