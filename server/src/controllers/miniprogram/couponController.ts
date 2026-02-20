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
  claimedAt?: string | null
  usedAt?: string | null
  expiresAt?: string | null
}

function mapUserCouponDto(entry: any): CouponDto | null {
  const coupon = entry.couponId
  if (!coupon) {
    return null
  }
  const expiresAt = entry.expiresAt ?? coupon.validUntil
  const status = computeUserCouponStatus({
    status: entry.status,
    expiresAt,
    usedAt: entry.usedAt,
  })

  return {
    id: objectIdString(entry._id),
    title: coupon.title,
    description: coupon.description,
    validUntil: (coupon.validUntil as Date).toISOString().slice(0, 10),
    status,
    claimedAt: entry.claimedAt?.toISOString?.() ?? null,
    usedAt: entry.usedAt?.toISOString?.() ?? null,
    expiresAt: expiresAt?.toISOString?.() ?? null,
  }
}

export async function listUserCoupons(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { status, keyword } = ctx.query as Record<string, string>

  const entries = await UserCouponModel.find({ userId })
    .populate('couponId')
    .sort({ createdAt: -1 })
    .lean()
    .exec()

  let coupons = (entries as any[]).map(mapUserCouponDto).filter(Boolean) as CouponDto[]
  if (status === 'unused' || status === 'used' || status === 'expired') {
    coupons = coupons.filter((item) => item.status === status)
  }
  const keywordText = keyword?.trim()
  if (keywordText) {
    coupons = coupons.filter((item) => item.title.includes(keywordText) || item.description.includes(keywordText))
  }

  ctx.body = {
    total: coupons.length,
    coupons,
  }
}

export async function getUserCouponDetail(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user coupon id')
  }

  const entry = await UserCouponModel.findOne({ _id: id, userId }).populate('couponId').lean().exec()
  if (!entry) {
    ctx.throw(404, 'Coupon not found')
  }

  const dto = mapUserCouponDto(entry as any)
  if (!dto) {
    ctx.throw(404, 'Coupon not found')
  }
  ctx.body = dto
}

export async function useUserCoupon(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user coupon id')
  }

  const entry = await UserCouponModel.findOne({ _id: id, userId }).populate('couponId').lean().exec()
  if (!entry) {
    ctx.throw(404, 'Coupon not found')
  }

  const coupon = (entry as any).couponId
  const expiresAt = (entry as any).expiresAt ?? coupon?.validUntil ?? null
  const status = computeUserCouponStatus(
    {
      status: (entry as any).status,
      expiresAt,
      usedAt: (entry as any).usedAt,
    },
    new Date(),
  )

  if (status === 'used') {
    ctx.throw(400, 'Coupon already used')
  }

  if (status === 'expired') {
    await UserCouponModel.findByIdAndUpdate(id, { status: 'expired' }).exec()
    ctx.throw(400, 'Coupon expired')
  }

  const updated = await UserCouponModel.findByIdAndUpdate(
    id,
    {
      status: 'used',
      usedAt: new Date(),
    },
    { new: true },
  )
    .populate('couponId')
    .lean()
    .exec()

  const dto = mapUserCouponDto(updated as any)
  if (!dto) {
    ctx.throw(404, 'Coupon not found')
  }
  ctx.body = dto
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
