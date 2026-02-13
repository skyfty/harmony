import { Types } from 'mongoose'
import { UserProjectCategoryModel } from '@/models/UserProjectCategory'
import { UserProjectModel } from '@/models/UserProject'

export interface UserProjectCategoryView {
  id: string
  userId: string
  name: string
  description: string | null
  sortOrder: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') {
    return ''
  }
  return name.trim()
}

function sanitizeDescription(description: unknown): string | null {
  if (typeof description !== 'string') {
    return null
  }
  const trimmed = description.trim()
  return trimmed.length ? trimmed : null
}

function toCategoryView(row: any): UserProjectCategoryView {
  return {
    id: row._id.toString(),
    userId: String(row.userId),
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
    enabled: row.enabled !== false,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

export async function listUserProjectCategories(userId: string): Promise<UserProjectCategoryView[]> {
  const rows = await UserProjectCategoryModel.find({ userId }).sort({ sortOrder: 1, createdAt: -1 }).lean().exec()
  return (rows as any[]).map(toCategoryView)
}

export async function createUserProjectCategory(
  userId: string,
  payload: { description?: unknown; enabled?: unknown; name?: unknown; sortOrder?: unknown },
): Promise<UserProjectCategoryView> {
  const name = sanitizeName(payload.name)
  if (!name) {
    throw new Error('Category name is required')
  }
  const sortOrder = Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0
  const created = await UserProjectCategoryModel.create({
    userId,
    name,
    description: sanitizeDescription(payload.description),
    sortOrder,
    enabled: payload.enabled === undefined ? true : payload.enabled !== false,
    normalizedName: normalizeName(name),
  })
  return toCategoryView(created.toObject())
}

export async function updateUserProjectCategory(
  categoryId: string,
  userId: string,
  payload: { description?: unknown; enabled?: unknown; name?: unknown; sortOrder?: unknown },
): Promise<UserProjectCategoryView | null> {
  if (!Types.ObjectId.isValid(categoryId)) {
    throw new Error('Invalid category id')
  }
  const current = await UserProjectCategoryModel.findOne({ _id: categoryId, userId }).lean().exec()
  if (!current) {
    return null
  }
  const nextNameRaw = payload.name === undefined ? current.name : sanitizeName(payload.name)
  if (!nextNameRaw) {
    throw new Error('Category name is required')
  }
  const updated = await UserProjectCategoryModel.findOneAndUpdate(
    { _id: categoryId, userId },
    {
      name: nextNameRaw,
      normalizedName: normalizeName(nextNameRaw),
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

export async function deleteUserProjectCategory(categoryId: string, userId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(categoryId)) {
    throw new Error('Invalid category id')
  }
  const deleted = await UserProjectCategoryModel.findOneAndDelete({ _id: categoryId, userId }).lean().exec()
  if (!deleted) {
    return false
  }

  await UserProjectModel.updateMany(
    { userId, categoryId },
    {
      $set: {
        categoryId: null,
        'document.categoryId': null,
      },
    },
  ).exec()
  return true
}
