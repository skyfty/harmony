import type { Context } from 'koa'
import { Types } from 'mongoose'
import { UserProjectModel } from '@/models/UserProject'
import { UserProjectCategoryModel } from '@/models/UserProjectCategory'
import { extractUploadedFile } from '@/services/sceneService'
import { deleteUserScene, saveUserSceneBundle, type UploadedFilePayload } from '@/services/userSceneService'
import {
  createUserProjectCategory,
  deleteUserProjectCategory,
  listUserProjectCategories,
  updateUserProjectCategory,
} from '@/services/userProjectCategoryService'
import { deleteUserProjectCascade, getUserProject, restoreUserProjectCascade, saveUserProject, trashUserProjectCascade } from '@/services/userProjectService'

function ensureCurrentUserId(ctx: Context): string {
  const userId = ctx.state.adminAuthUser?.id
  if (!userId || typeof userId !== 'string') {
    ctx.throw(401, 'Unauthorized')
  }
  return userId
}

function canManageAllUsers(ctx: Context): boolean {
  const permissions = Array.isArray(ctx.state.adminAuthUser?.permissions) ? ctx.state.adminAuthUser?.permissions : []
  if (permissions?.includes('admin:super')) {
    return true
  }
  const roles = Array.isArray(ctx.state.adminAuthUser?.roles) ? ctx.state.adminAuthUser?.roles : []
  return roles?.includes('admin')
}

function resolveScopedUserId(ctx: Context, requestedUserId?: unknown): string {
  const currentUserId = ensureCurrentUserId(ctx)
  const candidate = typeof requestedUserId === 'string' ? requestedUserId.trim() : ''
  if (!candidate) {
    return currentUserId
  }
  if (candidate !== currentUserId && !canManageAllUsers(ctx)) {
    ctx.throw(403, 'Forbidden')
  }
  return candidate
}

function buildSceneJsonUrl(sceneId: string): string {
  return `/api/user-scenes/${encodeURIComponent(sceneId)}`
}

