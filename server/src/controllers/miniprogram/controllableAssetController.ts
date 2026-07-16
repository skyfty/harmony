import type { Context } from 'koa'
import { Types } from 'mongoose'
import { ControllableAssetModel } from '@/models/ControllableAsset'
import { ProductModel } from '@/models/Product'
import { UserProductModel } from '@/models/UserProduct'
import { UserControllableSelectionModel } from '@/models/UserControllableSelection'
import { ensureUserId, getOptionalUserId } from './utils'
import type { ControllableAssetType } from '@/types/models'

const TYPES: ControllableAssetType[] = ['vehicle', 'character', 'ship', 'aircraft']

function mapAsset(row: any, owned: boolean, selected: boolean, product?: any) {
  return {
    id: row._id.toString(),
    identifier: String(row.identifier ?? ''),
    name: row.name,
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
          price: product.price,
          categoryId: product.categoryId?.toString?.() ?? null,
        }
      : null,
    runtimeConfig: row.runtimeConfig ?? null,
    owned,
    isSelected: selected,
  }
}

export async function listControllableAssets(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { keyword, type, ownedOnly } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = { isActive: true }
  if (type && TYPES.includes(type as ControllableAssetType)) {
    filter.type = type
  }
  if (keyword?.trim()) {
    const pattern = new RegExp(keyword.trim(), 'i')
    filter.$or = [{ identifier: pattern }, { name: pattern }, { description: pattern }]
  }

  const rows = await ControllableAssetModel.find(filter).sort({ type: 1, sortOrder: 1, createdAt: -1 }).lean().exec()
  const products = await ProductModel.find({ _id: { $in: rows.map((row: any) => row.productId) }, isDeleted: { $ne: true } }).lean().exec()
  const productsById = new Map(products.map((product: any) => [product._id.toString(), product]))
  const productIds = products.map((product: any) => product._id)
  const ownedIds = userId ? await UserProductModel.find({ userId, productId: { $in: productIds } }).select({ productId: 1 }).lean().exec() : []
  const ownedProductIds = new Set(ownedIds.map((entry: any) => entry.productId.toString()))
  const selectedRows = userId ? await UserControllableSelectionModel.find({ userId }).select({ controllableType: 1, controllableAssetId: 1 }).lean().exec() : []
  const selectedByType = new Map(selectedRows.map((entry: any) => [entry.controllableType, entry.controllableAssetId.toString()]))

  const data = rows
    .filter((row: any) => productsById.has(row.productId?.toString?.() ?? ''))
    .map((row: any) => {
      const product = productsById.get(row.productId.toString())
      const owned = ownedProductIds.has(row.productId.toString()) || row.isDefault === true
      return mapAsset(row, owned, selectedByType.get(row.type) === row._id.toString(), product)
    })
    .filter((row: any) => ownedOnly !== 'true' || row.owned)

  ctx.body = { total: data.length, assets: data }
}

export async function listUserControllableSelections(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const rows = await UserControllableSelectionModel.find({ userId }).populate('controllableAssetId').lean().exec()
  ctx.body = {
    selections: rows.map((row: any) => ({
      type: row.controllableType,
      asset: row.controllableAssetId ? mapAsset(row.controllableAssetId, true, true) : null,
    })),
  }
}

export async function setCurrentControllableAsset(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const id = String(ctx.params.id ?? '')
  const asset = await ControllableAssetModel.findById(id).lean().exec()
  if (!asset || asset.isActive === false) {
    ctx.throw(404, 'Controllable asset not found')
  }
  const product = asset?.productId ? await ProductModel.findById(asset.productId).lean().exec() : null
  const owned = asset?.isDefault === true || Boolean(await UserProductModel.exists({ userId, productId: asset?.productId }))
  if (!owned) {
    ctx.throw(403, 'Controllable asset not owned')
  }
  await UserControllableSelectionModel.findOneAndUpdate(
    { userId, controllableType: asset!.type },
    { userId, controllableType: asset!.type, controllableAssetId: new Types.ObjectId(id) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec()
  ctx.body = { success: true, type: asset!.type, asset: mapAsset(asset, true, true, product) }
}
