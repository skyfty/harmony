import { Schema, model } from 'mongoose'
import type { UserCouponDocument } from '@/types/models'

const userCouponSchema = new Schema<UserCouponDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    status: { type: String, enum: ['unused', 'used', 'expired'], default: 'unused' },
    claimedAt: { type: Date, default: Date.now },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

userCouponSchema.index({ userId: 1, couponId: 1 }, { unique: true })
userCouponSchema.index({ userId: 1, status: 1, expiresAt: 1 })

export const UserCouponModel = model<UserCouponDocument>('UserCoupon', userCouponSchema)
