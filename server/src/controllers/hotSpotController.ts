import type { Context } from 'koa'
import { Types } from 'mongoose'
import { listHotSpots, createHotSpot, updateHotSpotOrder, deleteHotSpot } from '@/services/hotSpotService'

export async function listHotSpotsHandler(ctx: Context): Promise<void> {
  ctx.body = await listHotSpots()
}

export async function createHotSpotHandler(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  try {
    const created = await createHotSpot(body)
    ctx.status = 201
    ctx.body = created
  } catch (error) {
    const message = (error as { message?: string }).message ?? 'Invalid payload'
    ctx.throw(400, message)
  }
}

export async function updateHotSpotHandler(ctx: Context): Promise<void> {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (!id || !Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const updated = await updateHotSpotOrder(id, body.order)
  if (!updated) ctx.throw(404, 'HotSpot not found')
  ctx.body = updated
}

export async function deleteHotSpotHandler(ctx: Context): Promise<void> {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (!id || !Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const ok = await deleteHotSpot(id)
  if (!ok) ctx.throw(404, 'Not found')
  ctx.status = 200
  ctx.body = {}
}
