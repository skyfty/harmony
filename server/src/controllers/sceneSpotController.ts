import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { SceneSpotModel } from '@/models/SceneSpot'

type SceneSpotMutationPayload = {
  title?: string
  coverImage?: string | null
  slides?: unknown
  description?: string | null
  address?: string | null
  order?: number
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function parseSlides(value: unknown): string[] {
  if (value == null || value === '') {
    return []
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean)
      }
    } catch {
      return trimmed
        .split(/[\n,]/g)
        .map((item) => item.trim())
        .filter(Boolean)
    }

    return []
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }

  return []
}

function mapSceneSpot(spot: any) {
  return {
    id: String(spot._id),
    sceneId: String(spot.sceneId),
    title: spot.title,
    coverImage: toNullableString(spot.coverImage),
    slides: Array.isArray(spot.slides) ? spot.slides.map((item: unknown) => String(item)) : [],
    description: typeof spot.description === 'string' ? spot.description : '',
    address: typeof spot.address === 'string' ? spot.address : '',
    order: typeof spot.order === 'number' ? spot.order : 0,
    createdAt: spot.createdAt instanceof Date ? spot.createdAt.toISOString() : new Date(spot.createdAt).toISOString(),
    updatedAt: spot.updatedAt instanceof Date ? spot.updatedAt.toISOString() : new Date(spot.updatedAt).toISOString(),
  }
}

async function ensureSceneExists(sceneId: string): Promise<void> {
  const exists = await SceneModel.exists({ _id: sceneId })
  if (!exists) {
    throw new Error('Scene not found')
  }
}

export async function listSceneSpots(ctx: Context): Promise<void> {
  const { sceneId } = ctx.params as { sceneId: string }
  if (!Types.ObjectId.isValid(sceneId)) {
    ctx.throw(400, 'Invalid scene id')
  }

  const rows = await SceneSpotModel.find({ sceneId }).sort({ order: 1, createdAt: 1 }).lean().exec()
  ctx.body = rows.map(mapSceneSpot)
}

export async function getSceneSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const row = await SceneSpotModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'Scene spot not found')
  }
  ctx.body = mapSceneSpot(row)
}

export async function createSceneSpot(ctx: Context): Promise<void> {
  const { sceneId } = ctx.params as { sceneId: string }
  if (!Types.ObjectId.isValid(sceneId)) {
    ctx.throw(400, 'Invalid scene id')
  }

  try {
    await ensureSceneExists(sceneId)
  } catch {
    ctx.throw(404, 'Scene not found')
  }

  const body = (ctx.request.body ?? {}) as SceneSpotMutationPayload
  const title = toNonEmptyString(body.title)
  if (!title) {
    ctx.throw(400, 'Scene spot title is required')
  }

  const created = await SceneSpotModel.create({
    sceneId,
    title,
    coverImage: toNullableString(body.coverImage),
    slides: parseSlides(body.slides),
    description: toNullableString(body.description) ?? '',
    address: toNullableString(body.address) ?? '',
    order: typeof body.order === 'number' ? body.order : 0,
  })

  const row = await SceneSpotModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapSceneSpot(row)
}

export async function updateSceneSpot(ctx: Context): Promise<void> {
  const { id, sceneId } = ctx.params as { id: string; sceneId: string }
  if (!Types.ObjectId.isValid(sceneId)) {
    ctx.throw(400, 'Invalid scene id')
  }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const current = await SceneSpotModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Scene spot not found')
  }
  if (String(current.sceneId) !== sceneId) {
    ctx.throw(400, 'Scene spot does not belong to the scene')
  }

  const body = (ctx.request.body ?? {}) as SceneSpotMutationPayload
  const title = body.title === undefined ? undefined : toNonEmptyString(body.title)
  if (body.title !== undefined && !title) {
    ctx.throw(400, 'Scene spot title is required')
  }

  const updated = await SceneSpotModel.findByIdAndUpdate(
    id,
    {
      title: title ?? current.title,
      coverImage: body.coverImage === undefined ? current.coverImage : toNullableString(body.coverImage),
      slides: body.slides === undefined ? current.slides : parseSlides(body.slides),
      description: body.description === undefined ? current.description : toNullableString(body.description) ?? '',
      address: body.address === undefined ? current.address : toNullableString(body.address) ?? '',
      order: body.order === undefined ? current.order : body.order,
    },
    { new: true },
  )
    .lean()
    .exec()

  ctx.body = mapSceneSpot(updated)
}

export async function deleteSceneSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  await SceneSpotModel.findByIdAndDelete(id).exec()
  ctx.status = 200
  ctx.body = {}
}
