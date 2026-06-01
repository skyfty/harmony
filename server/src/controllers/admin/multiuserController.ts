import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { getActiveMultiuserService, type MultiuserRuntimeRoomDetail } from '@/services/multiuserService'

type SceneNameMap = Map<string, string | null>

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function loadSceneNameMap(sceneIds: string[]): Promise<SceneNameMap> {
  const validSceneIds = Array.from(
    new Set(sceneIds.filter((sceneId): sceneId is string => Types.ObjectId.isValid(sceneId))),
  )
  if (!validSceneIds.length) {
    return new Map()
  }
  try {
    const rows = await SceneModel.find({ _id: { $in: validSceneIds } }, { name: 1 }).lean().exec()
    return new Map((rows as Array<{ _id: unknown; name?: string | null }>).map((row) => [
      String(row._id),
      toNonEmptyString(row.name),
    ]))
  } catch (error) {
    console.warn('Failed to load scene names for multiuser runtime', {
      sceneIds: validSceneIds,
      error,
    })
    return new Map()
  }
}

function attachSceneNames<T extends { sceneId: string }>(rows: T[], sceneNameMap: SceneNameMap): Array<T & { sceneName: string | null }> {
  return rows.map((row) => ({
    ...row,
    sceneName: sceneNameMap.get(row.sceneId) ?? null,
  }))
}

function ensureRuntimeService(ctx: Context) {
  const service = getActiveMultiuserService()
  if (!service) {
    ctx.throw(503, 'Multiuser service is not ready')
  }
  return service
}

async function resolveRoomDetail(sceneId: string): Promise<(MultiuserRuntimeRoomDetail & { sceneName: string | null }) | null> {
  const service = getActiveMultiuserService()
  if (!service) {
    return null
  }
  const room = service.getRuntimeRoomDetail(sceneId)
  if (!room) {
    return null
  }
  const sceneNameMap = await loadSceneNameMap([sceneId])
  return {
    ...room,
    sceneName: sceneNameMap.get(sceneId) ?? null,
  }
}

export async function listMultiuserRuntimeRooms(ctx: Context): Promise<void> {
  const service = ensureRuntimeService(ctx)
  const rooms = service.getRuntimeRoomSummaries()
  const sceneNameMap = await loadSceneNameMap(rooms.map((room) => room.sceneId))
  ctx.body = {
    rooms: attachSceneNames(rooms, sceneNameMap),
    updatedAt: service.getRuntimeSnapshot(null).updatedAt,
  }
}

export async function getMultiuserRuntimeRoom(ctx: Context): Promise<void> {
  const sceneId = toNonEmptyString(ctx.params.sceneId)
  if (!sceneId) {
    ctx.throw(400, 'Invalid scene id')
  }
  const room = await resolveRoomDetail(sceneId)
  if (!room) {
    ctx.throw(404, 'Room not found')
  }
  ctx.body = room
}

export async function kickMultiuserRuntimeConnection(ctx: Context): Promise<void> {
  const sceneId = toNonEmptyString(ctx.params.sceneId)
  const sessionId = toNonEmptyString(ctx.params.sessionId)
  if (!sceneId || !sessionId) {
    ctx.throw(400, 'Invalid runtime connection id')
  }
  const service = ensureRuntimeService(ctx)
  const accepted = service.kickRuntimeRoomConnection(sceneId, sessionId)
  if (!accepted) {
    ctx.throw(404, 'Connection not found')
  }
  ctx.body = { ok: true }
}

export async function kickMultiuserRuntimeUser(ctx: Context): Promise<void> {
  const sceneId = toNonEmptyString(ctx.params.sceneId)
  const userId = toNonEmptyString(ctx.params.userId)
  if (!sceneId || !userId) {
    ctx.throw(400, 'Invalid runtime user id')
  }
  const service = ensureRuntimeService(ctx)
  const accepted = service.kickRuntimeRoomUser(sceneId, userId)
  if (!accepted) {
    ctx.throw(404, 'User not found')
  }
  ctx.body = { ok: true }
}

export async function clearMultiuserRuntimeRoom(ctx: Context): Promise<void> {
  const sceneId = toNonEmptyString(ctx.params.sceneId)
  if (!sceneId) {
    ctx.throw(400, 'Invalid scene id')
  }
  const service = ensureRuntimeService(ctx)
  const accepted = service.clearRuntimeRoom(sceneId)
  if (!accepted) {
    ctx.throw(404, 'Room not found')
  }
  ctx.body = { ok: true }
}
