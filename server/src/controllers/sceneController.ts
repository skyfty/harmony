import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneSpotModel } from '@/models/SceneSpot'
import {
  createScene as createSceneService,
  deleteSceneById,
  extractUploadedFile,
  findSceneById,
  listScenes as listScenesService,
  updateScene as updateSceneService,
} from '@/services/sceneService'

type SceneMutationPayload = {
  name?: string
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export async function listScenes(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '10', keyword } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100)

  const result = await listScenesService({
    page: pageNumber,
    pageSize: limit,
    keyword: toNonEmptyString(keyword) ?? undefined,
  })

  ctx.body = {
    data: result.data,
    page: pageNumber,
    pageSize: limit,
    total: result.total,
  }
}

export async function getScene(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene id')
  }
  const scene = await findSceneById(id)
  if (!scene) {
    ctx.throw(404, 'Scene not found')
  }
  ctx.body = scene
}

export async function createScene(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as SceneMutationPayload
  const name = toNonEmptyString(body.name)
  if (!name) {
    ctx.throw(400, 'Scene name is required')
  }
  const files = (ctx.request as unknown as { files?: Record<string, unknown> }).files
  const filePayload = extractUploadedFile(files, 'file')
  if (!filePayload) {
    ctx.throw(400, 'Scene package file is required')
  }
  const publishedBy = (ctx.state as { user?: { id?: string } } | undefined)?.user?.id
  if (!publishedBy || !Types.ObjectId.isValid(publishedBy)) {
    ctx.throw(401, 'Invalid user')
  }

  const created = await createSceneService({
    name,
    file: filePayload,
    publishedBy,
  })

  ctx.status = 201
  ctx.body = created
}

export async function updateScene(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene id')
  }

  const body = (ctx.request.body ?? {}) as SceneMutationPayload
  const files = (ctx.request as unknown as { files?: Record<string, unknown> }).files
  const filePayload = extractUploadedFile(files, 'file')
  const normalizedName = body.name === undefined ? undefined : toNonEmptyString(body.name)
  const name = normalizedName ?? undefined

  if (body.name !== undefined && !normalizedName) {
    ctx.throw(400, 'Scene name is required')
  }
  if (!filePayload && name === undefined) {
    ctx.throw(400, 'No scene fields provided to update')
  }

  const updated = await updateSceneService(id, {
    name,
    file: filePayload,
  })
  if (!updated) {
    ctx.throw(404, 'Scene not found')
  }
  ctx.body = updated
}

export async function deleteScene(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene id')
  }
  const spotCount = await SceneSpotModel.countDocuments({ sceneId: id }).exec()
  if (spotCount > 0) {
    ctx.throw(400, 'Scene has related scene spots, please remove spots first')
  }
  const deleted = await deleteSceneById(id)
  if (!deleted) {
    ctx.throw(404, 'Scene not found')
  }
  ctx.status = 200
  ctx.body = {}
}
