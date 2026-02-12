import { Schema, model } from 'mongoose'
import type { CouponDocument } from '@/types/models'

const couponSchema = new Schema<CouponDocument>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    validUntil: { type: Date, required: true },
    usageRules: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

couponSchema.index({ validUntil: 1 })

export const CouponModel = model<CouponDocument>('Coupon', couponSchema)
