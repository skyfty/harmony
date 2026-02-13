import type { Context } from 'koa'
import { Types } from 'mongoose'
import { CouponModel } from '@/models/Coupon'

type CouponPayload = {
  name?: string
  title?: string
  description?: string
  validUntil?: string | Date
  useConditions?: Record<string, unknown> | null
  usageRules?: Record<string, unknown> | null
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
  return {
    id: row._id.toString(),
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
    CouponModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
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
  const row = await CouponModel.findById(id).lean().exec()
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
    ctx.throw(400, 'name/title, description and validUntil are required')
  }
  const created = await CouponModel.create({
    title,
    description,
    validUntil,
    usageRules: body.useConditions ?? body.usageRules ?? null,
    metadata: body.metadata ?? null,
  })
  const row = await CouponModel.findById(created._id).lean().exec()
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
  const updated = await CouponModel.findByIdAndUpdate(
    id,
    {
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