function mapProjectSummary(row: any) {
  const document = row?.document && typeof row.document === 'object' ? row.document : {}
  const scenes = Array.isArray((document as any).scenes) ? (document as any).scenes : []
  return {
    userId: String(row.userId ?? ''),
    id: String(row.projectId ?? ''),
    name: typeof (document as any).name === 'string' ? (document as any).name : '未命名项目',
    categoryId: typeof (row.categoryId ?? (document as any).categoryId) === 'string' ? (row.categoryId ?? (document as any).categoryId) : null,
    sceneCount: scenes.length,
    lastEditedSceneId: typeof (document as any).lastEditedSceneId === 'string' ? (document as any).lastEditedSceneId : null,
    deletedAt: row.deletedAt instanceof Date ? row.deletedAt.toISOString() : (row.deletedAt ? new Date(row.deletedAt).toISOString() : null),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

function readRequestFiles(ctx: Context): Record<string, unknown> | undefined {
  return (ctx.request as unknown as { files?: Record<string, unknown> }).files
}

function resolveProjectId(rawItem: Record<string, unknown>): string {
  const projectId = typeof rawItem.projectId === 'string' ? rawItem.projectId.trim() : ''
  if (projectId) {
    return projectId
  }
  return typeof rawItem.id === 'string' ? rawItem.id.trim() : ''
}

function buildTrashFilter(ctx: Context, payload: Record<string, unknown>): Record<string, unknown> {
  const filter: Record<string, unknown> = { deletedAt: { $ne: null } }
  const requestedUserId = typeof payload.userId === 'string' ? payload.userId.trim() : ''
  if (requestedUserId) {
    filter.userId = resolveScopedUserId(ctx, requestedUserId)
  } else if (!canManageAllUsers(ctx)) {
    filter.userId = ensureCurrentUserId(ctx)
  }
  const categoryId = typeof payload.categoryId === 'string' ? payload.categoryId.trim() : ''
  if (categoryId) {
    filter.categoryId = categoryId
  }
  const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim() : ''
  if (keyword) {
    filter['document.name'] = new RegExp(keyword, 'i')
  }
  return filter
}

export async function listProjects(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, categoryId, userId, deletedOnly, includeDeleted } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const skip = (pageNumber - 1) * limit

  const scopedUserId = resolveScopedUserId(ctx, userId)
  const filter: Record<string, unknown> = { userId: scopedUserId }

  const canAll = canManageAllUsers(ctx)
  if (canAll && !userId?.trim()) {
    delete filter.userId
  }
  if (categoryId && categoryId.trim()) {
    filter.categoryId = categoryId.trim()
  }
  if (keyword && keyword.trim()) {
    filter['document.name'] = new RegExp(keyword.trim(), 'i')
  }
  if (deletedOnly === 'true') {
    filter.deletedAt = { $ne: null }
  } else if (includeDeleted !== 'true') {
    filter.deletedAt = null
  }

  const [rows, total] = await Promise.all([
    UserProjectModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean().exec(),
    UserProjectModel.countDocuments(filter),
  ])

  ctx.body = {
    data: (rows as any[]).map(mapProjectSummary),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getProject(ctx: Context): Promise<void> {
  const userId = resolveScopedUserId(ctx, ctx.params?.userId)
  const projectId = typeof ctx.params?.projectId === 'string' ? ctx.params.projectId.trim() : ''
  if (!projectId) {
    ctx.throw(400, 'Project id is required')
  }
  const project = await getUserProject(userId, projectId, { includeDeleted: true })
  if (!project) {
    ctx.throw(404, 'Project not found')
  }
  ctx.body = {
    userId,
    project,
  }
}

export async function createProject(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const userId = resolveScopedUserId(ctx, body.userId)
  const project = body.project ?? body
  const projectId = typeof (project as { id?: unknown })?.id === 'string' ? (project as { id: string }).id.trim() : ''
  if (!projectId) {
    ctx.throw(400, 'Project id is required')
  }
  try {
    const saved = await saveUserProject(userId, projectId, project)
    ctx.status = 201
    ctx.body = { userId, project: saved }
  } catch (error) {
    const message = (error as { message?: string }).message ?? 'Invalid project payload'
    if (message.includes('引用了其他工程')) {
      ctx.throw(409, message)
    }
    ctx.throw(400, message)
  }
}

export async function updateProject(ctx: Context): Promise<void> {
  const userId = resolveScopedUserId(ctx, ctx.params?.userId)
  const projectId = typeof ctx.params?.projectId === 'string' ? ctx.params.projectId.trim() : ''
  if (!projectId) {
    ctx.throw(400, 'Project id is required')
  }
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const payload = body.project ?? body
  try {
    const saved = await saveUserProject(userId, projectId, payload)
    ctx.body = { userId, project: saved }
  } catch (error) {
    const message = (error as { message?: string }).message ?? 'Invalid project payload'
    if (message.includes('引用了其他工程')) {
      ctx.throw(409, message)
    }
    ctx.throw(400, message)
  }
}

export async function removeProject(ctx: Context): Promise<void> {
  const userId = resolveScopedUserId(ctx, ctx.params?.userId)
  const projectId = typeof ctx.params?.projectId === 'string' ? ctx.params.projectId.trim() : ''
  if (!projectId) {
    ctx.throw(400, 'Project id is required')
  }
  const existing = await UserProjectModel.findOne({ userId, projectId }, { deletedAt: 1 }).lean().exec()
  if (!existing) {
    ctx.throw(404, 'Project not found')
  }
  const result = (existing as { deletedAt?: Date | null }).deletedAt
    ? await deleteUserProjectCascade(userId, projectId)
    : await trashUserProjectCascade(userId, projectId)
  ctx.status = 200
  ctx.body = { result }
}

export async function bulkDeleteProjects(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const items = Array.isArray(body.items) ? body.items : []
  if (!items.length) {
    ctx.throw(400, 'At least one project is required')
  }

  let trashedCount = 0
  let deletedCount = 0
  let notFoundCount = 0

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const rawItem = item as Record<string, unknown>
    const userId = resolveScopedUserId(ctx, rawItem.userId)
    const projectId = resolveProjectId(rawItem)
    if (!projectId) {
      continue
    }

    const existing = await UserProjectModel.findOne({ userId, projectId }, { deletedAt: 1 }).lean().exec()
    if (!existing) {
      notFoundCount += 1
      continue
    }

    const isDeleted = Boolean((existing as { deletedAt?: Date | null }).deletedAt)
    if (isDeleted) {
      await deleteUserProjectCascade(userId, projectId)
      deletedCount += 1
    } else {
      await trashUserProjectCascade(userId, projectId)
      trashedCount += 1
    }
  }

  ctx.body = {
    deletedCount,
    notFoundCount,
    trashedCount,
  }
}

export async function emptyProjectTrash(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const filter = buildTrashFilter(ctx, body)
  const rows = await UserProjectModel.find(filter, { userId: 1, projectId: 1 }).lean().exec()

  let deletedCount = 0
  for (const row of rows as Array<{ projectId?: string; userId?: string }>) {
    const userId = typeof row.userId === 'string' ? row.userId : ''
    const projectId = typeof row.projectId === 'string' ? row.projectId : ''
    if (!userId || !projectId) {
      continue
    }
    await deleteUserProjectCascade(userId, projectId)
    deletedCount += 1
  }

  ctx.body = {
    deletedCount,
  }
}

export async function restoreProject(ctx: Context): Promise<void> {
  const userId = resolveScopedUserId(ctx, ctx.params?.userId)
  const projectId = typeof ctx.params?.projectId === 'string' ? ctx.params.projectId.trim() : ''
  if (!projectId) {
    ctx.throw(400, 'Project id is required')
  }
  const result = await restoreUserProjectCascade(userId, projectId)
  ctx.body = { result }
}

export async function uploadProjectSceneBundle(ctx: Context): Promise<void> {
  const userId = resolveScopedUserId(ctx, ctx.params?.userId)
  const projectId = typeof ctx.params?.projectId === 'string' ? ctx.params.projectId.trim() : ''
  const sceneId = typeof ctx.params?.sceneId === 'string' ? ctx.params.sceneId.trim() : ''
  if (!projectId || !sceneId) {
    ctx.throw(400, 'Project id and scene id are required')
  }

  const project = await getUserProject(userId, projectId)
  if (!project) {
    ctx.throw(404, 'Project not found')
  }
  const ensuredProject = project!

  const file = extractUploadedFile(readRequestFiles(ctx), 'file')
  if (!file) {
    ctx.throw(400, 'Scene bundle file is required')
  }

  const stored = await saveUserSceneBundle(userId, sceneId, file as UploadedFilePayload)
  if (stored.projectId !== projectId) {
    await deleteUserScene(userId, sceneId)
    ctx.throw(409, 'Scene bundle projectId mismatch')
  }

  const existingMeta = ensuredProject.scenes.find((entry) => entry.id === sceneId)
  const sceneMeta = {
    id: sceneId,
    name: stored.name,
    sceneJsonUrl: buildSceneJsonUrl(sceneId),
    projectId,
  }
  const nextScenes = existingMeta
    ? ensuredProject.scenes.map((entry) => (entry.id === sceneId ? sceneMeta : entry))
    : [...ensuredProject.scenes, sceneMeta]
  const nextProject = {
    ...ensuredProject,
    scenes: nextScenes,
    lastEditedSceneId: ensuredProject.lastEditedSceneId ?? sceneId,
  }
  const saved = await saveUserProject(userId, projectId, nextProject)

  ctx.body = {
    userId,
    project: saved,
    scene: stored,
  }
}

export async function removeProjectScene(ctx: Context): Promise<void> {
  const userId = resolveScopedUserId(ctx, ctx.params?.userId)
  const projectId = typeof ctx.params?.projectId === 'string' ? ctx.params.projectId.trim() : ''
  const sceneId = typeof ctx.params?.sceneId === 'string' ? ctx.params.sceneId.trim() : ''
  if (!projectId || !sceneId) {
    ctx.throw(400, 'Project id and scene id are required')
  }

  const project = await getUserProject(userId, projectId)
  if (!project) {
    ctx.throw(404, 'Project not found')
  }
  const ensuredProject = project!

  await deleteUserScene(userId, sceneId)

  const nextScenes = ensuredProject.scenes.filter((entry) => entry.id !== sceneId)
  const nextProject = {
    ...ensuredProject,
    scenes: nextScenes,
    lastEditedSceneId: ensuredProject.lastEditedSceneId === sceneId ? (nextScenes[0]?.id ?? null) : ensuredProject.lastEditedSceneId,
  }
  const saved = await saveUserProject(userId, projectId, nextProject)
  ctx.body = { userId, project: saved }
}

export async function listProjectCategories(ctx: Context): Promise<void> {
  const rows = await UserProjectCategoryModel.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean().exec()
  ctx.body = (rows as any[]).map((row) => ({
    id: row._id.toString(),
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    sortOrder: Number(row.sortOrder ?? 0),
    enabled: row.enabled !== false,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }))
}

export async function createProjectCategory(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  try {
    const category = await createUserProjectCategory(body)
    ctx.status = 201
    ctx.body = category
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code === 11000) {
      ctx.throw(409, 'Category name already exists')
    }
    const message = (error as { message?: string }).message ?? 'Invalid category payload'
    ctx.throw(400, message)
  }
}

export async function updateProjectCategory(ctx: Context): Promise<void> {
  const categoryId = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (!categoryId || !Types.ObjectId.isValid(categoryId)) {
    ctx.throw(400, 'Invalid category id')
  }
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  try {
    const category = await updateUserProjectCategory(categoryId, body)
    if (!category) {
      ctx.throw(404, 'Category not found')
    }
    ctx.body = category
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code === 11000) {
      ctx.throw(409, 'Category name already exists')
    }
    const message = (error as { message?: string }).message ?? 'Invalid category payload'
    ctx.throw(400, message)
  }
}

export async function removeProjectCategory(ctx: Context): Promise<void> {
  const categoryId = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (!categoryId || !Types.ObjectId.isValid(categoryId)) {
    ctx.throw(400, 'Invalid category id')
  }
  const deleted = await deleteUserProjectCategory(categoryId)
  if (!deleted) {
    ctx.throw(404, 'Category not found')
  }
  // Return an explicit body instead of 204 No Content to avoid client-side
  // JSON parsing errors in some request clients that expect a response body.
  ctx.status = 200
  ctx.body = {}
}
