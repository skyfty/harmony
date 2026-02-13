import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneSpotModel } from '@/models/SceneSpot'

type SpotPayload = {
  title?: string
  summary?: string | null
  coverUrl?: string | null
  order?: number
  anchor?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t.length ? t : null
}

export async function listSpots(ctx: Context): Promise<void> {
  const { scenicId } = ctx.params as { scenicId: string }
  if (!Types.ObjectId.isValid(scenicId)) {
    ctx.throw(400, 'Invalid scenic id')
  }
  const rows = await SceneSpotModel.find({ sceneId: scenicId }).sort({ order: 1, createdAt: 1 }).lean().exec()
  ctx.body = (rows || []).map((r: any) => ({
    id: r._id.toString(),
    title: r.title,
    summary: r.summary ?? '',
    coverUrl: r.coverUrl ?? null,
    order: r.order ?? 0,
    anchor: r.anchor ?? null,
    metadata: r.metadata ?? null,
  }))
}

export async function getSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid spot id')
  }
  const row = await SceneSpotModel.findById(id).lean().exec()
  if (!row) ctx.throw(404, 'Spot not found')
  ctx.body = {
    id: row._id.toString(),
    title: row.title,
    summary: row.summary ?? '',
    coverUrl: row.coverUrl ?? null,
    order: row.order ?? 0,
    anchor: row.anchor ?? null,
    metadata: row.metadata ?? null,
  }
}

export async function createSpot(ctx: Context): Promise<void> {
  const { scenicId } = ctx.params as { scenicId: string }
  if (!Types.ObjectId.isValid(scenicId)) ctx.throw(400, 'Invalid scenic id')
  const body = (ctx.request.body ?? {}) as SpotPayload
  const title = toNullableString(body.title)
  if (!title) ctx.throw(400, 'Spot title is required')
  const created = await SceneSpotModel.create({
    sceneId: scenicId,
    title,
    summary: toNullableString(body.summary) ?? '',
    coverUrl: toNullableString(body.coverUrl),
    order: typeof body.order === 'number' ? body.order : 0,
    anchor: body.anchor ?? null,
    metadata: body.metadata ?? null,
  })
  const row = await SceneSpotModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = { id: row!._id.toString(), title: row!.title }
}

export async function updateSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid spot id')
  const current = await SceneSpotModel.findById(id).lean().exec()
  if (!current) ctx.throw(404, 'Spot not found')
  const body = (ctx.request.body ?? {}) as SpotPayload
  const nextTitle = toNullableString(body.title) ?? current.title
  const updated = await SceneSpotModel.findByIdAndUpdate(
    id,
    {
      title: nextTitle,
      summary: body.summary === undefined ? current.summary : toNullableString(body.summary) ?? '',
      coverUrl: body.coverUrl === undefined ? current.coverUrl : toNullableString(body.coverUrl),
      order: body.order === undefined ? current.order : body.order,
      anchor: body.anchor === undefined ? current.anchor : body.anchor,
      metadata: body.metadata === undefined ? current.metadata : body.metadata,
    },
    { new: true },
  )
    .lean()
    .exec()
  ctx.body = {
    id: updated!._id.toString(),
    title: updated!.title,
    summary: updated!.summary ?? '',
  }
}

export async function deleteSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid spot id')
  await SceneSpotModel.findByIdAndDelete(id).exec()
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}
