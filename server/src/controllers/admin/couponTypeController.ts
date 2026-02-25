import type { Context } from 'koa'
import { Types } from 'mongoose'
import { CouponTypeModel } from '@/models/CouponType'
import { CouponModel } from '@/models/Coupon'

type CouponTypePayload = {
  name?: string
  code?: string
  iconUrl?: string
  sort?: number
  enabled?: boolean
}

const BUILTIN_COUPON_TYPES = [
  { name: '门票', code: 'ticket', iconUrl: '', sort: 10, enabled: true },
  { name: '纪念品', code: 'souvenir', iconUrl: '', sort: 20, enabled: true },
  { name: '拍照', code: 'photo', iconUrl: '', sort: 30, enabled: true },
  { name: '减免', code: 'discount', iconUrl: '', sort: 40, enabled: true },
] as const

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toCodeValue(value: unknown): string | null {
  const text = toStringValue(value)
  if (!text) {
    return null
  }
  return text.toLowerCase()
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return null
}

function mapCouponType(row: any) {
  if (!row) {
    return null
  }
  return {
    id: row._id.toString(),
    name: row.name,
    code: row.code,
    iconUrl: row.iconUrl ?? '',
    sort: typeof row.sort === 'number' ? row.sort : 0,
    enabled: row.enabled !== false,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

export async function ensureBuiltinCouponTypes(): Promise<void> {
  const existing = await CouponTypeModel.find({ code: { $in: BUILTIN_COUPON_TYPES.map((item) => item.code) } })
    .select({ code: 1 })
    .lean()
    .exec()
  const existingCodes = new Set(existing.map((item: any) => item.code))
  const toCreate = BUILTIN_COUPON_TYPES.filter((item) => !existingCodes.has(item.code))
  if (!toCreate.length) {
    return
  }
  await CouponTypeModel.insertMany(toCreate, { ordered: false }).catch((error: any) => {
    if (error?.code !== 11000) {
      throw error
    }
  })
}

export async function listCouponTypes(ctx: Context): Promise<void> {
  await ensureBuiltinCouponTypes()
  const { keyword } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}
  if (keyword?.trim()) {
    const regex = new RegExp(keyword.trim(), 'i')
    filter.$or = [{ name: regex }, { code: regex }]
  }
  const rows = await CouponTypeModel.find(filter).sort({ sort: 1, createdAt: -1 }).lean().exec()
  ctx.body = rows.map(mapCouponType)
}

export async function createCouponType(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as CouponTypePayload
  const name = toStringValue(body.name)
  const code = toCodeValue(body.code)
  if (!name || !code) {
    ctx.throw(400, 'name and code are required')
  }

  try {
    const created = await CouponTypeModel.create({
      name,
      code,
      iconUrl: toStringValue(body.iconUrl) ?? '',
      sort: toNumberValue(body.sort) ?? 0,
      enabled: toBooleanValue(body.enabled) ?? true,
    })

    const row = await CouponTypeModel.findById(created._id).lean().exec()
    ctx.status = 201
    ctx.body = mapCouponType(row)
  } catch (error) {
    const codeValue = (error as { code?: number }).code
    if (codeValue === 11000) {
      ctx.throw(409, 'Coupon type code already exists')
    }
    ctx.throw(400, (error as { message?: string }).message ?? 'Invalid coupon type payload')
  }
}

export async function updateCouponType(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon type id')
  }

  const current = await CouponTypeModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Coupon type not found')
  }

  const body = (ctx.request.body ?? {}) as CouponTypePayload
  try {
    const updated = await CouponTypeModel.findByIdAndUpdate(
      id,
      {
        name: toStringValue(body.name) ?? current.name,
        code: toCodeValue(body.code) ?? current.code,
        iconUrl: body.iconUrl === undefined ? current.iconUrl ?? '' : (toStringValue(body.iconUrl) ?? ''),
        sort: body.sort === undefined ? current.sort ?? 0 : (toNumberValue(body.sort) ?? current.sort ?? 0),
        enabled:
          body.enabled === undefined ? current.enabled !== false : (toBooleanValue(body.enabled) ?? (current.enabled !== false)),
      },
      { new: true },
    )
      .lean()
      .exec()

    ctx.body = mapCouponType(updated)
  } catch (error) {
    const codeValue = (error as { code?: number }).code
    if (codeValue === 11000) {
      ctx.throw(409, 'Coupon type code already exists')
    }
    ctx.throw(400, (error as { message?: string }).message ?? 'Invalid coupon type payload')
  }
}

export async function deleteCouponType(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid coupon type id')
  }

  const usageCount = await CouponModel.countDocuments({ typeId: new Types.ObjectId(id) })
  if (usageCount > 0) {
    ctx.throw(400, 'Coupon type is in use and cannot be deleted')
  }

  const deleted = await CouponTypeModel.findByIdAndDelete(id).lean().exec()
  if (!deleted) {
    ctx.throw(404, 'Coupon type not found')
  }
  ctx.status = 200
  ctx.body = {}
}
