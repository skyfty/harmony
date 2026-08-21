import type { Context } from 'koa'
import { Types } from 'mongoose'
import {
  createSkinCategory,
  deleteSkinCategory,
  getSkinCategoryById,
  listSkinCategories,
  updateSkinCategory,
} from '@/services/skinCategoryService'

export async function listCategories(ctx: Context): Promise<void> {
  const { enabled } = ctx.query as Record<string, string>
  ctx.body = await listSkinCategories({ onlyEnabled: enabled === 'true' })
}

export async function getCategory(ctx: Context): Promise<void> {
  const categoryId = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  const category = await getSkinCategoryById(categoryId)
  if (!category) {
    ctx.throw(404, 'Skin category not found')
  }
  ctx.body = category
}

export async function createCategory(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  try {
    const category = await createSkinCategory(body)
    ctx.status = 201
    ctx.body = category
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code === 11000) {
      ctx.throw(409, '分类名称或槽位已存在')
    }
    const message = (error as { message?: string }).message ?? 'Invalid category payload'
    ctx.throw(400, message)
  }
}

export async function updateCategory(ctx: Context): Promise<void> {
  const categoryId = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (!categoryId || !Types.ObjectId.isValid(categoryId)) {
    ctx.throw(400, 'Invalid category id')
  }
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  try {
    const category = await updateSkinCategory(categoryId, body)
    if (!category) {
      ctx.throw(404, 'Skin category not found')
    }
    ctx.body = category
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code === 11000) {
      ctx.throw(409, '分类名称已存在')
    }
    const message = (error as { message?: string }).message ?? 'Invalid category payload'
    ctx.throw(400, message)
  }
}

export async function removeCategory(ctx: Context): Promise<void> {
  const categoryId = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (!categoryId || !Types.ObjectId.isValid(categoryId)) {
    ctx.throw(400, 'Invalid category id')
  }
  try {
    const deleted = await deleteSkinCategory(categoryId)
    if (!deleted) {
      ctx.throw(404, 'Skin category not found')
    }
  } catch (error) {
    const message = (error as { message?: string }).message ?? '删除失败'
    ctx.throw(400, message)
  }
  ctx.body = {}
}
