import type { Context } from 'koa'
import { Types } from 'mongoose'
import { CouponModel } from '@/models/Coupon'
import { CouponTypeModel } from '@/models/CouponType'
import { UserCouponModel } from '@/models/UserCoupon'
import { UserModel } from '@/models/User'
import { computeUserCouponStatus } from '@/controllers/miniprogram/miniDtoUtils'

type CouponPayload = {
  typeId?: string
  name?: string
  title?: string
  description?: string
  validUntil?: string | Date
  useConditions?: Record<string, unknown> | null
  usageRules?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

type UserCouponStatus = 'unused' | 'used' | 'expired'

type DistributeSinglePayload = {
  userId?: string
  expiresAt?: string | Date
  metadata?: Record<string, unknown> | null
}

type DistributeBatchPayload = {
  userIds?: string[]
  expiresAt?: string | Date
  metadata?: Record<string, unknown> | null
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function mapCoupon(row: any) {
  const typeValue = row.typeId
  const normalizedType =
    typeValue && typeof typeValue === 'object'
      ? {
          id: typeValue._id?.toString?.() ?? '',
          name: typeValue.name ?? '',
          code: typeValue.code ?? '',
          iconUrl: typeValue.iconUrl ?? '',
          enabled: typeValue.enabled !== false,
        }
      : null

  return {
    id: row._id.toString(),
    typeId: normalizedType?.id ?? row.typeId?.toString?.() ?? '',
    type: normalizedType,
    typeName: normalizedType?.name ?? '',
    name: row.title,
    title: row.title,
    description: row.description,
    validUntil: row.validUntil?.toISOString?.() ?? new Date(row.validUntil).toISOString(),
    useConditions: row.usageRules ?? null,
    usageRules: row.usageRules ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt?.toISOString?.() ?? new Date(row.updatedAt).toISOString(),
  }
}

async function resolveCouponTypeId(typeId: unknown): Promise<Types.ObjectId> {
  if (typeof typeId !== 'string' || !Types.ObjectId.isValid(typeId)) {
    throw new Error('Valid typeId is required')
  }
  const type = await CouponTypeModel.findById(typeId).lean().exec()
  if (!type) {
    throw new Error('Coupon type not found')
  }
  if (type.enabled === false) {
    throw new Error('Coupon type is disabled')
  }
  return new Types.ObjectId(typeId)
}

function normalizeStatus(value: unknown): UserCouponStatus | null {
  if (value === 'unused' || value === 'used' || value === 'expired') {
    return value
  }
  return null
}

function mapUserCoupon(row: any) {
  const coupon = row.couponId
  const user = row.userId
  const expiresAt = row.expiresAt ?? coupon?.validUntil ?? null
  const status = computeUserCouponStatus({
    status: row.status,
    usedAt: row.usedAt,
    expiresAt,
  })
  return {
    id: row._id.toString(),
    userId: user?._id?.toString?.() ?? user?.toString?.() ?? '',
    user: user
      ? {
          id: user?._id?.toString?.() ?? user?.toString?.() ?? '',
          username: user.username ?? null,
          displayName: user.displayName ?? null,
        }
      : null,
    couponId: coupon?._id?.toString?.() ?? coupon?.toString?.() ?? '',
    coupon: coupon
      ? {
          id: coupon?._id?.toString?.() ?? coupon?.toString?.() ?? '',
          title: coupon.title ?? '',
          description: coupon.description ?? '',
          validUntil: coupon.validUntil?.toISOString?.() ?? null,
        }
      : null,
    status,
    claimedAt: row.claimedAt?.toISOString?.() ?? null,
    usedAt: row.usedAt?.toISOString?.() ?? null,
    expiresAt: expiresAt?.toISOString?.() ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

export async function listCoupons(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '10', keyword } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100)
  const skip = (pageNumber - 1) * limit
  const filter: Record<string, unknown> = {}
  if (keyword && keyword.trim()) {
    filter.$or = [{ title: new RegExp(keyword.trim(), 'i') }, { description: new RegExp(keyword.trim(), 'i') }]
  }
  const [rows, total] = await Promise.all([
    CouponModel.find(filter)
      .populate('typeId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    CouponModel.countDocuments(filter),
  ])
  ctx.body = {
    data: rows.map(mapCoupon),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getCoupon(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon id')
  }
  const row = await CouponModel.findById(id).populate('typeId').lean().exec()
  if (!row) {
    ctx.throw(404, 'Coupon not found')
  }
  ctx.body = mapCoupon(row)
}

export async function createCoupon(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as CouponPayload
  const title = toStringValue(body.title) ?? toStringValue(body.name)
  const description = toStringValue(body.description)
  const validUntil = toDateValue(body.validUntil)
  if (!title || !description || !validUntil) {
    ctx.throw(400, 'typeId, name/title, description and validUntil are required')
  }

  let typeId: Types.ObjectId
  try {
    typeId = await resolveCouponTypeId(body.typeId)
  } catch (error) {
    ctx.throw(400, (error as Error).message)
    return
  }

  const created = await CouponModel.create({
    typeId,
    title,
    description,
    validUntil,
    usageRules: body.useConditions ?? body.usageRules ?? null,
    metadata: body.metadata ?? null,
  })
  const row = await CouponModel.findById(created._id).populate('typeId').lean().exec()
  ctx.status = 201
  ctx.body = mapCoupon(row)
}

export async function updateCoupon(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon id')
  }
  const current = await CouponModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Coupon not found')
  }
  const body = (ctx.request.body ?? {}) as CouponPayload

  let nextTypeId = current.typeId
  if (body.typeId !== undefined) {
    try {
      nextTypeId = await resolveCouponTypeId(body.typeId)
    } catch (error) {
      ctx.throw(400, (error as Error).message)
      return
    }
  }

  const updated = await CouponModel.findByIdAndUpdate(
    id,
    {
      typeId: nextTypeId,
      title: toStringValue(body.title) ?? toStringValue(body.name) ?? current.title,
      description: toStringValue(body.description) ?? current.description,
      validUntil: body.validUntil === undefined ? current.validUntil : toDateValue(body.validUntil) ?? current.validUntil,
      usageRules:
        body.useConditions === undefined && body.usageRules === undefined
          ? current.usageRules
          : (body.useConditions ?? body.usageRules),
      metadata: body.metadata === undefined ? current.metadata : body.metadata,
    },
    { new: true },
  )
    .populate('typeId')
    .lean()
    .exec()
  ctx.body = mapCoupon(updated)
}

export async function deleteCoupon(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon id')
  }
  await CouponModel.findByIdAndDelete(id).exec()
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}

export async function listUserCoupons(ctx: Context): Promise<void> {
  const {
    page = '1',
    pageSize = '10',
    keyword,
    status,
    couponId,
    userId,
  } = ctx.query as Record<string, string>

  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100)
  const skip = (pageNumber - 1) * limit

  const filter: Record<string, unknown> = {}
  if (couponId && Types.ObjectId.isValid(couponId)) {
    filter.couponId = new Types.ObjectId(couponId)
  }
  if (userId && Types.ObjectId.isValid(userId)) {
    filter.userId = new Types.ObjectId(userId)
  }

  const keywordText = keyword?.trim()
  if (keywordText) {
    const [couponRows, userRows] = await Promise.all([
      CouponModel.find({
        $or: [{ title: new RegExp(keywordText, 'i') }, { description: new RegExp(keywordText, 'i') }],
      })
        .select({ _id: 1 })
        .lean()
        .exec(),
      UserModel.find({
        $or: [{ username: new RegExp(keywordText, 'i') }, { displayName: new RegExp(keywordText, 'i') }],
      })
        .select({ _id: 1 })
        .lean()
        .exec(),
    ])
    const couponIds = couponRows.map((row: any) => row._id)
    const userIds = userRows.map((row: any) => row._id)
    if (couponIds.length || userIds.length) {
      filter.$or = [
        ...(couponIds.length ? [{ couponId: { $in: couponIds } }] : []),
        ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
      ]
    } else {
      ctx.body = {
        data: [],
        page: pageNumber,
        pageSize: limit,
        total: 0,
      }
      return
    }
  }

  const rows = await UserCouponModel.find(filter)
    .populate('couponId')
    .populate('userId', 'username displayName')
    .sort({ createdAt: -1 })
    .lean()
    .exec()

  const statusFilter = normalizeStatus(status)
  const mapped = (rows as any[]).map(mapUserCoupon)
  const filtered = statusFilter ? mapped.filter((row) => row.status === statusFilter) : mapped
  const total = filtered.length
  const data = filtered.slice(skip, skip + limit)

  ctx.body = {
    data,
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function distributeCouponToUser(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon id')
  }

  const coupon = await CouponModel.findById(id).lean().exec()
  if (!coupon) {
    ctx.throw(404, 'Coupon not found')
  }

  const body = (ctx.request.body ?? {}) as DistributeSinglePayload
  if (!body.userId || !Types.ObjectId.isValid(body.userId)) {
    ctx.throw(400, 'Valid userId is required')
  }

  const user = await UserModel.findById(body.userId).lean().exec()
  if (!user) {
    ctx.throw(404, 'User not found')
  }

  const now = new Date()
  const expiresAt = toDateValue(body.expiresAt) ?? coupon.validUntil
  if (expiresAt.getTime() <= now.getTime()) {
    ctx.throw(400, 'Coupon already expired')
  }

  const existing = await UserCouponModel.findOne({ userId: body.userId, couponId: coupon._id }).lean().exec()
  if (existing) {
    ctx.body = {
      created: false,
      userCouponId: existing._id.toString(),
      status: computeUserCouponStatus({ status: existing.status, usedAt: existing.usedAt, expiresAt: existing.expiresAt ?? expiresAt }),
    }
    return
  }

  const created = await UserCouponModel.create({
    userId: body.userId,
    couponId: coupon._id,
    claimedAt: now,
    expiresAt,
    status: 'unused',
    metadata: body.metadata ?? null,
  })

  ctx.status = 201
  ctx.body = {
    created: true,
    userCouponId: created._id.toString(),
    status: 'unused',
  }
}

export async function distributeCouponBatch(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon id')
  }

  const coupon = await CouponModel.findById(id).lean().exec()
  if (!coupon) {
    ctx.throw(404, 'Coupon not found')
  }

  const body = (ctx.request.body ?? {}) as DistributeBatchPayload
  const rawUserIds = Array.isArray(body.userIds) ? body.userIds : []
  const normalizedIds = Array.from(new Set(rawUserIds.filter((value) => Types.ObjectId.isValid(value))))
  if (!normalizedIds.length) {
    ctx.throw(400, 'userIds is required')
  }

  const now = new Date()
  const expiresAt = toDateValue(body.expiresAt) ?? coupon.validUntil
  if (expiresAt.getTime() <= now.getTime()) {
    ctx.throw(400, 'Coupon already expired')
  }

  const users = await UserModel.find({ _id: { $in: normalizedIds } }).select({ _id: 1 }).lean().exec()
  const validUserIds = users.map((row: any) => row._id.toString())
  const validUserSet = new Set(validUserIds)
  const invalidUserIds = normalizedIds.filter((value) => !validUserSet.has(value))

  if (!validUserIds.length) {
    ctx.body = {
      totalInput: rawUserIds.length,
      validUsers: 0,
      created: 0,
      existing: 0,
      invalidUserIds,
    }
    return
  }

  const existingRows = await UserCouponModel.find({
    couponId: coupon._id,
    userId: { $in: validUserIds },
  })
    .select({ userId: 1 })
    .lean()
    .exec()
  const existingUserSet = new Set(existingRows.map((row: any) => row.userId.toString()))
  const createUserIds = validUserIds.filter((value) => !existingUserSet.has(value))

  if (createUserIds.length) {
    try {
      await UserCouponModel.insertMany(
        createUserIds.map((targetUserId) => ({
          userId: targetUserId,
          couponId: coupon._id,
          claimedAt: now,
          expiresAt,
          status: 'unused',
          metadata: body.metadata ?? null,
        })),
        { ordered: false },
      )
    } catch (error: any) {
      if (error?.code !== 11000) {
        throw error
      }
    }
  }

  ctx.status = 201
  ctx.body = {
    totalInput: rawUserIds.length,
    validUsers: validUserIds.length,
    created: createUserIds.length,
    existing: validUserIds.length - createUserIds.length,
    invalidUserIds,
  }
}

