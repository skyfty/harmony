import type { Context } from 'koa'
import { Types } from 'mongoose'
import { ContentModel } from '@/models/Content'

function mapContent(content: any) {
  return {
    id: content._id.toString(),
    slug: content.slug,
    title: content.title,
    summary: content.summary ?? null,
    body: content.body ?? null,
    status: content.status,
    createdAt: content.createdAt?.toISOString?.() ?? new Date(content.createdAt).toISOString(),
    updatedAt: content.updatedAt?.toISOString?.() ?? new Date(content.updatedAt).toISOString(),
  }
}

export async function listContents(ctx: Context): Promise<void> {
  const { page = 1, pageSize = 10, keyword, status } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.$or = [{ title: new RegExp(keyword, 'i') }, { slug: new RegExp(keyword, 'i') }]
  }
  if (status) {
    filter.status = status
  }
  const pageNumber = Number(page)
  const limit = Number(pageSize)
  const skip = (pageNumber - 1) * limit
  const [contents, total] = await Promise.all([
    ContentModel.find(filter).skip(skip).limit(limit).sort({ updatedAt: -1 }).lean(),
    ContentModel.countDocuments(filter),
  ])
  ctx.body = {
    data: contents.map(mapContent),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getContent(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid content id')
  }
  const content = await ContentModel.findById(id).lean()
  if (!content) {
    ctx.throw(404, 'Content not found')
  }
  ctx.body = mapContent(content)
}

export async function createContent(ctx: Context): Promise<void> {
  const { slug, title, summary, body, status = 'draft' } = ctx.request.body as Record<string, unknown>
  if (!slug || !title) {
    ctx.throw(400, 'Content slug and title are required')
  }
  const exists = await ContentModel.findOne({ slug })
  if (exists) {
    ctx.throw(409, 'Content slug already exists')
  }
  const content = await ContentModel.create({ slug, title, summary, body, status })
  ctx.body = mapContent(content)
}

export async function updateContent(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid content id')
  }
  const { slug, title, summary, body, status } = ctx.request.body as Record<string, unknown>
  const update: Record<string, unknown> = { slug, title, summary, body, status }
  const content = await ContentModel.findByIdAndUpdate(id, update, { new: true }).lean()
  if (!content) {
    ctx.throw(404, 'Content not found')
  }
  ctx.body = mapContent(content)
}

export async function deleteContent(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid content id')
  }
  await ContentModel.findByIdAndDelete(id)
  ctx.status = 204
}
