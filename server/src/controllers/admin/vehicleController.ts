import type { Context } from 'koa'
import { Types } from 'mongoose'
import { VehicleModel } from '@/models/Vehicle'
import { UserVehicleModel } from '@/models/UserVehicle'
import { UserModel } from '@/models/User'
import { ProductModel } from '@/models/Product'
import { getTransportProductCategory } from '@/services/productCategoryService'

type VehiclePayload = {
  identifier?: number | string
  name?: string
  description?: string
  coverUrl?: string
  isActive?: boolean
  isDefault?: boolean
  maxSpeed?: number
  acceleration?: number
  prefabUrl?: string
  braking?: number
  handling?: number
  mass?: number
  drag?: number
}

type UserVehiclePayload = {
  userId?: string
  vehicleId?: string
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toIdentifierValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return toStringValue(value)
}

function mapVehicle(row: any) {
  return {
    id: row._id.toString(),
    identifier: String(row.identifier ?? ''),
    name: row.name,
    description: row.description ?? '',
    coverUrl: row.coverUrl ?? '',
    maxSpeed: typeof row.maxSpeed === 'number' ? row.maxSpeed : undefined,
    acceleration: typeof row.acceleration === 'number' ? row.acceleration : undefined,
    braking: typeof row.braking === 'number' ? row.braking : undefined,
    handling: typeof row.handling === 'number' ? row.handling : undefined,
    prefabUrl: row.prefabUrl ?? '',
    mass: typeof row.mass === 'number' ? row.mass : undefined,
    drag: typeof row.drag === 'number' ? row.drag : undefined,
    isActive: row.isActive !== false,
    isDefault: row.isDefault === true,
    productId: row.productId?.toString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

function normalizeSlugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function buildVehicleProductSlug(base: string): Promise<string> {
  const normalized = normalizeSlugPart(base) || 'vehicle-product'
  let next = normalized
  let cursor = 1
  while (await ProductModel.exists({ slug: next })) {
    cursor += 1
    next = `${normalized}-${cursor}`
  }
  return next
}

function mapUserVehicle(row: any) {
  const user = row.userId
  const vehicle = row.vehicleId
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
    vehicleId: vehicle?._id?.toString?.() ?? vehicle?.toString?.() ?? '',
    vehicle: vehicle
      ? {
          id: vehicle?._id?.toString?.() ?? vehicle?.toString?.() ?? '',
          identifier: String(vehicle.identifier ?? ''),
          name: vehicle.name ?? '',
          description: vehicle.description ?? '',
          coverUrl: vehicle.coverUrl ?? '',
          prefabUrl: vehicle.prefabUrl ?? '',
          isActive: vehicle.isActive !== false,
          isDefault: vehicle.isDefault === true,
        }
      : null,
    ownedAt: row.ownedAt?.toISOString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

export async function listVehicles(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '10', keyword, isActive, isDefault } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100)
  const skip = (pageNumber - 1) * limit

  const filter: Record<string, unknown> = {}
  if (keyword?.trim()) {
    const pattern = new RegExp(keyword.trim(), 'i')
    filter.$or = [{ identifier: pattern }, { name: pattern }, { description: pattern }]
  }
  if (isActive === 'true' || isActive === 'false') {
    filter.isActive = isActive === 'true'
  }
  if (isDefault === 'true' || isDefault === 'false') {
    filter.isDefault = isDefault === 'true'
  }

  const [rows, total] = await Promise.all([
    VehicleModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    VehicleModel.countDocuments(filter),
  ])

  ctx.body = {
    data: rows.map(mapVehicle),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getVehicle(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid vehicle id')
  }
  const row = await VehicleModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'Vehicle not found')
  }
  ctx.body = mapVehicle(row)
}

export async function createVehicle(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as VehiclePayload
  const identifier = toIdentifierValue(body.identifier)
  const name = toStringValue(body.name)
  const description = toStringValue(body.description) ?? ''
  const coverUrl = toStringValue(body.coverUrl) ?? ''
  const prefabUrl = toStringValue(body.prefabUrl) ?? ''
  if (!identifier) {
    ctx.throw(400, 'identifier is required')
  }
  if (!name) {
    ctx.throw(400, 'name is required')
  }

  const identifierExists = await VehicleModel.findOne({ identifier }).select({ _id: 1 }).lean().exec()
  if (identifierExists) {
    ctx.throw(409, 'identifier already exists')
  }

  const transportCategory = await getTransportProductCategory()
  if (!transportCategory) {
    ctx.throw(500, 'Transport product category is not initialized')
  }

  const slug = await buildVehicleProductSlug(`vehicle-${identifier}-${name}`)
  const product = await ProductModel.create({
    name,
    slug,
    categoryId: new Types.ObjectId(transportCategory.id),
    description,
    coverUrl,
    price: 0,
    metadata: {
      source: 'vehicle',
      vehicleIdentifier: identifier,
    },
  })

  let created: any = null
  try {
    created = await VehicleModel.create({
      identifier,
      name,
      description,
      coverUrl,
      prefabUrl,
      isActive: body.isActive !== false,
      isDefault: body.isDefault === true,
      maxSpeed: typeof body.maxSpeed === 'number' ? body.maxSpeed : undefined,
      acceleration: typeof body.acceleration === 'number' ? body.acceleration : undefined,
      braking: typeof body.braking === 'number' ? body.braking : undefined,
      handling: typeof body.handling === 'number' ? body.handling : undefined,
      mass: typeof body.mass === 'number' ? body.mass : undefined,
      drag: typeof body.drag === 'number' ? body.drag : undefined,
      productId: product._id,
    })
  } catch (error) {
    await ProductModel.findByIdAndDelete(product._id).exec()
    throw error
  }
  const row = await VehicleModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapVehicle(row)
}

