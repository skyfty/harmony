import { Types } from 'mongoose'
import { SceneSpotCategoryModel } from '@/models/SceneSpotCategory'
import { SceneSpotModel } from '@/models/SceneSpot'

export interface SceneSpotCategoryView {
  id: string
  name: string
  description: string | null
  slug: string | null
  sortOrder: number
  enabled: boolean
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return ''
  return name.trim()
}

function sanitizeDescription(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length ? t : null
}

function toView(row: any): SceneSpotCategoryView {
  return {
    id: String(row._id),
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    slug: typeof row.slug === 'string' ? row.slug : null,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
    enabled: row.enabled !== false,
    isBuiltin: row.isBuiltin === true,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

export async function listSceneSpotCategories(): Promise<SceneSpotCategoryView[]> {
  const rows = await SceneSpotCategoryModel.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean().exec()
  return (rows as any[]).map(toView)
}

export async function createSceneSpotCategory(payload: { name?: unknown; description?: unknown; slug?: unknown; sortOrder?: unknown; enabled?: unknown }): Promise<SceneSpotCategoryView> {
  const name = sanitizeName(payload.name)
  if (!name) throw new Error('Category name is required')
  const created = await SceneSpotCategoryModel.create({
    name,
    description: sanitizeDescription(payload.description),
    slug: typeof payload.slug === 'string' ? payload.slug.trim() : null,
    sortOrder: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
    enabled: payload.enabled === undefined ? true : payload.enabled !== false,
    normalizedName: name.trim().toLowerCase(),
    isBuiltin: false,
  })
  return toView(created.toObject())
}

export async function updateSceneSpotCategory(categoryId: string, payload: { name?: unknown; description?: unknown; slug?: unknown; sortOrder?: unknown; enabled?: unknown }): Promise<SceneSpotCategoryView | null> {
  if (!Types.ObjectId.isValid(categoryId)) throw new Error('Invalid category id')
  const current = await SceneSpotCategoryModel.findById(categoryId).lean().exec()
  if (!current) return null
  const nextName = payload.name === undefined ? current.name : sanitizeName(payload.name)
  if (!nextName) throw new Error('Category name is required')
  const updated = await SceneSpotCategoryModel.findByIdAndUpdate(
    categoryId,
    {
      name: nextName,
      normalizedName: nextName.trim().toLowerCase(),
      description: payload.description === undefined ? current.description ?? null : sanitizeDescription(payload.description),
      slug: payload.slug === undefined ? current.slug ?? null : (typeof payload.slug === 'string' ? payload.slug.trim() : null),
      sortOrder: payload.sortOrder === undefined ? current.sortOrder ?? 0 : Number(payload.sortOrder) || 0,
      enabled: payload.enabled === undefined ? current.enabled !== false : payload.enabled !== false,
    },
    { new: true },
  )
    .lean()
    .exec()
  return updated ? toView(updated) : null
}

export async function deleteSceneSpotCategory(categoryId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(categoryId)) throw new Error('Invalid category id')
  const current = await SceneSpotCategoryModel.findById(categoryId).lean().exec()
  if (!current) return false
  if (current.isBuiltin === true) throw new Error('Builtin category cannot be deleted')
  await SceneSpotCategoryModel.findByIdAndDelete(categoryId).exec()
  // unset category from existing scene spots
  await SceneSpotModel.updateMany({ category: new Types.ObjectId(categoryId) }, { $set: { category: null } }).exec()
  return true
}
