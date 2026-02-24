import type { Context } from 'koa'
import { Types } from 'mongoose'
import { AppUserModel } from '@/models/AppUser'
import { VehicleModel } from '@/models/Vehicle'
import { UserVehicleModel } from '@/models/UserVehicle'
import { ensureUserId, getOptionalUserId } from './utils'

function mapVehicle(row: any, owned: boolean, isCurrent: boolean) {
  return {
    id: row._id.toString(),
    identifier: String(row.identifier ?? ''),
    name: row.name,
    description: row.description ?? '',
    coverUrl: row.coverUrl ?? '',
    isActive: row.isActive !== false,
    productId: row.productId?.toString?.() ?? null,
    owned,
    isCurrent,
  }
}

function mapUserVehicle(row: any) {
  const vehicle = row.vehicleId
  return {
    id: row._id.toString(),
    vehicleId: vehicle?._id?.toString?.() ?? row.vehicleId?.toString?.() ?? '',
    ownedAt: row.ownedAt?.toISOString?.() ?? null,
    vehicle: vehicle
      ? {
          id: vehicle?._id?.toString?.() ?? '',
          identifier: String(vehicle.identifier ?? ''),
          name: vehicle.name ?? '',
          description: vehicle.description ?? '',
          coverUrl: vehicle.coverUrl ?? '',
          isActive: vehicle.isActive !== false,
        }
      : null,
  }
}

export async function listVehicles(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { keyword } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = { isActive: true }
  if (keyword?.trim()) {
    const pattern = new RegExp(keyword.trim(), 'i')
    filter.$or = [{ identifier: pattern }, { name: pattern }, { description: pattern }]
  }

  const vehicles = await VehicleModel.find(filter).sort({ createdAt: -1 }).lean().exec()

  let ownedSet = new Set<string>()
  let currentVehicleId = ''
  if (userId && Types.ObjectId.isValid(userId) && vehicles.length) {
    const [userVehicles, user] = await Promise.all([
      UserVehicleModel.find({ userId, vehicleId: { $in: vehicles.map((item) => item._id) } })
      .select({ vehicleId: 1 })
      .lean()
      .exec(),
      AppUserModel.findById(userId).select({ currentVehicleId: 1 }).lean().exec(),
    ])
    ownedSet = new Set(userVehicles.map((item: any) => item.vehicleId.toString()))
    currentVehicleId = user?.currentVehicleId?.toString?.() ?? ''
  }

  ctx.body = {
    total: vehicles.length,
    vehicles: vehicles.map((row) => {
      const vehicleId = row._id.toString()
      return mapVehicle(row, ownedSet.has(vehicleId), currentVehicleId === vehicleId)
    }),
  }
}

export async function listUserVehicles(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const rows = await UserVehicleModel.find({ userId })
    .populate('vehicleId', 'identifier name description coverUrl isActive')
    .sort({ ownedAt: -1, createdAt: -1 })
    .lean()
    .exec()

  ctx.body = {
    total: rows.length,
    userVehicles: (rows as any[]).map(mapUserVehicle),
  }
}

export async function setCurrentVehicle(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid vehicle id')
  }

  const [vehicle, ownership] = await Promise.all([
    VehicleModel.findById(id).lean().exec(),
    UserVehicleModel.findOne({ userId, vehicleId: id }).lean().exec(),
  ])

  if (!vehicle || vehicle.isActive === false) {
    ctx.throw(404, 'Vehicle not found')
  }
  if (!ownership) {
    ctx.throw(403, 'Vehicle not owned')
  }

  await AppUserModel.updateOne(
    { _id: userId },
    { $set: { currentVehicleId: new Types.ObjectId(id) } },
  ).exec()

  ctx.body = {
    success: true,
    currentVehicleId: id,
  }
}
