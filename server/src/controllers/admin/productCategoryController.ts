import type { Context } from 'koa'
import { Types } from 'mongoose'
import {
  createProductCategory,
  deleteProductCategory,
  listProductCategories,
  updateProductCategory,
} from '@/services/productCategoryService'

export async function listCategories(ctx: Context): Promise<void> {
  ctx.body = await listProductCategories()
}

export async function createCategory(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  try {
    const category = await createProductCategory(body)
    ctx.status = 201
    ctx.body = category
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code === 11000) {
      ctx.throw(409, 'Category name already exists')
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
    const category = await updateProductCategory(categoryId, body)
    if (!category) {
      ctx.throw(404, 'Category not found')
    }
    ctx.body = category
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code === 11000) {
      ctx.throw(409, 'Category name already exists')
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
  const deleted = await deleteProductCategory(categoryId)
  if (!deleted) {
    ctx.throw(404, 'Category not found')
  }
  ctx.status = 200
  ctx.body = {}
}
