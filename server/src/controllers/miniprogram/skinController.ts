import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SkinModel } from '@/models/Skin'
import { SkinCategoryModel } from '@/models/SkinCategory'
import { UserProductModel } from '@/models/UserProduct'
import { UserSkinSelectionModel } from '@/models/UserSkinSelection'
import { ensureUserId } from './utils'

function mapSkin(row: any, category?: any) {
  return {
    id: row._id.toString(),
    identifier: String(row.identifier ?? ''),
    name: row.name,
    categoryId: row.categoryId?.toString?.() ?? null,
    categoryName: category?.name ?? null,
    slotKey: category?.slotKey ?? null,
    sortOrder: Number(row.sortOrder) || 0,
    description: row.description ?? '',
    prefabUrl: row.prefabUrl ?? '',
    isActive: row.isActive !== false,
    productId: row.productId?.toString?.() ?? null,
  }
}

export async function listUserSkinSelections(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const rows = await UserSkinSelectionModel.find({ userId }).lean().exec()
  if (!rows.length) {
    ctx.body = { selections: [] }
    return
  }
  const skinIds = rows.map((row: any) => row.skinId)
  const categoryIds = rows.map((row: any) => row.skinCategoryId)
  const [skins, categories] = await Promise.all([
    SkinModel.find({ _id: { $in: skinIds }, isActive: true }).lean().exec(),
    SkinCategoryModel.find({ _id: { $in: categoryIds }, enabled: { $ne: false } }).lean().exec(),
  ])
  const skinsById = new Map(skins.map((skin: any) => [skin._id.toString(), skin]))
  const categoriesById = new Map(categories.map((category: any) => [category._id.toString(), category]))
  ctx.body = {
    selections: rows
      .map((row: any) => {
        const skin = skinsById.get(row.skinId.toString())
        if (!skin) {
          return null
        }
        const category = categoriesById.get(row.skinCategoryId.toString()) ?? null
        return {
          categoryId: row.skinCategoryId.toString(),
          skin: mapSkin(skin, category),
        }
      })
      .filter(Boolean),
  }
}

export async function setCurrentSkin(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const id = String(ctx.params.id ?? '')
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid skin id')
  }
  const skin = await SkinModel.findById(id).lean().exec()
  if (!skin || skin.isActive === false) {
    ctx.throw(404, 'Skin not found')
  }
  const owned = Boolean(await UserProductModel.exists({ userId, productId: skin.productId }))
  if (!owned) {
    ctx.throw(403, 'Skin not owned')
  }
  const category = skin?.categoryId ? await SkinCategoryModel.findById(skin.categoryId).lean().exec() : null
  await UserSkinSelectionModel.findOneAndUpdate(
    { userId, skinCategoryId: skin!.categoryId },
    { userId, skinCategoryId: skin!.categoryId, skinId: new Types.ObjectId(id) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec()
  ctx.body = { success: true, categoryId: skin!.categoryId.toString(), skin: mapSkin(skin, category) }
}
