import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { Context } from 'koa'
import fs from 'fs-extra'
import { Types } from 'mongoose'
import {
  createScene,
  deleteSceneById,
  extractUploadedFile,
  findSceneById,
  findSceneDocument,
  listScenes,
  resolveSceneFilePath,
  updateScene,
  type SceneCreatePayload,
  type SceneData,
  type SceneUpdatePayload,
} from '@/services/sceneService'

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function parseNumber(value: string | string[] | undefined, fallback: number, options: { min?: number; max?: number } = {}): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  const min = options.min ?? 1
  const max = options.max ?? Number.MAX_SAFE_INTEGER
  return Math.min(Math.max(parsed, min), max)
}

function parseDateParam(value: string | string[] | undefined): Date | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) {
    return null
  }
  const trimmed = raw.trim()
  if (!trimmed.length) {
    return null
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function readRequestFiles(ctx: Context): Record<string, unknown> | undefined {
  return (ctx.request as unknown as { files?: Record<string, unknown> }).files
}

function requireUserId(ctx: Context): string {
  const userId = (ctx.state as { user?: { id?: string } } | undefined)?.user?.id
  if (!userId || !Types.ObjectId.isValid(userId)) {
    ctx.throw(401, '用户身份无效')
  }
  return userId
}

export async function listSceneSummaries(ctx: Context): Promise<void> {
  const query = ctx.query as Record<string, string | string[] | undefined>
  const page = parseNumber(query.page, 1, { min: 1 })
  const pageSize = parseNumber(query.pageSize, 20, { min: 1, max: 100 })
  const keyword = sanitizeString(query.keyword)
  const createdFrom = parseDateParam(query.createdFrom)
  const createdTo = parseDateParam(query.createdTo)

  const { data, total } = await listScenes({
    page,
    pageSize,
    keyword: keyword ?? undefined,
    createdFrom,
    createdTo,
  })

  ctx.body = {
    data,
    page,
    pageSize,
    total,
  }
}

export async function getScene(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, '无效的场景 ID')
  }
  const scene = await findSceneById(id)
  if (!scene) {
    ctx.throw(404, '场景不存在')
  }
  ctx.body = scene
}

function parseSceneMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) {
      return null
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return null
    } catch (error) {
      throw Object.assign(new Error('metadata 必须是有效的 JSON 对象'), { cause: error })
    }
  }
  throw new Error('metadata 必须是对象或 JSON 字符串')
}

export async function createSceneEntry(ctx: Context): Promise<void> {
  const body = ctx.request.body as Record<string, unknown> | undefined
  const files = readRequestFiles(ctx)
  const file = extractUploadedFile(files, 'file')
  if (!file) {
    ctx.throw(400, '场景文件不能为空')
  }
  const publishedBy = requireUserId(ctx)
  const name = sanitizeString(body?.name)
  if (!name) {
    ctx.throw(400, '场景名称不能为空')
  }
  const description = sanitizeString(body?.description)
  let metadata: Record<string, unknown> | null = null
  try {
    metadata = parseSceneMetadata(body?.metadata)
  } catch (error) {
    ctx.throw(400, (error as Error).message)
  }
  const payload: SceneCreatePayload = {
    name,
    description: description ?? null,
    metadata,
    file,
    publishedBy,
  }
  let scene: SceneData
  try {
    scene = await createScene(payload)
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) {
      ctx.throw(409, '场景名称已存在')
    }
    throw error
  }
  ctx.status = 201
  ctx.body = scene
}

export async function updateSceneEntry(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, '无效的场景 ID')
  }
  const body = ctx.request.body as Record<string, unknown> | undefined
  const files = readRequestFiles(ctx)
  const file = extractUploadedFile(files, 'file')
  const payload: SceneUpdatePayload = {}
  if (body && Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = sanitizeString(body.name)
    if (!name) {
      ctx.throw(400, '场景名称不能为空')
    }
    payload.name = name
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'description')) {
    const descriptionValue = body.description
    if (descriptionValue === null) {
      payload.description = null
    } else {
      const description = sanitizeString(descriptionValue)
      payload.description = description ?? null
    }
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'metadata')) {
    try {
      payload.metadata = parseSceneMetadata(body.metadata)
    } catch (error) {
      ctx.throw(400, (error as Error).message)
    }
  }
  if (file) {
    payload.file = file
  }
  let updated: SceneData | null
  try {
    updated = await updateScene(id, payload)
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) {
      ctx.throw(409, '场景名称已存在')
    }
    throw error
  }
  if (!updated) {
    ctx.throw(404, '场景不存在')
  }
  ctx.body = updated
}

export async function deleteSceneEntry(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, '无效的场景 ID')
  }
  const deleted = await deleteSceneById(id)
  if (!deleted) {
    ctx.throw(404, '场景不存在')
  }
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}

export async function downloadSceneFile(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, '无效的场景 ID')
  }
  const scene = await findSceneDocument(id)
  if (!scene) {
    ctx.throw(404, '场景不存在')
  }
  const filePath = resolveSceneFilePath(scene.fileKey)
  const exists = await fs.pathExists(filePath)
  if (!exists) {
    ctx.throw(404, '场景文件不存在')
  }
  const stats = await fs.stat(filePath)
  const extension = path.extname(scene.fileKey)
  const fallbackName = extension ? `${scene.name}${extension}` : scene.name
  const filename = scene.originalFilename ?? fallbackName
  if (filename) {
    ctx.attachment(filename)
  }
  ctx.set('Content-Type', scene.fileType ?? 'application/octet-stream')
  ctx.set('Content-Length', stats.size.toString())
  ctx.body = createReadStream(filePath)
}
