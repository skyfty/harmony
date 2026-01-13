import { UserSceneModel } from '@/models/UserScene'
import type { StoredSceneDocumentPayload } from '@/types/userScene'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string' && value.trim().length) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  return new Date().toISOString()
}

function normalizeSceneDocument(raw: unknown, fallbackId?: string): StoredSceneDocumentPayload {
  if (!isPlainObject(raw)) {
    throw new Error('Scene document必须是对象')
  }
  const document = { ...raw }
  const idCandidate = typeof document.id === 'string' ? document.id.trim() : ''
  const id = idCandidate || fallbackId
  if (!id) {
    throw new Error('Scene document缺少id')
  }
  document.id = id
  const nameCandidate = typeof document.name === 'string' ? document.name.trim() : ''
  document.name = nameCandidate || '未命名场景'
  const projectIdCandidate = typeof document.projectId === 'string' ? document.projectId.trim() : ''
  if (!projectIdCandidate) {
    throw new Error('Scene document缺少projectId')
  }
  document.projectId = projectIdCandidate
  document.thumbnail = typeof document.thumbnail === 'string' ? document.thumbnail : null
  const updatedAt = toIsoString(document.updatedAt)
  const createdAt = toIsoString(document.createdAt ?? updatedAt)
  document.createdAt = createdAt
  document.updatedAt = updatedAt
  return document as StoredSceneDocumentPayload
}

function cloneDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export async function listUserScenes(userId: string): Promise<StoredSceneDocumentPayload[]> {
  const records: Array<{ userId: string; sceneId: string; document: unknown }> = await UserSceneModel.find({ userId }).lean()
  return records.map((entry) => normalizeSceneDocument(entry.document, entry.sceneId))
}

export async function getUserScene(userId: string, sceneId: string): Promise<StoredSceneDocumentPayload | null> {
  const record: { userId: string; sceneId: string; document: unknown } | null = await UserSceneModel.findOne({ userId, sceneId }).lean()
  if (!record) {
    return null
  }
  return normalizeSceneDocument(record.document, record.sceneId)
}

export async function saveUserScene(
  userId: string,
  sceneId: string,
  payload: unknown,
): Promise<StoredSceneDocumentPayload> {
  const document = normalizeSceneDocument(payload, sceneId)

  const existing = await UserSceneModel.findOne({ userId, sceneId: document.id }).lean()
  if (existing && typeof (existing as { projectId?: unknown }).projectId === 'string') {
    const existingProjectId = (existing as { projectId: string }).projectId
    if (existingProjectId !== document.projectId) {
      throw new Error('Scene projectId不可变')
    }
  }

  await UserSceneModel.findOneAndUpdate(
    { userId, sceneId: document.id },
    { userId, sceneId: document.id, projectId: document.projectId, document: cloneDocument(document) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return document
}

export async function deleteUserScene(userId: string, sceneId: string): Promise<boolean> {
  const result = await UserSceneModel.findOneAndDelete({ userId, sceneId })
  return result != null
}

export async function deleteUserScenesBulk(
  userId: string,
  sceneIds: string[],
): Promise<{ deletedIds: string[]; notFoundIds: string[]; failedIds: string[] }> {
  const ids = Array.from(new Set(sceneIds.map((id) => id.trim()).filter(Boolean)))
  if (!ids.length) {
    return { deletedIds: [], notFoundIds: [], failedIds: [] }
  }
  const existing = await UserSceneModel.find({ userId, sceneId: { $in: ids } }, { sceneId: 1 }).lean()
  const existingIds = new Set(existing.map((entry) => (entry as { sceneId: string }).sceneId))
  const notFoundIds = ids.filter((id) => !existingIds.has(id))
  try {
    await UserSceneModel.deleteMany({ userId, sceneId: { $in: ids } })
    return { deletedIds: ids.filter((id) => existingIds.has(id)), notFoundIds, failedIds: [] }
  } catch {
    return { deletedIds: [], notFoundIds, failedIds: ids }
  }
}
