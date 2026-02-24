import { VehicleModel } from '@/models/Vehicle'

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
