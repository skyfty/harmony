import type { Context } from 'koa'
import { deleteUserScene, deleteUserScenesBulk, getUserScene, listUserScenes, saveUserScene } from '@/services/userSceneService'

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

export async function getUserSceneDocument(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const sceneId = ensureSceneId(ctx)
  const scene = await getUserScene(userId, sceneId)
  if (!scene) {
    ctx.throw(404, 'Scene not found')
  }
  ctx.body = { scene }
}

export async function saveUserSceneDocument(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const sceneId = ensureSceneId(ctx)
  const payload = ctx.request.body
  if (payload && typeof payload === 'object' && payload !== null) {
    const existingId = (payload as { id?: string }).id
    if (existingId && existingId !== sceneId) {
      ctx.throw(400, 'Scene id mismatch between path and payload')
    }
  }
  try {
    const scene = await saveUserScene(userId, sceneId, payload)
    ctx.body = { scene }
  } catch (error) {
    const message = (error as { message?: string }).message ?? 'Invalid scene document'
    if (message.includes('projectId不可变')) {
      ctx.throw(409, message)
    }
    ctx.throw(400, message)
  }
}

export async function deleteUserSceneDocument(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const sceneId = ensureSceneId(ctx)
  await deleteUserScene(userId, sceneId)
  ctx.status = 204
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
