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

export async function saveUserScene(
  userId: string,
  sceneId: string,
  payload: unknown,
): Promise<StoredSceneDocumentPayload> {
  const document = normalizeSceneDocument(payload, sceneId)
  await UserSceneModel.findOneAndUpdate(
    { userId, sceneId: document.id },
    { userId, sceneId: document.id, document: cloneDocument(document) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return document
}

export async function deleteUserScene(userId: string, sceneId: string): Promise<boolean> {
  const result = await UserSceneModel.findOneAndDelete({ userId, sceneId })
  return result != null
}