export async function updateVehicle(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid vehicle id')
  }
  const current = await VehicleModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Vehicle not found')
  }

  const body = (ctx.request.body ?? {}) as VehiclePayload
  const nextIdentifier = body.identifier === undefined ? current.identifier : toIdentifierValue(body.identifier)
  if (!nextIdentifier) {
    ctx.throw(400, 'identifier is required')
  }
  if (nextIdentifier !== current.identifier) {
    const duplicatedIdentifier = await VehicleModel.findOne({
      _id: { $ne: id },
      identifier: nextIdentifier,
    })
      .select({ _id: 1 })
      .lean()
      .exec()
    if (duplicatedIdentifier) {
      ctx.throw(409, 'identifier already exists')
    }
  }

  const updated = await VehicleModel.findByIdAndUpdate(
    id,
    {
      identifier: nextIdentifier,
      name: toStringValue(body.name) ?? current.name,
      description: body.description === undefined ? current.description : (toStringValue(body.description) ?? ''),
      coverUrl:
        body.coverUrl === undefined
          ? (current as any).coverUrl ?? ''
          : (toStringValue(body.coverUrl) ?? ''),
      prefabUrl:
        body.prefabUrl === undefined
          ? (current as any).prefabUrl ?? ''
          : (toStringValue(body.prefabUrl) ?? ''),
      isActive: body.isActive === undefined ? current.isActive : body.isActive === true,
      isDefault: body.isDefault === undefined ? current.isDefault : body.isDefault === true,
      maxSpeed: body.maxSpeed === undefined ? (current as any).maxSpeed : Number(body.maxSpeed),
      acceleration: body.acceleration === undefined ? (current as any).acceleration : Number(body.acceleration),
      braking: body.braking === undefined ? (current as any).braking : Number(body.braking),
      handling: body.handling === undefined ? (current as any).handling : Number(body.handling),
      mass: body.mass === undefined ? (current as any).mass : Number(body.mass),
      drag: body.drag === undefined ? (current as any).drag : Number(body.drag),
    },
    { new: true },
  )
    .lean()
    .exec()

  if (updated?.productId) {
    const linkedProduct = await ProductModel.findById(updated.productId).select({ metadata: 1 }).lean().exec()
    await ProductModel.findByIdAndUpdate(updated.productId, {
      name: updated.name,
      description: updated.description ?? '',
      coverUrl: updated.coverUrl ?? '',
      isDeleted: false,
      deletedAt: null,
      metadata: {
        ...(typeof linkedProduct?.metadata === 'object' && linkedProduct?.metadata ? linkedProduct.metadata : {}),
        source: 'vehicle',
        vehicleIdentifier: updated.identifier,
      },
    }).exec()
  }

  ctx.body = mapVehicle(updated)
}

export async function deleteVehicle(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid vehicle id')
  }
  const current = await VehicleModel.findById(id).lean().exec()
  await VehicleModel.findByIdAndDelete(id).exec()
  if (current?.productId) {
    await ProductModel.findByIdAndUpdate(current.productId, { isDeleted: true, deletedAt: new Date() }).exec()
  }
  await UserVehicleModel.deleteMany({ vehicleId: id }).exec()
  ctx.status = 200
  ctx.body = {}
}

