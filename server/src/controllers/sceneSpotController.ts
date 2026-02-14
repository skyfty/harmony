import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { SceneSpotModel } from '@/models/SceneSpot'

type SceneSpotMutationPayload = {
  sceneId?: string
  title?: string
  coverImage?: string | null
  slides?: unknown
  description?: string | null
  address?: string | null
  order?: number
  isFeatured?: boolean
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

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true
    }
    if (value === 0) {
      return false
    }
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === '1' || normalized === 'true') {
      return true
    }
    if (normalized === '0' || normalized === 'false') {
      return false
    }
  }

  return null
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
    isFeatured: spot.isFeatured === true,
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

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

export async function listSceneSpots(ctx: Context): Promise<void> {
  const { keyword, page = '1', pageSize = '10', sceneId } = ctx.query as Record<string, string>
  const pageNumber = Math.max(toPositiveNumber(page, 1), 1)
  const limit = Math.min(Math.max(toPositiveNumber(pageSize, 10), 1), 100)
  const normalizedKeyword = toNonEmptyString(keyword)
  const normalizedSceneId = toNonEmptyString(sceneId)

  const query: Record<string, unknown> = {}

  if (normalizedSceneId) {
    if (!Types.ObjectId.isValid(normalizedSceneId)) {
      ctx.throw(400, 'Invalid scene id')
    }
    query.sceneId = normalizedSceneId
  }

  if (normalizedKeyword) {
    const regex = new RegExp(normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    query.$or = [{ title: regex }, { description: regex }, { address: regex }]
  }

  const [rows, total] = await Promise.all([
    SceneSpotModel.find(query)
      .sort({ order: 1, createdAt: 1 })
      .skip((pageNumber - 1) * limit)
      .limit(limit)
      .lean()
      .exec(),
    SceneSpotModel.countDocuments(query).exec(),
  ])

  ctx.body = {
    data: rows.map(mapSceneSpot),
    page: pageNumber,
    pageSize: limit,
    total,
  }
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
  const body = (ctx.request.body ?? {}) as SceneSpotMutationPayload
  const sceneId = toNonEmptyString(body.sceneId)
  if (!sceneId) {
    ctx.throw(400, 'Scene id is required')
  }
  if (!Types.ObjectId.isValid(sceneId)) {
    ctx.throw(400, 'Invalid scene id')
  }

  try {
    await ensureSceneExists(sceneId)
  } catch {
    ctx.throw(404, 'Scene not found')
  }

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
    isFeatured: toBoolean(body.isFeatured) ?? false,
  })

  const row = await SceneSpotModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapSceneSpot(row)
}

export async function updateSceneSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const current = await SceneSpotModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Scene spot not found')
  }

  const body = (ctx.request.body ?? {}) as SceneSpotMutationPayload
  const nextIsFeatured = toBoolean(body.isFeatured)
  const title = body.title === undefined ? undefined : toNonEmptyString(body.title)
  if (body.title !== undefined && !title) {
    ctx.throw(400, 'Scene spot title is required')
  }

  const nextSceneId = body.sceneId === undefined ? String(current.sceneId) : toNonEmptyString(body.sceneId)
  if (!nextSceneId) {
    ctx.throw(400, 'Scene id is required')
  }
  if (!Types.ObjectId.isValid(nextSceneId)) {
    ctx.throw(400, 'Invalid scene id')
  }

  if (body.sceneId !== undefined && nextSceneId !== String(current.sceneId)) {
    try {
      await ensureSceneExists(nextSceneId)
    } catch {
      ctx.throw(404, 'Scene not found')
    }
  }

  const updated = await SceneSpotModel.findByIdAndUpdate(
    id,
    {
      sceneId: nextSceneId,
      title: title ?? current.title,
      coverImage: body.coverImage === undefined ? current.coverImage : toNullableString(body.coverImage),
      slides: body.slides === undefined ? current.slides : parseSlides(body.slides),
      description: body.description === undefined ? current.description : toNullableString(body.description) ?? '',
      address: body.address === undefined ? current.address : toNullableString(body.address) ?? '',
      order: body.order === undefined ? current.order : body.order,
      isFeatured: nextIsFeatured === null ? current.isFeatured : nextIsFeatured,
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
