import { Types } from 'mongoose'
import { SkinCategoryModel } from '@/models/SkinCategory'
import { SkinModel } from '@/models/Skin'
import { UserSkinSelectionModel } from '@/models/UserSkinSelection'
import type { SkinSlotKey } from '@/types/models'

export const SKIN_SLOT_KEYS: SkinSlotKey[] = [
  'hatAssetId',
  'glassesAssetId',
  'hairAssetId',
  'topAssetId',
  'pantsAssetId',
  'shoesAssetId',
]

const DEFAULT_SKIN_CATEGORIES: Array<{ name: string; slotKey: SkinSlotKey; description: string; sortOrder: number }> = [
  { name: '帽子 Hat', slotKey: 'hatAssetId', description: '帽子皮肤', sortOrder: 10 },
  { name: '眼镜 Glasses', slotKey: 'glassesAssetId', description: '眼镜皮肤', sortOrder: 20 },
  { name: '头发 Hair', slotKey: 'hairAssetId', description: '头发皮肤', sortOrder: 30 },
  { name: '上衣 Top', slotKey: 'topAssetId', description: '上衣皮肤', sortOrder: 40 },
  { name: '裤子 Pants', slotKey: 'pantsAssetId', description: '裤子皮肤', sortOrder: 50 },
  { name: '鞋子 Shoes', slotKey: 'shoesAssetId', description: '鞋子皮肤', sortOrder: 60 },
]

export interface SkinCategoryView {
  id: string
  name: string
  slotKey: SkinSlotKey
  sortOrder: number
  enabled: boolean
  description: string | null
  isBuiltin: boolean
  createdAt: string | null
  updatedAt: string | null
}

function sanitizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeDescription(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toCategoryView(row: any): SkinCategoryView {
  return {
    id: row._id.toString(),
    name: String(row.name),
    slotKey: row.slotKey as SkinSlotKey,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
    enabled: row.enabled !== false,
    description: typeof row.description === 'string' ? row.description : null,
    isBuiltin: row.isBuiltin === true,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
  }
}

export async function listSkinCategories(options: { onlyEnabled?: boolean } = {}): Promise<SkinCategoryView[]> {
  const filter = options.onlyEnabled ? { enabled: { $ne: false } } : {}
  const rows = await SkinCategoryModel.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean().exec()
  return (rows as any[]).map(toCategoryView)
}

export async function getSkinCategoryById(id: string): Promise<SkinCategoryView | null> {
  if (!Types.ObjectId.isValid(id)) {
    return null
  }
  const row = await SkinCategoryModel.findById(id).lean().exec()
  return row ? toCategoryView(row) : null
}

export async function createSkinCategory(payload: {
  description?: unknown
  enabled?: unknown
  name?: unknown
  slotKey?: unknown
  sortOrder?: unknown
}): Promise<SkinCategoryView> {
  const name = sanitizeName(payload.name)
  if (!name) {
    throw new Error('Category name is required')
  }
  const slotKey = typeof payload.slotKey === 'string' ? payload.slotKey.trim() : ''
  if (!SKIN_SLOT_KEYS.includes(slotKey as SkinSlotKey)) {
    throw new Error(`slotKey must be one of: ${SKIN_SLOT_KEYS.join(', ')}`)
  }
  const sortOrder = Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0
  const created = await SkinCategoryModel.create({
    name,
    slotKey: slotKey as SkinSlotKey,
    sortOrder,
    enabled: payload.enabled === undefined ? true : payload.enabled !== false,
    description: sanitizeDescription(payload.description),
    isBuiltin: false,
  })
  return toCategoryView(created.toObject())
}

export async function updateSkinCategory(
  categoryId: string,
  payload: { description?: unknown; enabled?: unknown; name?: unknown; sortOrder?: unknown },
): Promise<SkinCategoryView | null> {
  if (!Types.ObjectId.isValid(categoryId)) {
    throw new Error('Invalid category id')
  }
  const current = await SkinCategoryModel.findById(categoryId).lean().exec()
  if (!current) {
    return null
  }
  const nextName = payload.name === undefined ? current.name : sanitizeName(payload.name)
  if (!nextName) {
    throw new Error('Category name is required')
  }
  const updated = await SkinCategoryModel.findByIdAndUpdate(
    categoryId,
    {
      name: nextName,
      description: payload.description === undefined ? current.description ?? null : sanitizeDescription(payload.description),
      sortOrder: payload.sortOrder === undefined ? current.sortOrder ?? 0 : Number(payload.sortOrder) || 0,
      enabled: payload.enabled === undefined ? current.enabled !== false : payload.enabled !== false,
    },
    { new: true },
  )
    .lean()
    .exec()
  return updated ? toCategoryView(updated) : null
}

export async function deleteSkinCategory(categoryId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(categoryId)) {
    throw new Error('Invalid category id')
  }
  const current = await SkinCategoryModel.findById(categoryId).lean().exec()
  if (!current) {
    return false
  }
  const hasSkins = await SkinModel.exists({ categoryId: current._id })
  if (hasSkins) {
    throw new Error('该分类下存在皮肤，请先删除分类下的皮肤')
  }
  await SkinCategoryModel.findByIdAndDelete(categoryId).exec()
  await UserSkinSelectionModel.deleteMany({ skinCategoryId: current._id }).exec()
  return true
}

export async function ensureDefaultSkinCategories(): Promise<void> {
  for (const seed of DEFAULT_SKIN_CATEGORIES) {
    await SkinCategoryModel.updateOne(
      { slotKey: seed.slotKey },
      {
        $setOnInsert: {
          name: seed.name,
          description: seed.description,
          sortOrder: seed.sortOrder,
          enabled: true,
        },
        $set: {
          isBuiltin: true,
        },
      },
      { upsert: true },
    ).exec()
  }
}