export async function listUserVehicles(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '10', keyword, userId, vehicleId } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100)
  const skip = (pageNumber - 1) * limit

  const filter: Record<string, unknown> = {}
  if (userId && Types.ObjectId.isValid(userId)) {
    filter.userId = new Types.ObjectId(userId)
  }
  if (vehicleId && Types.ObjectId.isValid(vehicleId)) {
    filter.vehicleId = new Types.ObjectId(vehicleId)
  }

  const keywordText = keyword?.trim()
  if (keywordText) {
    const [userRows, vehicleRows] = await Promise.all([
      UserModel.find({
        $or: [{ username: new RegExp(keywordText, 'i') }, { displayName: new RegExp(keywordText, 'i') }],
      })
        .select({ _id: 1 })
        .lean()
        .exec(),
      VehicleModel.find({
        $or: [{ identifier: new RegExp(keywordText, 'i') }, { name: new RegExp(keywordText, 'i') }, { description: new RegExp(keywordText, 'i') }],
      })
        .select({ _id: 1 })
        .lean()
        .exec(),
    ])

    const userIds = userRows.map((row: any) => row._id)
    const vehicleIds = vehicleRows.map((row: any) => row._id)
    if (userIds.length || vehicleIds.length) {
      filter.$or = [
        ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
        ...(vehicleIds.length ? [{ vehicleId: { $in: vehicleIds } }] : []),
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

  const [rows, total] = await Promise.all([
    UserVehicleModel.find(filter)
      .populate('userId', 'username displayName')
      .populate(
        'vehicleId',
        'identifier name description coverUrl prefabUrl isActive isDefault maxSpeed acceleration braking handling mass drag',
      )
      .sort({ ownedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    UserVehicleModel.countDocuments(filter),
  ])

  ctx.body = {
    data: (rows as any[]).map(mapUserVehicle),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getUserVehicle(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user vehicle id')
  }
  const row = await UserVehicleModel.findById(id)
    .populate('userId', 'username displayName')
    .populate(
      'vehicleId',
      'identifier name description coverUrl prefabUrl isActive isDefault maxSpeed acceleration braking handling mass drag',
    )
    .lean()
    .exec()
  if (!row) {
    ctx.throw(404, 'User vehicle not found')
  }
  ctx.body = mapUserVehicle(row)
}

export async function createUserVehicle(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as UserVehiclePayload
  const userId = toStringValue(body.userId)
  const vehicleId = toStringValue(body.vehicleId)

  if (!userId || !Types.ObjectId.isValid(userId)) {
    ctx.throw(400, 'Valid userId is required')
  }
  if (!vehicleId || !Types.ObjectId.isValid(vehicleId)) {
    ctx.throw(400, 'Valid vehicleId is required')
  }

  const [user, vehicle] = await Promise.all([
    UserModel.findById(userId).select({ _id: 1 }).lean().exec(),
    VehicleModel.findById(vehicleId).select({ _id: 1 }).lean().exec(),
  ])
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  if (!vehicle) {
    ctx.throw(404, 'Vehicle not found')
  }

  const existing = await UserVehicleModel.findOne({ userId, vehicleId }).lean().exec()
  if (existing) {
    ctx.throw(409, 'User already owns this vehicle')
  }

  const created = await UserVehicleModel.create({
    userId,
    vehicleId,
    ownedAt: new Date(),
  })

  const row = await UserVehicleModel.findById(created._id)
    .populate('userId', 'username displayName')
    .populate('vehicleId', 'identifier name description coverUrl isActive isDefault')
    .lean()
    .exec()

  ctx.status = 201
  ctx.body = mapUserVehicle(row)
}

export async function updateUserVehicle(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user vehicle id')
  }

  const current = await UserVehicleModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'User vehicle not found')
  }

  const body = (ctx.request.body ?? {}) as UserVehiclePayload
  const nextUserId = toStringValue(body.userId) ?? current.userId.toString()
  const nextVehicleId = toStringValue(body.vehicleId) ?? current.vehicleId.toString()

  if (!Types.ObjectId.isValid(nextUserId)) {
    ctx.throw(400, 'Valid userId is required')
  }
  if (!Types.ObjectId.isValid(nextVehicleId)) {
    ctx.throw(400, 'Valid vehicleId is required')
  }

  const [user, vehicle] = await Promise.all([
    UserModel.findById(nextUserId).select({ _id: 1 }).lean().exec(),
    VehicleModel.findById(nextVehicleId).select({ _id: 1 }).lean().exec(),
  ])
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  if (!vehicle) {
    ctx.throw(404, 'Vehicle not found')
  }

  const duplicated = await UserVehicleModel.findOne({
    _id: { $ne: id },
    userId: nextUserId,
    vehicleId: nextVehicleId,
  })
    .select({ _id: 1 })
    .lean()
    .exec()
  if (duplicated) {
    ctx.throw(409, 'User already owns this vehicle')
  }

  const row = await UserVehicleModel.findByIdAndUpdate(
    id,
    {
      userId: nextUserId,
      vehicleId: nextVehicleId,
    },
    { new: true },
  )
    .populate('userId', 'username displayName')
    .populate('vehicleId', 'identifier name description coverUrl isActive isDefault')
    .lean()
    .exec()

  ctx.body = mapUserVehicle(row)
}

export async function deleteUserVehicle(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user vehicle id')
  }
  await UserVehicleModel.findByIdAndDelete(id).exec()
  ctx.status = 200
  ctx.body = {}
}
