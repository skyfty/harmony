import type { Context } from 'koa'
import { deleteUserProjectCascade, getUserProject, listUserProjects, saveUserProject } from '@/services/userProjectService'

function ensureUserId(ctx: Context): string {
  const userId = ctx.state.user?.id
  if (!userId || typeof userId !== 'string') {
    ctx.throw(401, 'Unauthorized')
  }
  return userId
}

function ensureProjectId(ctx: Context): string {
  const projectId = ctx.params?.id
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    ctx.throw(400, 'Project id is required')
  }
  return projectId.trim()
}

export async function listProjects(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const projects = await listUserProjects(userId)
  ctx.body = { projects }
}

export async function getProject(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const projectId = ensureProjectId(ctx)
  const project = await getUserProject(userId, projectId)
  if (!project) {
    ctx.throw(404, 'Project not found')
  }
  ctx.body = { project }
}

export async function saveProject(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const projectId = ensureProjectId(ctx)
  const payload = ctx.request.body
  if (payload && typeof payload === 'object' && payload !== null) {
    const existingId = (payload as { id?: string }).id
    if (existingId && existingId !== projectId) {
      ctx.throw(400, 'Project id mismatch between path and payload')
    }
  }
  try {
    const project = await saveUserProject(userId, projectId, payload)
    ctx.body = { project }
  } catch (error) {
    const message = (error as { message?: string }).message ?? 'Invalid project document'
    if (message.includes('引用了其他工程')) {
      ctx.throw(409, message)
    }
    ctx.throw(400, message)
  }
}

export async function removeProject(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const projectId = ensureProjectId(ctx)
  const result = await deleteUserProjectCascade(userId, projectId)
  ctx.body = { result }
}
