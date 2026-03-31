import type { Context } from 'koa'
import { Types } from 'mongoose'
import { listFeaturedSpots, createFeaturedSpot, updateFeaturedSpotOrder, deleteFeaturedSpot } from '@/services/featuredSpotService'

export async function listFeaturedSpotsHandler(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '10' } = ctx.query as Record<string, string>
  const toPositiveNumber = (value: unknown, fallback: number): number => {
    const parsed = Number(value)
    if (Number.isNaN(parsed) || parsed <= 0) return fallback
    return parsed
  }
  const pageNumber = Math.max(toPositiveNumber(page, 1), 1)
  const limit = Math.min(Math.max(toPositiveNumber(pageSize, 10), 1), 100)

  const rows = await listFeaturedSpots()
  const total = Array.isArray(rows) ? rows.length : 0
  const start = (pageNumber - 1) * limit
  const data = Array.isArray(rows) ? rows.slice(start, start + limit) : []

  ctx.body = {
    data,
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function createFeaturedSpotHandler(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  try {
    const created = await createFeaturedSpot(body)
    ctx.status = 201
    ctx.body = created
  } catch (error) {
    const message = (error as { message?: string }).message ?? 'Invalid payload'
    ctx.throw(400, message)
  }
}

export async function updateFeaturedSpotHandler(ctx: Context): Promise<void> {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (!id || !Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const updated = await updateFeaturedSpotOrder(id, body.order)
  if (!updated) ctx.throw(404, 'FeaturedSpot not found')
  ctx.body = updated
}

export async function deleteFeaturedSpotHandler(ctx: Context): Promise<void> {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (!id || !Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const ok = await deleteFeaturedSpot(id)
  if (!ok) ctx.throw(404, 'Not found')
  ctx.status = 200
  ctx.body = {}
}
