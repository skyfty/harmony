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
import { getUserProject, saveUserProject } from '@/services/userProjectService'

function ensureCurrentUserId(ctx: Context): string {
  const userId = ctx.state.user?.id
  if (!userId || typeof userId !== 'string') {
    ctx.throw(401, 'Unauthorized')
  }
  return userId
}

function canManageAllUsers(ctx: Context): boolean {
  const permissions = Array.isArray(ctx.state.user?.permissions) ? ctx.state.user?.permissions : []
  if (permissions?.includes('admin:super')) {
    return true
  }
  const roles = Array.isArray(ctx.state.user?.roles) ? ctx.state.user?.roles : []
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
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

function readRequestFiles(ctx: Context): Record<string, unknown> | undefined {
  return (ctx.request as unknown as { files?: Record<string, unknown> }).files
}

export async function listProjects(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, categoryId, userId } = ctx.query as Record<string, string>
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
  const project = await getUserProject(userId, projectId)
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
  await UserProjectModel.findOneAndDelete({ userId, projectId }).lean().exec()
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
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

  const file = extractUploadedFile(readRequestFiles(ctx), 'file')
  if (!file) {
    ctx.throw(400, 'Scene bundle file is required')
  }

  const stored = await saveUserSceneBundle(userId, sceneId, file as UploadedFilePayload)
  if (stored.projectId !== projectId) {
    await deleteUserScene(userId, sceneId)
    ctx.throw(409, 'Scene bundle projectId mismatch')
  }

  const existingMeta = project.scenes.find((entry) => entry.id === sceneId)
  const sceneMeta = {
    id: sceneId,
    name: stored.name,
    sceneJsonUrl: buildSceneJsonUrl(sceneId),
    projectId,
  }
  const nextScenes = existingMeta
    ? project.scenes.map((entry) => (entry.id === sceneId ? sceneMeta : entry))
    : [...project.scenes, sceneMeta]
  const nextProject = {
    ...project,
    scenes: nextScenes,
    lastEditedSceneId: project.lastEditedSceneId ?? sceneId,
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

  await deleteUserScene(userId, sceneId)

  const nextScenes = project.scenes.filter((entry) => entry.id !== sceneId)
  const nextProject = {
    ...project,
    scenes: nextScenes,
    lastEditedSceneId: project.lastEditedSceneId === sceneId ? (nextScenes[0]?.id ?? null) : project.lastEditedSceneId,
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
