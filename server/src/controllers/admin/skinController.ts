import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SkinModel } from '@/models/Skin'
import { SkinCategoryModel } from '@/models/SkinCategory'
import { ProductModel } from '@/models/Product'
import { UserSkinSelectionModel } from '@/models/UserSkinSelection'
import { getSkinProductCategory } from '@/services/productCategoryService'

type Payload = {
  identifier?: string | number
  name?: string
  categoryId?: string
  sortOrder?: number
  description?: string
  prefabUrl?: string
  isActive?: boolean
  metadata?: Record<string, unknown> | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapSkin(row: any, product?: any, category?: any) {
  return {
    id: row._id.toString(),
    identifier: String(row.identifier ?? ''),
    name: row.name ?? '',
    categoryId: row.categoryId?.toString?.() ?? null,
    categoryName: category?.name ?? null,
    slotKey: category?.slotKey ?? null,
    sortOrder: Number(row.sortOrder) || 0,
    description: row.description ?? '',
    prefabUrl: row.prefabUrl ?? '',
    isActive: row.isActive !== false,
    productId: row.productId?.toString?.() ?? null,
    product: product
      ? {
          id: product._id.toString(),
          name: product.name,
          slug: product.slug,
          categoryId: product.categoryId?.toString?.() ?? null,
          price: product.price,
        }
      : undefined,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

async function resolveSkinCategory(categoryId: string) {
  if (!Types.ObjectId.isValid(categoryId)) {
    throw new Error('categoryId is required')
  }
  const category = await SkinCategoryModel.findById(categoryId).lean().exec()
  if (!category) {
    throw new Error('Skin category not found')
  }
  return category
}

async function createProductForSkin(body: Payload): Promise<any> {
  const skinCategory = await getSkinProductCategory()
  if (!skinCategory) {
    throw new Error('皮肤商品分类未初始化')
  }
  const slugBase = `skin-${text(body.identifier) || Date.now()}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
  let slug = slugBase || `skin-${Date.now()}`
  let suffix = 1
  while (await ProductModel.exists({ slug })) {
    slug = `${slugBase}-${suffix++}`
  }
  return await ProductModel.create({
    name: text(body.name),
    slug,
    categoryId: new Types.ObjectId(skinCategory.id),
    price: 0,
    description: text(body.description),
  })
}

export async function listSkins(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, categoryId, isActive } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const filter: Record<string, unknown> = {}

  if (categoryId && Types.ObjectId.isValid(categoryId)) {
    filter.categoryId = new Types.ObjectId(categoryId)
  }
  if (isActive === 'true' || isActive === 'false') {
    filter.isActive = isActive === 'true'
  }
  if (keyword?.trim()) {
    const pattern = new RegExp(keyword.trim(), 'i')
    filter.$or = [{ identifier: pattern }, { name: pattern }, { description: pattern }]
  }

  const [rows, total] = await Promise.all([
    SkinModel.find(filter).sort({ categoryId: 1, sortOrder: 1, createdAt: -1 }).skip((pageNumber - 1) * limit).limit(limit).lean().exec(),
    SkinModel.countDocuments(filter),
  ])
  const productIds = rows.map((row: any) => row.productId).filter(Boolean)
  const categoryIds = rows.map((row: any) => row.categoryId).filter(Boolean)
  const [products, categories] = await Promise.all([
    ProductModel.find({ _id: { $in: productIds } }).lean().exec(),
    SkinCategoryModel.find({ _id: { $in: categoryIds } }).lean().exec(),
  ])
  const productsById = new Map(products.map((product: any) => [product._id.toString(), product]))
  const categoriesById = new Map(categories.map((category: any) => [category._id.toString(), category]))
  ctx.body = {
    data: rows.map((row: any) => mapSkin(row, productsById.get(row.productId?.toString?.() ?? ''), categoriesById.get(row.categoryId?.toString?.() ?? ''))),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getSkin(ctx: Context): Promise<void> {
  const row = await SkinModel.findById(ctx.params.id).lean().exec()
  if (!row) {
    ctx.throw(404, 'Skin not found')
  }
  const [product, category] = await Promise.all([
    row?.productId ? ProductModel.findById(row.productId).lean().exec() : null,
    row?.categoryId ? SkinCategoryModel.findById(row.categoryId).lean().exec() : null,
  ])
  ctx.body = mapSkin(row, product, category)
}

export async function createSkin(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Payload
  const identifier = text(body.identifier) || String(body.identifier ?? '').trim()
  const name = text(body.name)
  const categoryId = text(body.categoryId)
  if (!identifier || !name || !categoryId) {
    ctx.throw(400, 'identifier, name and categoryId are required')
  }
  let category
  try {
    category = await resolveSkinCategory(categoryId)
  } catch (error) {
    ctx.throw(400, (error as Error).message)
    return
  }
  if (await SkinModel.exists({ categoryId: category._id, identifier })) {
    ctx.throw(409, 'identifier already exists for this category')
  }

  let product
  try {
    product = await createProductForSkin(body)
  } catch (error) {
    ctx.throw(400, (error as Error).message)
    return
  }
  if (!product) {
    ctx.throw(400, 'Unable to resolve product')
  }

  const created = await SkinModel.create({
    identifier,
    name,
    categoryId: category._id,
    sortOrder: Number(body.sortOrder) || 0,
    description: text(body.description),
    prefabUrl: text(body.prefabUrl),
    isActive: body.isActive !== false,
    productId: product!._id,
    metadata: body.metadata ?? null,
  })
  await ProductModel.findByIdAndUpdate(product!._id, { skinId: created._id }).exec()
  ctx.status = 201
  ctx.body = mapSkin(created.toObject(), await ProductModel.findById(product!._id).lean().exec(), category)
}

export async function updateSkin(ctx: Context): Promise<void> {
  if (!Types.ObjectId.isValid(ctx.params.id)) {
    ctx.throw(400, 'Invalid skin id')
  }
  const current = await SkinModel.findById(ctx.params.id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Skin not found')
  }
  const body = (ctx.request.body ?? {}) as Payload
  const nextCategoryId = body.categoryId === undefined ? current.categoryId.toString() : text(body.categoryId)
  let category
  try {
    category = await resolveSkinCategory(nextCategoryId)
  } catch (error) {
    ctx.throw(400, (error as Error).message)
    return
  }
  const nextIdentifier = body.identifier === undefined ? String(current.identifier) : String(body.identifier).trim()
  if (!nextIdentifier) {
    ctx.throw(400, 'Invalid identifier')
  }
  const nextName = body.name === undefined ? current.name : text(body.name)
  if (!nextName) {
    ctx.throw(400, 'name is required')
  }
  const duplicate = await SkinModel.exists({
    _id: { $ne: current._id },
    categoryId: category._id,
    identifier: nextIdentifier,
  })
  if (duplicate) {
    ctx.throw(409, 'identifier already exists for this category')
  }

  const updated = await SkinModel.findByIdAndUpdate(
    current._id,
    {
      identifier: nextIdentifier,
      categoryId: category._id,
      name: nextName,
      sortOrder: body.sortOrder === undefined ? current.sortOrder : Number(body.sortOrder) || 0,
      description: body.description === undefined ? current.description : text(body.description),
      prefabUrl: body.prefabUrl === undefined ? current.prefabUrl : text(body.prefabUrl),
      isActive: body.isActive === undefined ? current.isActive : body.isActive === true,
      metadata: body.metadata === undefined ? current.metadata : body.metadata,
    },
    { new: true },
  )
    .lean()
    .exec()

  if (updated?.productId) {
    await ProductModel.findByIdAndUpdate(updated.productId, {
      name: updated.name,
      description: updated.description,
    }).exec()
  }

  ctx.body = mapSkin(
    updated,
    updated?.productId ? await ProductModel.findById(updated.productId).lean().exec() : null,
    category,
  )
}

export async function deleteSkin(ctx: Context): Promise<void> {
  const current = await SkinModel.findById(ctx.params.id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Skin not found')
  }
  await SkinModel.deleteOne({ _id: current._id }).exec()
  await UserSkinSelectionModel.deleteMany({ skinId: current._id }).exec()
  if (current.productId) {
    await ProductModel.findByIdAndUpdate(current.productId, {
      isDeleted: true,
      deletedAt: new Date(),
      skinId: null,
    }).exec()
  }
  ctx.body = {}
}
