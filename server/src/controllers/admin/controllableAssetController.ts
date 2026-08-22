import type { Context } from 'koa'
import { Types } from 'mongoose'
import { ControllableAssetModel } from '@/models/ControllableAsset'
import { ProductModel } from '@/models/Product'
import { UserModel } from '@/models/User'
import { UserControllableSelectionModel } from '@/models/UserControllableSelection'
import { UserProductModel } from '@/models/UserProduct'
import type { ControllableAssetType } from '@/types/models'
import { getTransportProductCategory } from '@/services/productCategoryService'

const TYPES: ControllableAssetType[] = ['vehicle', 'character', 'ship', 'aircraft']

type Payload = {
  identifier?: string | number
  name?: string
  type?: ControllableAssetType
  sortOrder?: number
  description?: string
  prefabUrl?: string
  isActive?: boolean
  isDefault?: boolean
  categoryId?: string
  runtimeConfig?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapAsset(row: any, product?: any) {
  return {
    id: row._id.toString(),
    identifier: String(row.identifier ?? ''),
    name: row.name ?? '',
    type: row.type,
    sortOrder: Number(row.sortOrder) || 0,
    description: row.description ?? '',
    prefabUrl: row.prefabUrl ?? '',
    isActive: row.isActive !== false,
    isDefault: row.isDefault === true,
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
    runtimeConfig: row.runtimeConfig ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

async function createProductForAsset(body: Payload, current?: any) {
  if (current?.productId) {
    const product = await ProductModel.findById(current.productId).exec()
    if (product) {
      return await ProductModel.findByIdAndUpdate(
        product._id,
        {
          name: text(body.name) || product.name,
          slug: product.slug,
          categoryId: body.categoryId && Types.ObjectId.isValid(body.categoryId)
            ? new Types.ObjectId(body.categoryId)
            : product.categoryId,
          description: body.description === undefined ? product.description : text(body.description),
        },
        { new: true },
      ).exec()
    }
  }

  const categoryId = text(body.categoryId)
  const fallbackCategory = !Types.ObjectId.isValid(categoryId) ? await getTransportProductCategory() : null
  const resolvedCategoryId = Types.ObjectId.isValid(categoryId) ? categoryId : fallbackCategory?.id
  if (!resolvedCategoryId || !Types.ObjectId.isValid(resolvedCategoryId)) {
    throw new Error('categoryId is required')
  }

  const slugBase = `${text(body.type) || 'asset'}-${text(body.identifier) || Date.now()}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
  let slug = slugBase || `controllable-${Date.now()}`
  let suffix = 1
  while (await ProductModel.exists({ slug })) {
    slug = `${slugBase}-${suffix++}`
  }

  return await ProductModel.create({
    name: text(body.name),
    slug,
    categoryId: new Types.ObjectId(resolvedCategoryId),
    price: 0,
    description: text(body.description),
  })
}

export async function listControllableAssets(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, type, isActive } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const filter: Record<string, unknown> = {}

  if (type && TYPES.includes(type as ControllableAssetType)) {
    filter.type = type
  }
  if (isActive === 'true' || isActive === 'false') {
    filter.isActive = isActive === 'true'
  }
  if (keyword?.trim()) {
    const pattern = new RegExp(keyword.trim(), 'i')
    filter.$or = [{ identifier: pattern }, { name: pattern }, { description: pattern }]
  }

  const [rows, total] = await Promise.all([
    ControllableAssetModel.find(filter).sort({ type: 1, sortOrder: 1, createdAt: -1 }).skip((pageNumber - 1) * limit).limit(limit).lean().exec(),
    ControllableAssetModel.countDocuments(filter),
  ])
  const products = await ProductModel.find({ _id: { $in: rows.map((row: any) => row.productId) } }).lean().exec()
  const productsById = new Map(products.map((product: any) => [product._id.toString(), product]))
  ctx.body = {
    data: rows.map((row: any) => mapAsset(row, productsById.get(row.productId?.toString?.() ?? ''))),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getControllableAsset(ctx: Context): Promise<void> {
  const row = await ControllableAssetModel.findById(ctx.params.id).lean().exec()
  if (!row) {
    ctx.throw(404, 'Controllable asset not found')
  }
  const product = row?.productId ? await ProductModel.findById(row.productId).lean().exec() : null
  ctx.body = mapAsset(row, product)
}

export async function createControllableAsset(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Payload
  const identifier = text(body.identifier) || String(body.identifier ?? '').trim()
  const name = text(body.name)
  const type = body.type
  if (!identifier || !name || !type || !TYPES.includes(type)) {
    ctx.throw(400, 'identifier, name and valid type are required')
  }
  if (await ControllableAssetModel.exists({ type, identifier })) {
    ctx.throw(409, 'identifier already exists for this type')
  }

  let product
  try {
    product = await createProductForAsset(body)
  } catch (error) {
    ctx.throw(400, (error as Error).message)
    return
  }
  if (!product) {
    ctx.throw(400, 'Unable to resolve product')
  }

  const created = await ControllableAssetModel.create({
    identifier,
    name,
    type,
    sortOrder: Number(body.sortOrder) || 0,
    description: text(body.description),
    prefabUrl: text(body.prefabUrl),
    isActive: body.isActive !== false,
    isDefault: body.isDefault === true,
    productId: product!._id,
    runtimeConfig: body.runtimeConfig ?? null,
    metadata: body.metadata ?? null,
  })
  await ProductModel.findByIdAndUpdate(product!._id, { controllableAssetId: created._id, controllableType: type }).exec()
  ctx.status = 201
  ctx.body = mapAsset(created.toObject(), await ProductModel.findById(product!._id).lean().exec())
}

export async function updateControllableAsset(ctx: Context): Promise<void> {
  if (!Types.ObjectId.isValid(ctx.params.id)) {
    ctx.throw(400, 'Invalid controllable asset id')
  }
  const current = await ControllableAssetModel.findById(ctx.params.id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Controllable asset not found')
  }
  const body = (ctx.request.body ?? {}) as Payload
  const nextType = body.type ?? current.type
  const nextIdentifier = body.identifier === undefined ? current.identifier : String(body.identifier).trim()
  if (!TYPES.includes(nextType) || !nextIdentifier) {
    ctx.throw(400, 'Invalid type or identifier')
  }
  const duplicate = await ControllableAssetModel.exists({ _id: { $ne: current._id }, type: nextType, identifier: nextIdentifier })
  if (duplicate) {
    ctx.throw(409, 'identifier already exists for this type')
  }

  const updated = await ControllableAssetModel.findByIdAndUpdate(
    current._id,
    {
      identifier: nextIdentifier,
      type: nextType,
      name: body.name === undefined ? current.name : text(body.name),
      sortOrder: body.sortOrder === undefined ? current.sortOrder : Number(body.sortOrder) || 0,
      description: body.description === undefined ? current.description : text(body.description),
      prefabUrl: body.prefabUrl === undefined ? current.prefabUrl : text(body.prefabUrl),
      isActive: body.isActive === undefined ? current.isActive : body.isActive === true,
      isDefault: body.isDefault === undefined ? current.isDefault : body.isDefault === true,
      runtimeConfig: body.runtimeConfig === undefined ? current.runtimeConfig : body.runtimeConfig,
      metadata: body.metadata === undefined ? current.metadata : body.metadata,
    },
    { new: true },
  )
    .lean()
    .exec()

  if (updated?.productId) {
    const productUpdate: Record<string, unknown> = {
      name: updated.name,
      description: updated.description,
      controllableType: updated.type,
    }
    if (body.categoryId && Types.ObjectId.isValid(body.categoryId)) {
      productUpdate.categoryId = new Types.ObjectId(body.categoryId)
    }
    await ProductModel.findByIdAndUpdate(updated.productId, productUpdate).exec()
  }

  ctx.body = mapAsset(updated, updated?.productId ? await ProductModel.findById(updated.productId).lean().exec() : null)
}

export async function deleteControllableAsset(ctx: Context): Promise<void> {
  const current = await ControllableAssetModel.findById(ctx.params.id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Controllable asset not found')
  }
  await ControllableAssetModel.deleteOne({ _id: current._id }).exec()
  if (current.productId) {
    await ProductModel.findByIdAndUpdate(current.productId, {
      isDeleted: true,
      deletedAt: new Date(),
      controllableAssetId: null,
    }).exec()
  }
  ctx.body = {}
}

type UserControllableAssetPayload = {
  userId?: string
  controllableAssetId?: string
}

function mapUserControllableAsset(
  row: any,
  assetsByProductId: Map<string, any>,
  selectedKeys: Set<string>,
) {
  const user = row.userId
  const product = row.productId
  const productId = product?._id?.toString?.() ?? row.productId?.toString?.() ?? ''
  const asset = assetsByProductId.get(productId) ?? null
  const isAdminAssign = (row.metadata as any)?.source === 'admin-assign'
  const userId = user?._id?.toString?.() ?? user?.toString?.() ?? ''
  const isSelected =
    Boolean(asset) && selectedKeys.has(`${userId}:${asset!._id.toString()}`)
  return {
    id: row._id.toString(),
    userId,
    user: user
      ? {
          id: userId,
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
    controllableAssetId: asset?._id?.toString?.() ?? null,
    controllableAsset: asset
      ? {
          id: asset._id.toString(),
          identifier: String(asset.identifier ?? ''),
          name: asset.name ?? '',
          type: asset.type,
          prefabUrl: asset.prefabUrl ?? '',
          isActive: asset.isActive !== false,
          isDefault: asset.isDefault === true,
        }
      : null,
    state: row.state ?? 'unused',
    source: isAdminAssign ? 'admin-assign' : 'order',
    isSelected,
    acquiredAt: row.acquiredAt?.toISOString?.() ?? null,
    expiresAt: row.expiresAt?.toISOString?.() ?? null,
    orderId: row.orderId?.toString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

export async function listUserControllableAssets(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, userId, type } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const skip = (pageNumber - 1) * limit

  const assetProductIds = await ControllableAssetModel.distinct('productId').exec()
  if (!assetProductIds.length) {
    ctx.body = {
      data: [],
      page: pageNumber,
      pageSize: limit,
      total: 0,
    }
    return
  }
  const filter: Record<string, unknown> = {
    productId: { $in: assetProductIds },
  }
  if (userId && Types.ObjectId.isValid(userId)) {
    filter.userId = new Types.ObjectId(userId)
  }

  const keywordText = keyword?.trim()
  const validType = type && TYPES.includes(type as ControllableAssetType) ? type : null

  if (keywordText || validType) {
    const assetFilter: Record<string, unknown> = {}
    if (validType) {
      assetFilter.type = validType
    }
    if (keywordText) {
      const pattern = new RegExp(keywordText, 'i')
      assetFilter.$or = [{ identifier: pattern }, { name: pattern }, { description: pattern }]
    }
    const assetRows = await ControllableAssetModel.find(assetFilter)
      .select({ _id: 1, productId: 1 })
      .lean()
      .exec()
    const productIds = assetRows.map((row: any) => row.productId).filter(Boolean)

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
        orParts.push({ userId: { $in: matchedUserIds }, productId: { $in: assetProductIds } })
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
  const assets = productIds.length
    ? await ControllableAssetModel.find({ productId: { $in: productIds } }).lean().exec()
    : []
  const assetsByProductId = new Map(assets.map((asset: any) => [asset.productId.toString(), asset]))

  const pageUserIds = Array.from(
    new Set(
      (rows as any[]).map((row) => row.userId?._id?.toString?.() ?? row.userId?.toString?.()).filter(Boolean),
    ),
  )
  const assetIds = assets.map((asset: any) => asset._id)
  const selections =
    pageUserIds.length && assetIds.length
      ? await UserControllableSelectionModel.find({
          userId: { $in: pageUserIds },
          controllableAssetId: { $in: assetIds },
        })
          .select({ userId: 1, controllableAssetId: 1 })
          .lean()
          .exec()
      : []
  const selectedKeys = new Set(
    selections.map(
      (selection: any) =>
        `${selection.userId?.toString?.() ?? ''}:${selection.controllableAssetId?.toString?.() ?? ''}`,
    ),
  )

  ctx.body = {
    data: (rows as any[]).map((row) => mapUserControllableAsset(row, assetsByProductId, selectedKeys)),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function createUserControllableAsset(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as UserControllableAssetPayload
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const controllableAssetId =
    typeof body.controllableAssetId === 'string' ? body.controllableAssetId.trim() : ''
  if (!userId || !Types.ObjectId.isValid(userId)) {
    ctx.throw(400, 'Valid userId is required')
  }
  if (!controllableAssetId || !Types.ObjectId.isValid(controllableAssetId)) {
    ctx.throw(400, 'Valid controllableAssetId is required')
  }

  const [user, asset] = await Promise.all([
    UserModel.findById(userId).select({ _id: 1 }).lean().exec(),
    ControllableAssetModel.findById(controllableAssetId)
      .select({ _id: 1, type: 1, productId: 1, isActive: 1 })
      .lean()
      .exec(),
  ])
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  if (!asset) {
    ctx.throw(404, 'Controllable asset not found')
  }
  if (asset.isActive === false) {
    ctx.throw(400, 'Controllable asset is disabled')
  }
  if (!asset.productId) {
    ctx.throw(400, 'Controllable asset has no linked product')
  }

  const existing = await UserProductModel.findOne({ userId: user._id, productId: asset.productId })
    .select({ _id: 1 })
    .lean()
    .exec()
  if (existing) {
    ctx.throw(409, 'User already owns this controllable asset')
  }

  const created = await UserProductModel.create({
    userId: user._id,
    productId: asset.productId,
    state: 'unused',
    acquiredAt: new Date(),
    orderId: null,
    metadata: {
      source: 'admin-assign',
      assignedBy: ctx.state.adminAuthUser?.id ?? null,
      assignedAt: new Date().toISOString(),
    },
  })
  await UserControllableSelectionModel.findOneAndUpdate(
    { userId: user._id, controllableType: asset.type },
    { userId: user._id, controllableType: asset.type, controllableAssetId: asset._id },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec()

  const row = await UserProductModel.findById(created._id)
    .populate('userId', 'username displayName')
    .populate('productId', 'name slug price')
    .lean()
    .exec()
  const assets = row?.productId?._id
    ? await ControllableAssetModel.find({ productId: row.productId._id }).lean().exec()
    : []
  const assetsByProductId = new Map(assets.map((assetRow: any) => [assetRow.productId.toString(), assetRow]))
  const assetId = assets[0]?._id?.toString?.() ?? ''
  const rowUserId = row?.userId?._id?.toString?.() ?? row?.userId?.toString?.() ?? ''
  const selectedKeys = new Set(assetId && rowUserId ? [`${rowUserId}:${assetId}`] : [])
  ctx.status = 201
  ctx.body = mapUserControllableAsset(row, assetsByProductId, selectedKeys)
}

export async function deleteUserControllableAsset(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user controllable asset id')
  }
  const row = await UserProductModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'User controllable asset not found')
  }
  const asset = await ControllableAssetModel.findOne({ productId: row.productId })
    .select({ _id: 1 })
    .lean()
    .exec()
  if (!asset) {
    ctx.throw(400, 'Not a controllable asset ownership record')
  }
  await UserProductModel.deleteOne({ _id: row._id }).exec()
  await UserControllableSelectionModel.deleteMany({
    userId: row.userId,
    controllableAssetId: asset._id,
  }).exec()
  ctx.body = {}
}
