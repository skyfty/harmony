import type { Context } from 'koa'
import { Types } from 'mongoose'
import { CouponModel } from '@/models/Coupon'
import { UserCouponModel } from '@/models/UserCoupon'
import { ensureUserId } from '@/controllers/miniprogram/utils'
import { computeUserCouponStatus, objectIdString } from './miniDtoUtils'

type CouponDto = {
  id: string
  title: string
  description: string
  validUntil: string
  status: 'unused' | 'used' | 'expired'
}

export async function listUserCoupons(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)

  const entries = await UserCouponModel.find({ userId })
    .populate('couponId')
    .sort({ createdAt: -1 })
    .lean()
    .exec()

  const coupons: CouponDto[] = []
  for (const entry of entries as any[]) {
    const coupon = entry.couponId
    if (!coupon) {
      continue
    }
    const status = computeUserCouponStatus({
      status: entry.status,
      expiresAt: entry.expiresAt ?? coupon.validUntil,
      usedAt: entry.usedAt,
    })

    coupons.push({
      id: objectIdString(entry._id),
      title: coupon.title,
      description: coupon.description,
      validUntil: (coupon.validUntil as Date).toISOString().slice(0, 10),
      status,
    })
  }

  ctx.body = {
    total: coupons.length,
    coupons,
  }
}

export async function claimCoupon(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon id')
  }

  const coupon = await CouponModel.findById(id).exec()
  if (!coupon) {
    ctx.throw(404, 'Coupon not found')
    return
  }

  const now = new Date()
  if (coupon.validUntil.getTime() <= now.getTime()) {
    ctx.throw(400, 'Coupon expired')
  }

  const existing = await UserCouponModel.findOne({ userId, couponId: coupon._id }).exec()
  if (existing) {
    ctx.body = {
      claimed: false,
      couponId: coupon._id.toString(),
      userCouponId: existing._id.toString(),
      status: computeUserCouponStatus({
        status: existing.status,
        expiresAt: existing.expiresAt ?? coupon.validUntil,
        usedAt: existing.usedAt,
      }),
    }
    return
  }

  const entry = await UserCouponModel.create({
    userId,
    couponId: coupon._id,
    status: 'unused',
    claimedAt: now,
    expiresAt: coupon.validUntil,
  })

  ctx.status = 201
  ctx.body = {
    claimed: true,
    couponId: coupon._id.toString(),
    userCouponId: entry._id.toString(),
    status: 'unused',
  }
}