export async function useUserCouponByAdmin(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user coupon id')
  }

  const row = await UserCouponModel.findById(id).populate('couponId').lean().exec()
  if (!row) {
    ctx.throw(404, 'User coupon not found')
  }

  const coupon = row.couponId as any
  const now = new Date()
  const expiresAt = row.expiresAt ?? coupon?.validUntil ?? null
  const status = computeUserCouponStatus({ status: row.status, usedAt: row.usedAt, expiresAt }, now)

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
      usedAt: now,
    },
    { new: true },
  )
    .populate('couponId')
    .populate('userId', 'username displayName')
    .lean()
    .exec()

  ctx.body = mapUserCoupon(updated)
}

export async function getCouponStats(ctx: Context): Promise<void> {
  const { keyword, couponId } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}

  if (couponId && Types.ObjectId.isValid(couponId)) {
    filter.couponId = new Types.ObjectId(couponId)
  }

  const keywordText = keyword?.trim()
  if (keywordText) {
    const couponRows = await CouponModel.find({
      $or: [{ title: new RegExp(keywordText, 'i') }, { description: new RegExp(keywordText, 'i') }],
    })
      .select({ _id: 1 })
      .lean()
      .exec()
    const couponIds = couponRows.map((row: any) => row._id)
    if (!couponIds.length) {
      ctx.body = {
        overview: { total: 0, unused: 0, used: 0, expired: 0 },
        byCoupon: [],
      }
      return
    }
    filter.couponId = { $in: couponIds }
  }

  const now = new Date()
  const aggregate = await UserCouponModel.aggregate([
    { $match: filter },
    {
      $addFields: {
        computedStatus: {
          $cond: [
            { $ne: ['$usedAt', null] },
            'used',
            {
              $cond: [
                {
                  $and: [{ $ne: ['$expiresAt', null] }, { $lte: ['$expiresAt', now] }],
                },
                'expired',
                'unused',
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$couponId',
        total: { $sum: 1 },
        unused: {
          $sum: {
            $cond: [{ $eq: ['$computedStatus', 'unused'] }, 1, 0],
          },
        },
        used: {
          $sum: {
            $cond: [{ $eq: ['$computedStatus', 'used'] }, 1, 0],
          },
        },
        expired: {
          $sum: {
            $cond: [{ $eq: ['$computedStatus', 'expired'] }, 1, 0],
          },
        },
      },
    },
  ]).exec()

  const couponIds = aggregate.map((row: any) => row._id)
  const coupons = await CouponModel.find({ _id: { $in: couponIds } }).select({ _id: 1, title: 1 }).lean().exec()
  const titleMap = new Map(coupons.map((row: any) => [row._id.toString(), row.title]))

  const byCoupon = aggregate.map((row: any) => ({
    couponId: row._id.toString(),
    title: titleMap.get(row._id.toString()) ?? '未知卡券',
    total: row.total ?? 0,
    unused: row.unused ?? 0,
    used: row.used ?? 0,
    expired: row.expired ?? 0,
  }))

  const overview = byCoupon.reduce(
    (acc, row) => {
      acc.total += row.total
      acc.unused += row.unused
      acc.used += row.used
      acc.expired += row.expired
      return acc
    },
    { total: 0, unused: 0, used: 0, expired: 0 },
  )

  ctx.body = {
    overview,
    byCoupon,
  }
}
