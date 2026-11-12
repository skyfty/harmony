import { ControllableAssetModel } from '@/models/ControllableAsset'
import { ProductModel } from '@/models/Product'
import { ProductCategoryModel } from '@/models/ProductCategory'
import { UserControllableSelectionModel } from '@/models/UserControllableSelection'
import { UserProductModel } from '@/models/UserProduct'
import { connectDatabase, disconnectDatabase } from '@/config/database'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  await connectDatabase()

  try {
    const characterAssets = await ControllableAssetModel.find({ type: 'character' })
      .select({ _id: 1, productId: 1 })
      .lean()
      .exec()
    const assetProductIds = characterAssets
      .map((asset) => asset.productId)
      .filter(Boolean)
    const products = await ProductModel.find({
      $or: [
        { controllableType: 'character' },
        ...(assetProductIds.length ? [{ _id: { $in: assetProductIds } }] : []),
      ],
    })
      .select({ _id: 1, categoryId: 1, name: 1 })
      .lean()
      .exec()
    const productIds = products.map((product) => product._id)
    const categoryIds = Array.from(new Set(
      products
        .map((product) => product.categoryId?.toString?.() ?? '')
        .filter(Boolean),
    ))
    const [ownershipCount, selectionCount] = await Promise.all([
      UserProductModel.countDocuments({ productId: { $in: productIds } }),
      UserControllableSelectionModel.countDocuments({
        $or: [
          { controllableType: 'character' },
          { controllableAssetId: { $in: characterAssets.map((asset) => asset._id) } },
        ],
      }),
    ])

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      characterAssets: characterAssets.length,
      characterProducts: products.map((product) => ({
        id: product._id.toString(),
        name: product.name,
      })),
      ownershipRecords: ownershipCount,
      selectionRecords: selectionCount,
      affectedCategories: categoryIds,
    }, null, 2))

    if (!apply) {
      console.log('No data changed. Re-run with --apply to reset character products.')
      return
    }

    await Promise.all([
      UserControllableSelectionModel.deleteMany({
        $or: [
          { controllableType: 'character' },
          { controllableAssetId: { $in: characterAssets.map((asset) => asset._id) } },
        ],
      }).exec(),
      UserProductModel.deleteMany({ productId: { $in: productIds } }).exec(),
    ])

    if (characterAssets.length) {
      await ControllableAssetModel.deleteMany({
        _id: { $in: characterAssets.map((asset) => asset._id) },
      }).exec()
    }

    if (productIds.length) {
      await ProductModel.updateMany(
        { _id: { $in: productIds } },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            categoryId: null,
          },
          $unset: {
            controllableAssetId: 1,
            controllableType: 1,
            characterGender: 1,
          },
        },
      ).exec()
    }

    for (const categoryId of categoryIds) {
      const activeProductCount = await ProductModel.countDocuments({
        categoryId,
        isDeleted: { $ne: true },
      })
      if (!activeProductCount) {
        await ProductCategoryModel.deleteOne({ _id: categoryId }).exec()
      }
    }

    await ProductModel.collection.createIndex(
      { characterGender: 1 },
      { unique: true, sparse: true, name: 'characterGender_1' },
    )

    console.log('Character products, assets, ownership records, and selections were reset.')
  } finally {
    await disconnectDatabase()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
