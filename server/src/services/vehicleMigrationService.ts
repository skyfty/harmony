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
