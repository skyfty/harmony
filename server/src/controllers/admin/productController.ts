import type { Context } from 'koa'
import { ProductModel } from '@/models/Product'
import { ProductCategoryModel } from '@/models/ProductCategory'
import { VehicleModel } from '@/models/Vehicle'
import { Types } from 'mongoose'

type ProductPayload = {
  name?: string
  slug?: string
  categoryId?: string | null
  validityDays?: number | null
  applicableSceneTags?: string[]
  description?: string | null
  coverUrl?: string | null
  price?: number
  metadata?: Record<string, unknown> | null
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toNumberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0)
}

function mapProduct(row: any) {
  return {
    id: row._id.toString(),
    name: row.name,
    slug: row.slug,
    categoryId: row.categoryId?.toString?.() ?? null,
    coverUrl: row.coverUrl ?? null,
    validityDays: row.validityDays ?? null,
    applicableSceneTags: Array.isArray(row.applicableSceneTags) ? row.applicableSceneTags : [],
    description: row.description ?? null,
    price: row.price,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt?.toISOString?.() ?? new Date(row.updatedAt).toISOString(),
  }
}

async function resolveCategoryPayload(payload: ProductPayload, fallback: { categoryId?: any | null }) {
  const categoryIdText = toStringValue(payload.categoryId)
  if (categoryIdText) {
    if (!Types.ObjectId.isValid(categoryIdText)) {
      throw new Error('Invalid category id')
    }
    const categoryRow = await ProductCategoryModel.findById(categoryIdText).lean().exec()
    if (!categoryRow || categoryRow.enabled === false) {
      throw new Error('Category not found or disabled')
    }
    return {
      categoryId: categoryRow._id,
    }
  }

  return {
    categoryId: fallback.categoryId ?? null,
  }
}

export async function listProducts(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '10', keyword, categoryId } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100)
  const skip = (pageNumber - 1) * limit
  const filter: Record<string, unknown> = { isDeleted: { $ne: true } }
  if (keyword && keyword.trim()) {
    filter.$or = [{ name: new RegExp(keyword.trim(), 'i') }, { slug: new RegExp(keyword.trim(), 'i') }]
  }
  if (categoryId && Types.ObjectId.isValid(categoryId)) {
    filter.categoryId = new Types.ObjectId(categoryId)
  }
  const [rows, total] = await Promise.all([
    ProductModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    ProductModel.countDocuments(filter),
  ])
  ctx.body = {
    data: rows.map(mapProduct),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getProduct(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid product id')
  }
  const row = await ProductModel.findOne({ _id: id, isDeleted: { $ne: true } }).lean().exec()
  if (!row) {
    ctx.throw(404, 'Product not found')
  }
  ctx.body = mapProduct(row)
}

export async function createProduct(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as ProductPayload
  const name = toStringValue(body.name)
  const slug = toStringValue(body.slug)?.toLowerCase()
  let categoryPayload: { categoryId: Types.ObjectId | null }
  try {
    categoryPayload = await resolveCategoryPayload(body, {})
  } catch (error) {
    ctx.throw(400, (error as Error).message)
    return
  }
  const validityDays = body.validityDays === null || body.validityDays === undefined ? null : toNumberValue(body.validityDays)
  const price = toNumberValue(body.price) ?? 0
  if (!name || !slug || !categoryPayload.categoryId) {
    ctx.throw(400, 'name, slug and categoryId are required')
  }
  if (validityDays !== null && validityDays < 1) {
    ctx.throw(400, 'validityDays must be greater than 0')
  }
  if (price < 0) {
    ctx.throw(400, 'price must be greater than or equal to 0')
  }
  const exists = await ProductModel.findOne({ slug }).lean().exec()
  if (exists) {
    ctx.throw(409, 'slug already exists')
  }
  const created = await ProductModel.create({
    name,
    slug,
    categoryId: categoryPayload.categoryId,
    validityDays,
    applicableSceneTags: toStringArray(body.applicableSceneTags),
    description: toStringValue(body.description) ?? '',
    coverUrl: toStringValue(body.coverUrl) ?? undefined,
    price,
    metadata: body.metadata ?? null,
  })
  const row = await ProductModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapProduct(row)
}

export async function updateProduct(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid product id')
  }
  const current = await ProductModel.findOne({ _id: id, isDeleted: { $ne: true } }).lean().exec()
  if (!current) {
    ctx.throw(404, 'Product not found')
  }
  const body = (ctx.request.body ?? {}) as ProductPayload
  const nextName = toStringValue(body.name) ?? current.name
  const nextSlug = toStringValue(body.slug)?.toLowerCase() ?? current.slug
  let nextCategory: { categoryId: Types.ObjectId | null }
  try {
    nextCategory = await resolveCategoryPayload(body, {
      categoryId: current.categoryId ?? null,
    })
  } catch (error) {
    ctx.throw(400, (error as Error).message)
    return
  }
  const nextValidityDays =
    body.validityDays === undefined
      ? current.validityDays ?? null
      : body.validityDays === null
        ? null
        : toNumberValue(body.validityDays)
  const nextPrice = body.price === undefined ? current.price : toNumberValue(body.price)
  if (nextValidityDays !== null && (nextValidityDays === null || nextValidityDays < 1)) {
    ctx.throw(400, 'validityDays must be greater than 0')
  }
  if (nextPrice === null || nextPrice < 0) {
    ctx.throw(400, 'price must be greater than or equal to 0')
  }
  if (nextSlug !== current.slug) {
    const exists = await ProductModel.findOne({ slug: nextSlug, _id: { $ne: id } }).lean().exec()
    if (exists) {
      ctx.throw(409, 'slug already exists')
    }
  }
  const updated = await ProductModel.findByIdAndUpdate(
    id,
    {
      name: nextName,
      slug: nextSlug,
      categoryId: nextCategory.categoryId ?? null,
      validityDays: nextValidityDays,
      applicableSceneTags:
        body.applicableSceneTags === undefined ? current.applicableSceneTags : toStringArray(body.applicableSceneTags),
      description: body.description === undefined ? current.description : toStringValue(body.description) ?? '',
      coverUrl: body.coverUrl === undefined ? current.coverUrl : (toStringValue(body.coverUrl) ?? ''),
      price: nextPrice,
      metadata: body.metadata === undefined ? current.metadata : body.metadata,
    },
    { new: true },
  )
    .lean()
    .exec()
  ctx.body = mapProduct(updated)
}

export async function deleteProduct(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid product id')
  }
  const vehicle = await VehicleModel.findOne({ productId: id }).select({ _id: 1, name: 1 }).lean().exec()
  if (vehicle) {
    ctx.throw(409, `该商品已关联车辆“${vehicle.name ?? '未知'}”，请先删除车辆`)
  }
  await ProductModel.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() }).exec()
  ctx.status = 200
  ctx.body = {}
}
