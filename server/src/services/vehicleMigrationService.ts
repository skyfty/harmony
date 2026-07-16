import { VehicleModel } from '@/models/Vehicle'
import { ControllableAssetModel } from '@/models/ControllableAsset'
import { AppUserModel } from '@/models/AppUser'
import { UserControllableSelectionModel } from '@/models/UserControllableSelection'
import { ProductModel } from '@/models/Product'

export async function ensureVehicleCoverUrlField(): Promise<void> {
  const legacyRows = await VehicleModel.find({
    $or: [
      { coverUrl: { $exists: false } },
      { coverUrl: null },
      { coverUrl: '' },
    ],
    imageUrl: { $exists: true, $nin: [null, ''] },
  })
    .select({ _id: 1, imageUrl: 1 })
    .lean()
    .exec()

  if (legacyRows.length) {
    await VehicleModel.bulkWrite(
      legacyRows.map((row: any) => ({
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: { coverUrl: row.imageUrl },
            $unset: { imageUrl: '' },
          },
        },
      })),
      { ordered: false },
    )
  }

  await VehicleModel.updateMany(
    {
      coverUrl: { $exists: true, $ne: null },
      imageUrl: { $exists: true },
    },
    {
      $unset: { imageUrl: '' },
    },
  ).exec()
}

export async function ensureVehicleIdentifierField(): Promise<void> {
  const rows = await VehicleModel.find({
    $or: [
      { identifier: { $exists: false } },
      { identifier: null },
      { identifier: '' },
      { identifier: { $type: 'int' } },
      { identifier: { $type: 'long' } },
      { identifier: { $type: 'double' } },
      { identifier: { $type: 'decimal' } },
    ],
  })
    .select({ _id: 1, identifier: 1 })
    .lean()
    .exec()

  if (!rows.length) {
    return
  }

  await VehicleModel.bulkWrite(
    rows.map((row: any) => {
      const rawIdentifier = row.identifier
      const identifier =
        typeof rawIdentifier === 'number'
          ? String(rawIdentifier)
          : typeof rawIdentifier === 'string' && rawIdentifier.trim().length
            ? rawIdentifier.trim()
            : row._id.toString()
      return {
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: { identifier },
          },
        },
      }
    }),
    { ordered: false },
  )
}

export async function ensureVehicleSortOrderField(): Promise<void> {
  await VehicleModel.updateMany(
    {
      $or: [
        { sortOrder: { $exists: false } },
        { sortOrder: null },
      ],
    },
    {
      $set: { sortOrder: 0 },
    },
  ).exec()
}

/**
 * Copies legacy vehicle records into the generic controllable-asset catalog.
 * The legacy collections remain intact so older clients can continue to work.
 */
export async function migrateVehiclesToControllableAssets(): Promise<void> {
  const vehicles = await VehicleModel.find({}).lean().exec()
  for (const vehicle of vehicles as any[]) {
    if (!vehicle.productId) continue
    const product = await ProductModel.findById(vehicle.productId).select({ _id: 1 }).lean().exec()
    if (!product) continue
    const existing = await ControllableAssetModel.findOne({
      $or: [{ productId: vehicle.productId }, { type: 'vehicle', identifier: String(vehicle.identifier) }],
    }).select({ _id: 1 }).lean().exec()
    if (existing) {
      await ProductModel.updateOne({ _id: vehicle.productId }, { $set: { controllableAssetId: existing._id, controllableType: 'vehicle' } }).exec()
      continue
    }
    const asset = await ControllableAssetModel.create({
      identifier: String(vehicle.identifier),
      name: vehicle.name,
      type: 'vehicle',
      sortOrder: vehicle.sortOrder ?? 0,
      description: vehicle.description ?? '',
      coverUrl: vehicle.coverUrl ?? '',
      prefabUrl: vehicle.prefabUrl ?? '',
      isActive: vehicle.isActive !== false,
      isDefault: vehicle.isDefault === true,
      productId: vehicle.productId,
      runtimeConfig: {
        maxSpeed: vehicle.maxSpeed,
        acceleration: vehicle.acceleration,
        braking: vehicle.braking,
        handling: vehicle.handling,
        mass: vehicle.mass,
        drag: vehicle.drag,
      },
      metadata: { migratedFrom: 'Vehicle', legacyVehicleId: vehicle._id.toString() },
    })
    await ProductModel.updateOne({ _id: vehicle.productId }, { $set: { controllableAssetId: asset._id, controllableType: 'vehicle' } }).exec()
  }

  const users = await AppUserModel.find({ currentVehicleId: { $exists: true, $ne: null } })
    .select({ _id: 1, currentVehicleId: 1 }).lean().exec()
  for (const user of users as any[]) {
    const vehicle = await VehicleModel.findById(user.currentVehicleId).select({ _id: 1 }).lean().exec()
    if (!vehicle) continue
    const asset = await ControllableAssetModel.findOne({
      type: 'vehicle',
      'metadata.legacyVehicleId': vehicle._id.toString(),
    }).select({ _id: 1 }).lean().exec()
    if (!asset) continue
    await UserControllableSelectionModel.updateOne(
      { userId: user._id, controllableType: 'vehicle' },
      { $set: { controllableAssetId: asset._id } },
      { upsert: true },
    ).exec()
  }
}
