import type { Context } from 'koa'
import { Types } from 'mongoose'
import { CouponModel } from '@/models/Coupon'
import { UserCouponModel } from '@/models/UserCoupon'
import { ensureUserId, getOptionalUserId } from '@/controllers/miniprogram/utils'
import { computeUserCouponStatus, objectIdString } from './miniDtoUtils'

type CouponDto = {
  id: string
  title: string
  description: string
  validUntil: string
  type: {
    id: string
    name: string
    code: string
    iconUrl: string
  } | null
  status: 'unused' | 'used' | 'expired'
  claimedAt?: string | null
  usedAt?: string | null
  expiresAt?: string | null
}

type CouponCatalogStatus = 'available' | 'unused' | 'used' | 'expired'

type CouponCatalogDto = {
  id: string
  title: string
  description: string
  validUntil: string
  type: CouponDto['type']
  productId: string | null
  price: number
  status: CouponCatalogStatus
  claimedAt?: string | null
  usedAt?: string | null
  expiresAt?: string | null
  userCouponId?: string | null
  owned?: boolean
}

type CouponSceneGrantPayload = {
  sceneId?: string
  sceneName?: string
  nodeId?: string
  couponJson?: string
  triggeredAt?: string
  source?: string
  metadata?: Record<string, unknown> | null
}

function parseCouponIds(value: unknown): string[] {
  if (typeof value !== 'string') {
    return []
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
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
    type:
      coupon.typeId && typeof coupon.typeId === 'object'
        ? {
            id: objectIdString(coupon.typeId._id),
            name: coupon.typeId.name ?? '',
            code: coupon.typeId.code ?? '',
            iconUrl: coupon.typeId.iconUrl ?? '',
          }
        : null,
    status,
    claimedAt: entry.claimedAt?.toISOString?.() ?? null,
    usedAt: entry.usedAt?.toISOString?.() ?? null,
    expiresAt: expiresAt?.toISOString?.() ?? null,
  }
}

function mapCouponCatalogDto(entry: any, userEntry?: any | null): CouponCatalogDto | null {
  const coupon = entry
  if (!coupon) {
    return null
  }
  const product = coupon.productId
  const userCoupon = userEntry ?? null
  const expiresAt = userCoupon?.expiresAt ?? coupon.validUntil
  const ownedStatus = userCoupon
    ? computeUserCouponStatus({
        status: userCoupon.status,
        expiresAt,
        usedAt: userCoupon.usedAt,
      })
    : null
  const status: CouponCatalogStatus =
    ownedStatus ?? (coupon.validUntil && new Date(coupon.validUntil).getTime() <= Date.now() ? 'expired' : 'available')

  return {
    id: objectIdString(coupon._id),
    title: coupon.title,
    description: coupon.description,
    validUntil: (coupon.validUntil as Date).toISOString().slice(0, 10),
    type:
      coupon.typeId && typeof coupon.typeId === 'object'
        ? {
            id: objectIdString(coupon.typeId._id),
            name: coupon.typeId.name ?? '',
            code: coupon.typeId.code ?? '',
            iconUrl: coupon.typeId.iconUrl ?? '',
          }
        : null,
    productId: product?._id?.toString?.() ?? product?.toString?.() ?? null,
    price: Number(product?.price ?? 0),
    status,
    claimedAt: userCoupon?.claimedAt?.toISOString?.() ?? null,
    usedAt: userCoupon?.usedAt?.toISOString?.() ?? null,
    expiresAt: expiresAt?.toISOString?.() ?? null,
    userCouponId: userCoupon?._id?.toString?.() ?? null,
    owned: Boolean(userCoupon),
  }
}

export async function listCouponCatalog(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const couponIds = parseCouponIds((ctx.query as Record<string, unknown>)?.couponIds)
  const rows = await CouponModel.find({
    ...(couponIds.length
      ? { _id: { $in: couponIds } }
      : {
          isVisible: { $ne: false },
          productId: { $ne: null },
        }),
  })
    .populate('typeId')
    .populate('productId')
    .sort({ createdAt: -1 })
    .lean()
    .exec()

  const catalogCouponIds = rows.map((row: any) => row._id)
  const ownedRows =
    userId && catalogCouponIds.length
      ? await UserCouponModel.find({ userId, couponId: { $in: catalogCouponIds } }).lean().exec()
      : []
  const ownedMap = new Map((ownedRows as any[]).map((row) => [row.couponId.toString(), row]))

  const coupons = (rows as any[]).map((row) => mapCouponCatalogDto(row, ownedMap.get(row._id.toString()))).filter(Boolean)
  ctx.body = {
    total: coupons.length,
    coupons,
  }
}

export async function listUserCoupons(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { status, keyword } = ctx.query as Record<string, string>

  const entries = await UserCouponModel.find({ userId })
    .populate({ path: 'couponId', populate: { path: 'typeId' } })
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

  const entry = await UserCouponModel.findOne({ _id: id, userId })
    .populate({ path: 'couponId', populate: { path: 'typeId' } })
    .lean()
    .exec()
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

  const entry = await UserCouponModel.findOne({ _id: id, userId })
    .populate({ path: 'couponId', populate: { path: 'typeId' } })
    .lean()
    .exec()
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
    .populate({ path: 'couponId', populate: { path: 'typeId' } })
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
    metadata: {
      acquisitionSource: 'miniapp-claim',
    },
  })

  ctx.status = 201
  ctx.body = {
    claimed: true,
    couponId: coupon._id.toString(),
    userCouponId: entry._id.toString(),
    status: 'unused',
  }
}

export async function grantCoupon(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon id')
  }

  const body = (ctx.request.body ?? {}) as CouponSceneGrantPayload
  const coupon = await CouponModel.findById(id).populate('typeId').lean().exec()
  if (!coupon) {
    ctx.throw(404, 'Coupon not found')
    return
  }

  const now = new Date()
  if (coupon.validUntil && coupon.validUntil.getTime() <= now.getTime()) {
    ctx.throw(400, 'Coupon expired')
    return
  }

  const existing = await UserCouponModel.findOne({ userId, couponId: coupon._id }).populate('couponId').lean().exec()
  if (existing) {
    const couponDoc = existing.couponId as any
    const expiresAt = existing.expiresAt ?? couponDoc?.validUntil ?? coupon.validUntil ?? null
    ctx.body = {
      claimed: false,
      couponId: coupon._id.toString(),
      userCouponId: existing._id.toString(),
      status: computeUserCouponStatus({
        status: existing.status,
        expiresAt,
        usedAt: existing.usedAt,
      }),
    }
    return
  }

  const metadata = {
    ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
    source: body.source ?? 'scene-coupon',
    sceneId: typeof body.sceneId === 'string' ? body.sceneId.trim() : '',
    sceneName: typeof body.sceneName === 'string' ? body.sceneName.trim() : '',
    nodeId: typeof body.nodeId === 'string' ? body.nodeId.trim() : '',
    couponJson: typeof body.couponJson === 'string' ? body.couponJson : '',
    triggeredAt: typeof body.triggeredAt === 'string' ? body.triggeredAt : now.toISOString(),
  }

  const created = await UserCouponModel.create({
    userId,
    couponId: coupon._id,
    status: 'unused',
    claimedAt: now,
    expiresAt: coupon.validUntil ?? null,
    metadata,
  })

  ctx.status = 201
  ctx.body = {
    claimed: true,
    couponId: coupon._id.toString(),
    userCouponId: created._id.toString(),
    status: 'unused',
    metadata,
  }
}
