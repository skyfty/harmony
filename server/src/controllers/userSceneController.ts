import type { Context } from 'koa'
import { listUserScenes, saveUserScene, deleteUserScene } from '@/services/userSceneService'

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
  const scene = await saveUserScene(userId, sceneId, payload)
  ctx.body = { scene }
}

export async function deleteUserSceneDocument(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const sceneId = ensureSceneId(ctx)
  await deleteUserScene(userId, sceneId)
  ctx.status = 204
}
