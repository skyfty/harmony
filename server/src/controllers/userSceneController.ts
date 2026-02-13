import { createReadStream } from 'node:fs'
import type { Context } from 'koa'
import fs from 'fs-extra'
import {
  deleteUserScene,
  deleteUserScenesBulk,
  getUserSceneBundle,
  listUserScenes,
  resolveUserSceneBundleFilePath,
  saveUserSceneBundle,
  type UploadedFilePayload,
} from '@/services/userSceneService'
import { extractUploadedFile } from '@/services/sceneService'

function ensureUserId(ctx: Context): string {
  const userId = ctx.state.user?.id
  if (!userId || typeof userId !== 'string') {
    ctx.throw(401, 'Unauthorized')
  }
  return userId
}

function ensureSceneId(ctx: Context): string {
  const sceneId = ctx.params?.id
  if (!sceneId || typeof sceneId !== 'string' || !sceneId.trim()) {
    ctx.throw(400, 'Scene id is required')
  }
  return sceneId.trim()
}

export async function listUserSceneDocuments(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const scenes = await listUserScenes(userId)
  ctx.body = { scenes }
}

function readRequestFiles(ctx: Context): Record<string, unknown> | undefined {
  return (ctx.request as unknown as { files?: Record<string, unknown> }).files
}

export async function uploadUserSceneBundle(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const sceneId = ensureSceneId(ctx)
  const files = readRequestFiles(ctx)
  const file = extractUploadedFile(files, 'file')
  if (!file) {
    ctx.throw(400, 'Scene bundle file is required')
  }
  let stored
  try {
    stored = await saveUserSceneBundle(userId, sceneId, file as UploadedFilePayload)
  } catch (error) {
    ctx.throw(400, (error as Error).message ?? 'Invalid scene bundle')
  }
  ctx.body = { scene: stored }
}

export async function downloadUserSceneBundle(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const sceneId = ensureSceneId(ctx)
  const record = await getUserSceneBundle(userId, sceneId)
  if (!record) {
    ctx.throw(404, 'Scene not found')
  }

  const ifNoneMatch = ctx.get('If-None-Match')
  if (ifNoneMatch && record.bundle.etag && ifNoneMatch === record.bundle.etag) {
    ctx.status = 304
    return
  }

  const filePath = resolveUserSceneBundleFilePath(record.bundle.fileKey)
  const exists = await fs.pathExists(filePath)
  if (!exists) {
    ctx.throw(404, 'Scene bundle file not found')
  }
  const stats = await fs.stat(filePath)
  if (record.bundle.etag) {
    ctx.set('ETag', record.bundle.etag)
  }
  ctx.set('Content-Type', 'application/zip')
  ctx.set('Content-Length', stats.size.toString())
  ctx.body = createReadStream(filePath)
}

export async function deleteUserSceneDocument(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const sceneId = ensureSceneId(ctx)
  await deleteUserScene(userId, sceneId)
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}

export async function deleteUserSceneDocumentsBulk(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const payload = ctx.request.body
  const ids =
    payload && typeof payload === 'object' && payload !== null && Array.isArray((payload as { ids?: unknown }).ids)
      ? ((payload as { ids: unknown[] }).ids.filter((id) => typeof id === 'string') as string[])
      : []
  if (!ids.length) {
    ctx.throw(400, 'ids is required')
  }
  const result = await deleteUserScenesBulk(userId, ids)
  ctx.body = { result }
}
