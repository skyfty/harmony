import type { Context } from 'koa'
import { Types } from 'mongoose'
import { VehicleModel } from '@/models/Vehicle'
import { UserVehicleModel } from '@/models/UserVehicle'
import { ensureUserId, getOptionalUserId } from './utils'

function mapVehicle(row: any, owned: boolean) {
  return {
    id: row._id.toString(),
    name: row.name,
    description: row.description ?? '',
    imageUrl: row.imageUrl ?? '',
    isActive: row.isActive !== false,
    owned,
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
          name: vehicle.name ?? '',
          description: vehicle.description ?? '',
          imageUrl: vehicle.imageUrl ?? '',
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
    filter.$or = [{ name: pattern }, { description: pattern }]
  }

  const vehicles = await VehicleModel.find(filter).sort({ createdAt: -1 }).lean().exec()

  let ownedSet = new Set<string>()
  if (userId && Types.ObjectId.isValid(userId) && vehicles.length) {
    const userVehicles = await UserVehicleModel.find({ userId, vehicleId: { $in: vehicles.map((item) => item._id) } })
      .select({ vehicleId: 1 })
      .lean()
      .exec()
    ownedSet = new Set(userVehicles.map((item: any) => item.vehicleId.toString()))
  }

  ctx.body = {
    total: vehicles.length,
    vehicles: vehicles.map((row) => mapVehicle(row, ownedSet.has(row._id.toString()))),
  }
}

export async function listUserVehicles(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const rows = await UserVehicleModel.find({ userId })
    .populate('vehicleId', 'name description imageUrl isActive')
    .sort({ ownedAt: -1, createdAt: -1 })
    .lean()
    .exec()

  ctx.body = {
    total: rows.length,
    userVehicles: (rows as any[]).map(mapUserVehicle),
  }
}
