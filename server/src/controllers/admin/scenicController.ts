import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { extractUploadedFile, createScene, deleteSceneById, updateScene } from '@/services/sceneService'

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

function hasOwn(payload: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key)
}

function parseMetadataInput(value: unknown, ctx: Context): Record<string, unknown> | null {
  if (value == null || value === '') {
    return null
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        ctx.throw(400, 'Scenic metadata must be a JSON object')
      }
      return parsed as Record<string, unknown>
    } catch {
      ctx.throw(400, 'Scenic metadata must be valid JSON')
    }
  }
  if (Array.isArray(value) || typeof value !== 'object') {
    ctx.throw(400, 'Scenic metadata must be a JSON object')
  }
  return value as Record<string, unknown>
}

function mapScenic(scene: any) {
  const metadata = (scene.metadata ?? {}) as Record<string, unknown>
  const location = toNullableString(metadata.location)
  const intro = toNullableString(metadata.intro) ?? toNullableString(scene.description)
  const url = toNullableString(metadata.url) ?? toNullableString(scene.fileUrl)
  const id = scene.id ?? scene._id?.toString?.() ?? String(scene._id)
  const createdSource = scene.createdAt ?? new Date()
  const updatedSource = scene.updatedAt ?? createdSource
  const createdAt = createdSource?.toISOString?.() ?? new Date(createdSource).toISOString()
  const updatedAt = updatedSource?.toISOString?.() ?? new Date(updatedSource).toISOString()
  return {
    id,
    name: scene.name,
    location,
    intro,
    url,
    fileKey: scene.fileKey,
    fileUrl: scene.fileUrl,
    description: scene.description ?? null,
    metadata,
    createdAt,
    updatedAt,
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
    const metadataInput = hasOwn(body, 'metadata') ? parseMetadataInput(body.metadata, ctx) : null
    const metadata = {
      ...(metadataInput ?? {}),
      ...(toNullableString(body.location) ? { location: toNullableString(body.location) } : {}),
      ...(toNullableString(body.intro) ? { intro: toNullableString(body.intro) } : {}),
      ...(toNullableString(body.url) ? { url: toNullableString(body.url) } : {}),
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
    ctx.body = mapScenic(created)
    return
  }

  // fallback: create from URL/meta only (legacy behavior)
  const location = toNullableString(body.location)
  const intro = toNullableString(body.intro)
  const url = toNullableString(body.url)
  const description = toNullableString(body.description) ?? intro
  const metadataInput = hasOwn(body, 'metadata') ? parseMetadataInput(body.metadata, ctx) : null
  const metadata = {
    ...(metadataInput ?? {}),
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

  const metadataProvided = hasOwn(body, 'metadata')
  const locationProvided = hasOwn(body, 'location')
  const introProvided = hasOwn(body, 'intro')
  const urlProvided = hasOwn(body, 'url')

  let nextMetadata: Record<string, unknown> | null | undefined
  if (metadataProvided || locationProvided || introProvided || urlProvided) {
    const baseMetadata = metadataProvided
      ? parseMetadataInput(body.metadata, ctx)
      : ((current.metadata ?? {}) as Record<string, unknown>)
    const merged = {
      ...(baseMetadata ?? {}),
    }
    if (locationProvided) {
      merged.location = toNullableString(body.location)
    }
    if (introProvided) {
      merged.intro = toNullableString(body.intro)
    }
    if (urlProvided) {
      merged.url = toNullableString(body.url)
    }
    nextMetadata = Object.keys(merged).length ? merged : null
  }

  const descriptionProvided = hasOwn(body, 'description')
  const descriptionValue = descriptionProvided
    ? toNullableString(body.description)
    : (introProvided ? toNullableString(body.intro) : undefined)
  const normalizedName = hasOwn(body, 'name') ? toNullableString(body.name) : undefined

  // if file uploaded or metadata/name/description provided, use sceneService to update
  if (filePayload) {
    const payload = {
      name: normalizedName ?? undefined,
      description: descriptionValue,
      metadata: nextMetadata,
      file: filePayload,
    }
    const updated = await updateScene(id, payload)
    if (!updated) {
      ctx.throw(404, 'Scenic not found')
    }
    ctx.body = mapScenic(updated)
    return
  }

  // fallback: legacy update without file
  const nextName = normalizedName ?? current.name
  const nextDescription = descriptionValue ?? current.description ?? null
  const currentFileUrl = toNullableString(current.fileUrl) ?? ''
  const nextFileUrl = urlProvided ? (toNullableString(body.url) ?? currentFileUrl) : currentFileUrl
  const updated = await SceneModel.findByIdAndUpdate(
    id,
    {
      name: nextName,
      description: nextDescription,
      fileUrl: nextFileUrl,
      metadata: nextMetadata === undefined ? current.metadata : nextMetadata,
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
  const deleted = await deleteSceneById(id)
  if (!deleted) {
    ctx.throw(404, 'Scenic not found')
  }
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}
