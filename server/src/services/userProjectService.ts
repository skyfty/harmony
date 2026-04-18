import { UserProjectModel } from '@/models/UserProject'
import { UserSceneModel } from '@/models/UserScene'
import { deleteUserScenesBulk, restoreUserScenesBulk, trashUserScenesBulk } from '@/services/userSceneService'
import type { StoredProjectPayload } from '@/types/userProject'

export interface UserProjectQueryOptions {
  includeDeleted?: boolean
  deletedOnly?: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSceneMeta(raw: unknown, projectId: string): { meta: StoredProjectPayload['scenes'][number]; sceneId: string } {
  if (!isPlainObject(raw)) {
    throw new Error('Project scene meta必须是对象')
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) {
    throw new Error('Project scene meta缺少id')
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const sceneJsonUrl = typeof raw.sceneJsonUrl === 'string' ? raw.sceneJsonUrl.trim() : ''
  const projectIdCandidate = typeof raw.projectId === 'string' ? raw.projectId.trim() : ''
  if (!sceneJsonUrl) {
    throw new Error('Project scene meta缺少sceneJsonUrl')
  }
  if (!projectIdCandidate) {
    throw new Error('Project scene meta缺少projectId')
  }
  if (projectIdCandidate !== projectId) {
    throw new Error('Project scene meta projectId不匹配')
  }
  return {
    meta: {
      id,
      name: name || '未命名场景',
      sceneJsonUrl,
      projectId: projectIdCandidate,
    },
    sceneId: id,
  }
}

function normalizeProjectDocument(raw: unknown, fallbackId?: string): StoredProjectPayload {
  if (!isPlainObject(raw)) {
    throw new Error('Project document必须是对象')
  }
  const document = { ...raw } as Record<string, unknown>
  const idCandidate = typeof document.id === 'string' ? document.id.trim() : ''
  const id = idCandidate || fallbackId
  if (!id) {
    throw new Error('Project document缺少id')
  }
  document.id = id
  const nameCandidate = typeof document.name === 'string' ? document.name.trim() : ''
  document.name = nameCandidate || '未命名工程'

  const categoryRaw = typeof document.categoryId === 'string' ? document.categoryId.trim() : ''
  document.categoryId = categoryRaw || null

  const scenesRaw = document.scenes
  const scenesArray = Array.isArray(scenesRaw) ? scenesRaw : []
  const scenes: StoredProjectPayload['scenes'] = []
  const seen = new Set<string>()
  for (const entry of scenesArray) {
    const normalized = normalizeSceneMeta(entry, id)
    if (seen.has(normalized.sceneId)) {
      throw new Error('Project scenes包含重复sceneId')
    }
    seen.add(normalized.sceneId)
    scenes.push(normalized.meta)
  }
  document.scenes = scenes

  const lastEditedRaw = document.lastEditedSceneId
  const lastEdited = typeof lastEditedRaw === 'string' ? lastEditedRaw.trim() : null
  document.lastEditedSceneId = lastEdited && lastEdited.length ? lastEdited : null

  return document as unknown as StoredProjectPayload
}

function cloneDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function buildDeletionFilter(options?: UserProjectQueryOptions): Record<string, unknown> {
  if (options?.deletedOnly) {
    return { deletedAt: { $ne: null } }
  }
  if (options?.includeDeleted) {
    return {}
  }
  return { deletedAt: null }
}

export async function listUserProjects(userId: string, options?: UserProjectQueryOptions): Promise<StoredProjectPayload[]> {
  const records: Array<{ userId: string; projectId: string; document: unknown }> = await UserProjectModel.find({ userId, ...buildDeletionFilter(options) }).lean()
  return records.map((entry) => normalizeProjectDocument(entry.document, entry.projectId))
}

export async function getUserProject(userId: string, projectId: string, options?: UserProjectQueryOptions): Promise<StoredProjectPayload | null> {
  const record: { userId: string; projectId: string; document: unknown } | null = await UserProjectModel.findOne({ userId, projectId, ...buildDeletionFilter(options) }).lean()
  if (!record) {
    return null
  }
  return normalizeProjectDocument(record.document, record.projectId)
}

export async function saveUserProject(userId: string, projectId: string, payload: unknown): Promise<StoredProjectPayload> {
  const document = normalizeProjectDocument(payload, projectId)

  // Prevent claiming scenes that already belong to another project.
  const sceneIds = document.scenes.map((scene) => scene.id)
  if (sceneIds.length) {
    const conflicts = await UserSceneModel.find(
      {
        userId,
        sceneId: { $in: sceneIds },
        projectId: { $ne: document.id },
      },
      { sceneId: 1, projectId: 1 },
    ).lean()
    if (conflicts.length) {
      throw new Error('Project scenes引用了其他工程的场景')
    }
  }

  await UserProjectModel.findOneAndUpdate(
    { userId, projectId: document.id },
    {
      userId,
      projectId: document.id,
      categoryId: document.categoryId ?? null,
      sceneIds,
      document: cloneDocument(document),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  return document
}

export async function deleteUserProjectCascade(userId: string, projectId: string): Promise<{ deletedSceneIds: string[]; notFoundSceneIds: string[]; failedSceneIds: string[] }> {
  const record: { userId: string; projectId: string; sceneIds?: unknown; document: unknown } | null = await UserProjectModel.findOne({ userId, projectId }, { projectId: 1, document: 1 }).lean()
  if (!record) {
    return { deletedSceneIds: [], notFoundSceneIds: [], failedSceneIds: [] }
  }
  const normalized = normalizeProjectDocument(record.document, record.projectId)
  const sceneIds = normalized.scenes.map((scene) => scene.id)
  const bulk = await deleteUserScenesBulk(userId, sceneIds)

  await UserProjectModel.findOneAndDelete({ userId, projectId })

  return {
    deletedSceneIds: bulk.deletedIds,
    notFoundSceneIds: bulk.notFoundIds,
    failedSceneIds: bulk.failedIds,
  }
}

export async function trashUserProjectCascade(userId: string, projectId: string): Promise<{ trashedSceneIds: string[]; notFoundSceneIds: string[] }> {
  const record: { userId: string; projectId: string; document: unknown } | null = await UserProjectModel.findOne({ userId, projectId, deletedAt: null }).lean()
  if (!record) {
    return { trashedSceneIds: [], notFoundSceneIds: [] }
  }
  const normalized = normalizeProjectDocument(record.document, record.projectId)
  const sceneIds = normalized.scenes.map((scene) => scene.id)
  const deletedAt = new Date()
  await UserProjectModel.updateOne(
    { userId, projectId, deletedAt: null },
    { $set: { isDeleted: true, deletedAt } },
  ).exec()
  const bulk = await trashUserScenesBulk(userId, sceneIds, deletedAt)
  return {
    trashedSceneIds: bulk.trashedIds,
    notFoundSceneIds: bulk.notFoundIds,
  }
}

export async function restoreUserProjectCascade(userId: string, projectId: string): Promise<{ restoredSceneIds: string[]; notFoundSceneIds: string[] }> {
  const record: { userId: string; projectId: string; document: unknown } | null = await UserProjectModel.findOne({ userId, projectId, deletedAt: { $ne: null } }).lean()
  if (!record) {
    return { restoredSceneIds: [], notFoundSceneIds: [] }
  }
  const normalized = normalizeProjectDocument(record.document, record.projectId)
  const sceneIds = normalized.scenes.map((scene) => scene.id)
  await UserProjectModel.updateOne(
    { userId, projectId, deletedAt: { $ne: null } },
    { $set: { isDeleted: false, deletedAt: null } },
  ).exec()
  const bulk = await restoreUserScenesBulk(userId, sceneIds)
  return {
    restoredSceneIds: bulk.restoredIds,
    notFoundSceneIds: bulk.notFoundIds,
  }
}
