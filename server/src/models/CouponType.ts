import { Schema, model } from 'mongoose'
import type { CouponTypeDocument } from '@/types/models'

const couponTypeSchema = new Schema<CouponTypeDocument>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true },
    iconUrl: { type: String, default: '' },
    sort: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

couponTypeSchema.index({ code: 1 }, { unique: true })
couponTypeSchema.index({ sort: 1, createdAt: -1 })

export const CouponTypeModel = model<CouponTypeDocument>('CouponType', couponTypeSchema)
