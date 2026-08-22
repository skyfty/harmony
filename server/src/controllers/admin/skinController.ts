import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SkinModel } from '@/models/Skin'
import { SkinCategoryModel } from '@/models/SkinCategory'
import { ProductModel } from '@/models/Product'
import { UserModel } from '@/models/User'
import { UserProductModel } from '@/models/UserProduct'
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

type UserSkinPayload = {
  userId?: string
  skinId?: string
}

function mapUserSkin(
  row: any,
  skinsByProductId: Map<string, any>,
  categoriesById: Map<string, any>,
) {
  const user = row.userId
  const product = row.productId
  const productId = product?._id?.toString?.() ?? row.productId?.toString?.() ?? ''
  const skin = skinsByProductId.get(productId) ?? null
  const category = skin?.categoryId ? (categoriesById.get(skin.categoryId.toString()) ?? null) : null
  const isAdminAssign = (row.metadata as any)?.source === 'admin-assign'
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
    productId: row.productId?.toString?.() ?? null,
    product: product
      ? {
          id: product._id.toString(),
          name: product.name,
          slug: product.slug,
          price: product.price,
        }
      : null,
    skinId: skin?._id?.toString?.() ?? null,
    skin: skin
      ? {
          id: skin._id.toString(),
          identifier: String(skin.identifier ?? ''),
          name: skin.name ?? '',
          categoryId: skin.categoryId?.toString?.() ?? null,
          categoryName: category?.name ?? null,
          slotKey: category?.slotKey ?? null,
          prefabUrl: skin.prefabUrl ?? '',
          isActive: skin.isActive !== false,
          sortOrder: Number(skin.sortOrder) || 0,
        }
      : null,
    state: row.state ?? 'unused',
    source: isAdminAssign ? 'admin-assign' : 'order',
    acquiredAt: row.acquiredAt?.toISOString?.() ?? null,
    expiresAt: row.expiresAt?.toISOString?.() ?? null,
    orderId: row.orderId?.toString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

export async function listUserSkins(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, userId, categoryId } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const skip = (pageNumber - 1) * limit

  const skinProductIds = await SkinModel.distinct('productId').exec()
  if (!skinProductIds.length) {
    ctx.body = {
      data: [],
      page: pageNumber,
      pageSize: limit,
      total: 0,
    }
    return
  }
  const filter: Record<string, unknown> = {
    productId: { $in: skinProductIds },
  }
  if (userId && Types.ObjectId.isValid(userId)) {
    filter.userId = new Types.ObjectId(userId)
  }

  const keywordText = keyword?.trim()
  const validCategoryId = categoryId && Types.ObjectId.isValid(categoryId) ? new Types.ObjectId(categoryId) : null

  if (keywordText || validCategoryId) {
    const skinFilter: Record<string, unknown> = {}
    if (validCategoryId) {
      skinFilter.categoryId = validCategoryId
    }
    if (keywordText) {
      const pattern = new RegExp(keywordText, 'i')
      skinFilter.$or = [{ identifier: pattern }, { name: pattern }, { description: pattern }]
    }
    const skinRows = await SkinModel.find(skinFilter).select({ _id: 1, productId: 1 }).lean().exec()
    const productIds = skinRows.map((row: any) => row.productId).filter(Boolean)

    const orParts: Array<Record<string, unknown>> = []
    if (productIds.length) {
      orParts.push({ productId: { $in: productIds } })
    }
    if (keywordText) {
      const userRows = await UserModel.find({
        $or: [{ username: new RegExp(keywordText, 'i') }, { displayName: new RegExp(keywordText, 'i') }],
      })
        .select({ _id: 1 })
        .lean()
        .exec()
      const matchedUserIds = userRows.map((row: any) => row._id)
      if (matchedUserIds.length) {
        orParts.push({ userId: { $in: matchedUserIds }, productId: { $in: skinProductIds } })
      }
    }
    if (!orParts.length) {
      ctx.body = {
        data: [],
        page: pageNumber,
        pageSize: limit,
        total: 0,
      }
      return
    }
    filter.$or = orParts
  }

  const [rows, total] = await Promise.all([
    UserProductModel.find(filter)
      .populate('userId', 'username displayName')
      .populate('productId', 'name slug price')
      .sort({ acquiredAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    UserProductModel.countDocuments(filter),
  ])

  const productIds = Array.from(
    new Set(
      (rows as any[]).map((row) => row.productId?._id?.toString?.() ?? row.productId?.toString?.()).filter(Boolean),
    ),
  )
  const skins = productIds.length
    ? await SkinModel.find({ productId: { $in: productIds } }).lean().exec()
    : []
  const categoryIds = Array.from(
    new Set(skins.map((skin: any) => skin.categoryId?.toString?.()).filter(Boolean)),
  )
  const categories = categoryIds.length
    ? await SkinCategoryModel.find({ _id: { $in: categoryIds } }).lean().exec()
    : []
  const skinsByProductId = new Map(skins.map((skin: any) => [skin.productId.toString(), skin]))
  const categoriesById = new Map(categories.map((category: any) => [category._id.toString(), category]))

  ctx.body = {
    data: (rows as any[]).map((row) => mapUserSkin(row, skinsByProductId, categoriesById)),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function createUserSkin(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as UserSkinPayload
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const skinId = typeof body.skinId === 'string' ? body.skinId.trim() : ''
  if (!userId || !Types.ObjectId.isValid(userId)) {
    ctx.throw(400, 'Valid userId is required')
  }
  if (!skinId || !Types.ObjectId.isValid(skinId)) {
    ctx.throw(400, 'Valid skinId is required')
  }

  const [user, skin] = await Promise.all([
    UserModel.findById(userId).select({ _id: 1 }).lean().exec(),
    SkinModel.findById(skinId).select({ _id: 1, categoryId: 1, productId: 1, isActive: 1 }).lean().exec(),
  ])
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  if (!skin) {
    ctx.throw(404, 'Skin not found')
  }
  if (skin.isActive === false) {
    ctx.throw(400, 'Skin is disabled')
  }
  if (!skin.productId) {
    ctx.throw(400, 'Skin has no linked product')
  }

  const existing = await UserProductModel.findOne({ userId: user._id, productId: skin.productId })
    .select({ _id: 1 })
    .lean()
    .exec()
  if (existing) {
    ctx.throw(409, 'User already owns this skin')
  }

  const created = await UserProductModel.create({
    userId: user._id,
    productId: skin.productId,
    state: 'unused',
    acquiredAt: new Date(),
    orderId: null,
    metadata: {
      source: 'admin-assign',
      assignedBy: ctx.state.adminAuthUser?.id ?? null,
      assignedAt: new Date().toISOString(),
    },
  })
  await UserSkinSelectionModel.findOneAndUpdate(
    { userId: user._id, skinCategoryId: skin.categoryId },
    { userId: user._id, skinCategoryId: skin.categoryId, skinId: skin._id },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec()

  const row = await UserProductModel.findById(created._id)
    .populate('userId', 'username displayName')
    .populate('productId', 'name slug price')
    .lean()
    .exec()
  const skins = row?.productId?._id
    ? await SkinModel.find({ productId: row.productId._id }).lean().exec()
    : []
  const category = skins[0]?.categoryId ? await SkinCategoryModel.findById(skins[0].categoryId).lean().exec() : null
  const skinsByProductId = new Map(skins.map((skinRow: any) => [skinRow.productId.toString(), skinRow]))
  const categoriesById = new Map(category ? [[category._id.toString(), category]] : [])
  ctx.status = 201
  ctx.body = mapUserSkin(row, skinsByProductId, categoriesById)
}

export async function deleteUserSkin(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user skin id')
  }
  const row = await UserProductModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'User skin not found')
  }
  const skin = await SkinModel.findOne({ productId: row.productId }).select({ _id: 1 }).lean().exec()
  if (!skin) {
    ctx.throw(400, 'Not a skin ownership record')
  }
  await UserProductModel.deleteOne({ _id: row._id }).exec()
  await UserSkinSelectionModel.deleteMany({ userId: row.userId, skinId: skin._id }).exec()
  ctx.body = {}
}
