import { Types } from 'mongoose'
import { ProductCategoryModel } from '@/models/ProductCategory'
import { ProductModel } from '@/models/Product'

export const TRANSPORT_PRODUCT_CATEGORY_NAME = '交通工具'

export interface ProductCategoryView {
  id: string
  name: string
  description: string | null
  sortOrder: number
  enabled: boolean
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') {
    return ''
  }
  return name.trim()
}

function sanitizeDescription(description: unknown): string | null {
  if (typeof description !== 'string') {
    return null
  }
  const trimmed = description.trim()
  return trimmed.length ? trimmed : null
}

function toCategoryView(row: any): ProductCategoryView {
  return {
    id: row._id.toString(),
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
    enabled: row.enabled !== false,
    isBuiltin: row.isBuiltin === true,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

export async function listProductCategories(): Promise<ProductCategoryView[]> {
  const rows = await ProductCategoryModel.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean().exec()
  return (rows as any[]).map(toCategoryView)
}

export async function createProductCategory(
  payload: { description?: unknown; enabled?: unknown; name?: unknown; sortOrder?: unknown },
): Promise<ProductCategoryView> {
  const name = sanitizeName(payload.name)
  if (!name) {
    throw new Error('Category name is required')
  }
  const sortOrder = Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0
  const created = await ProductCategoryModel.create({
    name,
    description: sanitizeDescription(payload.description),
    sortOrder,
    enabled: payload.enabled === undefined ? true : payload.enabled !== false,
    normalizedName: normalizeName(name),
    isBuiltin: false,
  })
  return toCategoryView(created.toObject())
}

export async function updateProductCategory(
  categoryId: string,
  payload: { description?: unknown; enabled?: unknown; name?: unknown; sortOrder?: unknown },
): Promise<ProductCategoryView | null> {
  if (!Types.ObjectId.isValid(categoryId)) {
    throw new Error('Invalid category id')
  }
  const current = await ProductCategoryModel.findById(categoryId).lean().exec()
  if (!current) {
    return null
  }
  const nextNameRaw = payload.name === undefined ? current.name : sanitizeName(payload.name)
  if (!nextNameRaw) {
    throw new Error('Category name is required')
  }
  const updated = await ProductCategoryModel.findByIdAndUpdate(
    categoryId,
    {
      name: nextNameRaw,
      normalizedName: normalizeName(nextNameRaw),
      description: payload.description === undefined ? current.description ?? null : sanitizeDescription(payload.description),
      sortOrder: payload.sortOrder === undefined ? current.sortOrder ?? 0 : Number(payload.sortOrder) || 0,
      enabled: payload.enabled === undefined ? current.enabled !== false : payload.enabled !== false,
    },
    { new: true },
  )
    .lean()
    .exec()
  return updated ? toCategoryView(updated) : null
}

export async function deleteProductCategory(categoryId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(categoryId)) {
    throw new Error('Invalid category id')
  }
  const current = await ProductCategoryModel.findById(categoryId).lean().exec()
  if (!current) {
    return false
  }
  if (current.isBuiltin === true) {
    throw new Error('Builtin category cannot be deleted')
  }
  await ProductCategoryModel.findByIdAndDelete(categoryId).exec()
  await ProductModel.updateMany(
    { categoryId: new Types.ObjectId(categoryId) },
    { $set: { categoryId: null } },
  ).exec()
  return true
}

export async function ensureTransportProductCategory(): Promise<void> {
  const normalizedName = normalizeName(TRANSPORT_PRODUCT_CATEGORY_NAME)
  await ProductCategoryModel.updateOne(
    { normalizedName },
    {
      $setOnInsert: {
        name: TRANSPORT_PRODUCT_CATEGORY_NAME,
        description: '车辆类商品',
        sortOrder: 10,
        enabled: true,
        normalizedName,
      },
      $set: {
        isBuiltin: true,
      },
    },
    { upsert: true },
  ).exec()
}

export async function getTransportProductCategory(): Promise<{ id: string; name: string } | null> {
  const normalizedName = normalizeName(TRANSPORT_PRODUCT_CATEGORY_NAME)
  const row = await ProductCategoryModel.findOne({ normalizedName, enabled: true }).lean().exec()
  if (!row) {
    return null
  }
  return {
    id: row._id.toString(),
    name: row.name,
  }
}
