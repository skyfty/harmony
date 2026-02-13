import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { extractUploadedFile, createScene, updateScene } from '@/services/sceneService'

type ScenicPayload = {
  name?: string
  location?: string | null
  intro?: string | null
  url?: string | null
  description?: string | null
  metadata?: Record<string, unknown> | null
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function mapScenic(scene: any) {
  const metadata = (scene.metadata ?? {}) as Record<string, unknown>
  const location = toNullableString(metadata.location)
  const intro = toNullableString(metadata.intro) ?? toNullableString(scene.description)
  const url = toNullableString(metadata.url) ?? toNullableString(scene.fileUrl)
  return {
    id: scene._id.toString(),
    name: scene.name,
    location,
    intro,
    url,
    fileKey: scene.fileKey,
    fileUrl: scene.fileUrl,
    description: scene.description ?? null,
    metadata,
    createdAt: scene.createdAt?.toISOString?.() ?? new Date(scene.createdAt).toISOString(),
    updatedAt: scene.updatedAt?.toISOString?.() ?? new Date(scene.updatedAt).toISOString(),
  }
}

export async function listScenics(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '10', keyword } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100)
  const skip = (pageNumber - 1) * limit
  const filter: Record<string, unknown> = {}
  if (keyword && keyword.trim()) {
    filter.$or = [{ name: new RegExp(keyword.trim(), 'i') }, { description: new RegExp(keyword.trim(), 'i') }]
  }
  const [rows, total] = await Promise.all([
    SceneModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    SceneModel.countDocuments(filter),
  ])
  ctx.body = {
    data: rows.map(mapScenic),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getScenic(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scenic id')
  }
  const row = await SceneModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'Scenic not found')
  }
  ctx.body = mapScenic(row)
}

export async function createScenic(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as ScenicPayload
  const name = toNullableString(body.name)
  if (!name) {
    ctx.throw(400, 'Scenic name is required')
  }
  const files = (ctx.request as unknown as { files?: Record<string, unknown> }).files
  const filePayload = extractUploadedFile(files, 'file')

  // if file uploaded, use sceneService to store file and create record
  if (filePayload) {
    const publishedBy = (ctx.state as { user?: { id?: string } } | undefined)?.user?.id
    if (!publishedBy || !Types.ObjectId.isValid(publishedBy)) {
      ctx.throw(401, 'Invalid user')
    }
    const metadata = {
      ...(body.metadata ?? {}),
      ...(toNullableString(body.location) ? { location: toNullableString(body.location) } : {}),
      ...(toNullableString(body.intro) ? { intro: toNullableString(body.intro) } : {}),
    }
    const payload = {
      name,
      description: toNullableString(body.description) ?? toNullableString(body.intro) ?? null,
      metadata: Object.keys(metadata).length ? metadata : null,
      file: filePayload,
      publishedBy,
    }
    const created = await createScene(payload)
    ctx.status = 201
    ctx.body = created
    return
  }

  // fallback: create from URL/meta only (legacy behavior)
  const location = toNullableString(body.location)
  const intro = toNullableString(body.intro)
  const url = toNullableString(body.url)
  const description = toNullableString(body.description) ?? intro
  const metadata = {
    ...(body.metadata ?? {}),
    ...(location ? { location } : {}),
    ...(intro ? { intro } : {}),
    ...(url ? { url } : {}),
  }
  const created = await SceneModel.create({
    name,
    description,
    fileKey: url ?? `scenic-${Date.now()}`,
    fileUrl: url ?? '',
    metadata,
  })
  const row = await SceneModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapScenic(row)
}

export async function updateScenic(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scenic id')
  }
  const current = await SceneModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Scenic not found')
  }
  const body = (ctx.request.body ?? {}) as ScenicPayload
  const files = (ctx.request as unknown as { files?: Record<string, unknown> }).files
  const filePayload = extractUploadedFile(files, 'file')

  // if file uploaded or metadata/name/description provided, use sceneService to update
  if (filePayload) {
    const payload = {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: Object.prototype.hasOwnProperty.call(body, 'description') ? (body.description as string | null) : undefined,
      metadata: Object.prototype.hasOwnProperty.call(body, 'metadata') ? (body.metadata as Record<string, unknown> | null) : undefined,
      file: filePayload,
    }
    const updated = await updateScene(id, payload)
    if (!updated) {
      ctx.throw(404, 'Scenic not found')
    }
    ctx.body = updated
    return
  }

  // fallback: legacy update without file
  const nextName = toNullableString(body.name) ?? current.name
  const location = toNullableString(body.location)
  const intro = toNullableString(body.intro)
  const url = toNullableString(body.url)
  const nextDescription = toNullableString(body.description) ?? intro ?? current.description ?? null
  const mergedMetadata = {
    ...((current.metadata ?? {}) as Record<string, unknown>),
    ...((body.metadata ?? {}) as Record<string, unknown>),
  }
  if (location !== null) {
    mergedMetadata.location = location
  }
  if (intro !== null) {
    mergedMetadata.intro = intro
  }
  if (url !== null) {
    mergedMetadata.url = url
  }
  const updated = await SceneModel.findByIdAndUpdate(
    id,
    {
      name: nextName,
      description: nextDescription,
      fileUrl: url ?? current.fileUrl,
      metadata: mergedMetadata,
    },
    { new: true },
  )
    .lean()
    .exec()
  ctx.body = mapScenic(updated)
}

export async function deleteScenic(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scenic id')
  }
  await SceneModel.findByIdAndDelete(id).exec()
  ctx.status = 204
}
