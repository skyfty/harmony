import type { Context } from 'koa'
import {
  advanceBusinessHubProduction,
  approveBusinessHubRenewal,
  bindBusinessHubDelivery,
  blockBusinessHubTask,
  closeBusinessHubReminder,
  closeBusinessHubTask,
  completeBusinessHubOperation,
  completeBusinessHubProduction,
  completeBusinessHubPublish,
  createBusinessHubApproval,
  createBusinessHubMaterial,
  createBusinessHubProject,
  createBusinessHubReminder,
  createBusinessHubRenewal,
  createBusinessHubTask,
  decideBusinessHubApproval,
  deleteBusinessHubMaterial,
  getBusinessHubDashboard,
  getBusinessHubProject,
  listBusinessHubProjects,
  signBusinessHubProject,
  updateBusinessHubProject,
  updateBusinessHubTask,
} from '@/services/businessHubService'

function getErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : ''
  if (
    message === 'Business project not found' ||
    message === 'Scene spot not found' ||
    message === 'Task not found' ||
    message === 'Reminder not found' ||
    message === 'Approval not found' ||
    message === 'Renewal not found'
  ) {
    return 404
  }
  if (
    message === 'Invalid business project id' ||
    message === 'Invalid scene spot id' ||
    message === 'Invalid scene id'
  ) {
    return 400
  }
  return 400
}

function getBody<T extends Record<string, unknown>>(ctx: Context): T {
  return (ctx.request.body ?? {}) as T
}

export async function getBusinessHubDashboardHandler(ctx: Context): Promise<void> {
  ctx.body = await getBusinessHubDashboard()
}

export async function listBusinessHubProjectsHandler(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', keyword, stage, status, serviceStatus } = ctx.query as Record<string, string>
  ctx.body = await listBusinessHubProjects({
    page: Number(page),
    pageSize: Number(pageSize),
    keyword,
    stage: stage === 'lead' || stage === 'quote' || stage === 'signing' || stage === 'production' || stage === 'publish' || stage === 'operation' ? stage : undefined,
    status: status === 'active' || status === 'paused' || status === 'completed' || status === 'archived' ? status : undefined,
    serviceStatus: serviceStatus === 'pending' || serviceStatus === 'active' || serviceStatus === 'expiring' || serviceStatus === 'expired' ? serviceStatus : undefined,
  })
}

export async function getBusinessHubProjectHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await getBusinessHubProject(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Load business project failed')
  }
}

export async function createBusinessHubProjectHandler(ctx: Context): Promise<void> {
  try {
    ctx.status = 201
    ctx.body = await createBusinessHubProject(getBody(ctx) as any)
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Create business project failed')
  }
}

export async function updateBusinessHubProjectHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await updateBusinessHubProject(String(ctx.params?.id || ''), getBody(ctx) as any)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Update business project failed')
  }
}

export async function signBusinessHubProjectHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await signBusinessHubProject(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Sign business project failed')
  }
}

export async function advanceBusinessHubProductionHandler(ctx: Context): Promise<void> {
  try {
    const { remark } = getBody<{ remark?: unknown }>(ctx)
    ctx.body = await advanceBusinessHubProduction(String(ctx.params?.id || ''), typeof remark === 'string' ? remark : null)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Advance business production failed')
  }
}

export async function completeBusinessHubProductionHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await completeBusinessHubProduction(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Complete business production failed')
  }
}

export async function completeBusinessHubPublishHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await completeBusinessHubPublish(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Complete business publish failed')
  }
}

export async function completeBusinessHubOperationHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await completeBusinessHubOperation(String(ctx.params?.id || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Complete business operation failed')
  }
}

export async function bindBusinessHubDeliveryHandler(ctx: Context): Promise<void> {
  try {
    const { sceneSpotId } = getBody<{ sceneSpotId?: unknown }>(ctx)
    if (typeof sceneSpotId !== 'string' || !sceneSpotId.trim()) {
      ctx.throw(400, '请选择交付场景')
      return
    }
    ctx.body = await bindBusinessHubDelivery(String(ctx.params?.id || ''), sceneSpotId)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Bind delivery failed')
  }
}

export async function createBusinessHubTaskHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await createBusinessHubTask(String(ctx.params?.id || ''), getBody(ctx) as any)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Create task failed')
  }
}

export async function updateBusinessHubTaskHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await updateBusinessHubTask(String(ctx.params?.taskId || ''), getBody(ctx) as any)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Update task failed')
  }
}

export async function closeBusinessHubTaskHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await closeBusinessHubTask(String(ctx.params?.taskId || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Close task failed')
  }
}

export async function blockBusinessHubTaskHandler(ctx: Context): Promise<void> {
  try {
    const { remark } = getBody<{ remark?: unknown }>(ctx)
    ctx.body = await blockBusinessHubTask(String(ctx.params?.taskId || ''), typeof remark === 'string' ? remark : null)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Block task failed')
  }
}

export async function createBusinessHubReminderHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await createBusinessHubReminder(String(ctx.params?.id || ''), getBody(ctx) as any)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Create reminder failed')
  }
}

export async function closeBusinessHubReminderHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await closeBusinessHubReminder(String(ctx.params?.reminderId || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Close reminder failed')
  }
}

export async function createBusinessHubMaterialHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await createBusinessHubMaterial(String(ctx.params?.id || ''), getBody(ctx) as any)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Create material failed')
  }
}

export async function deleteBusinessHubMaterialHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await deleteBusinessHubMaterial(String(ctx.params?.materialId || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Delete material failed')
  }
}

export async function createBusinessHubApprovalHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await createBusinessHubApproval(String(ctx.params?.id || ''), getBody(ctx) as any)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Create approval failed')
  }
}

export async function decideBusinessHubApprovalHandler(ctx: Context): Promise<void> {
  try {
    const { status, remark } = getBody<{ status?: unknown; remark?: unknown }>(ctx)
    if (status !== 'approved' && status !== 'rejected') {
      ctx.throw(400, '审批状态无效')
      return
    }
    ctx.body = await decideBusinessHubApproval(String(ctx.params?.approvalId || ''), status, typeof remark === 'string' ? remark : null)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Decide approval failed')
  }
}

export async function createBusinessHubRenewalHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await createBusinessHubRenewal(String(ctx.params?.id || ''), getBody(ctx) as any)
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Create renewal failed')
  }
}

export async function approveBusinessHubRenewalHandler(ctx: Context): Promise<void> {
  try {
    ctx.body = await approveBusinessHubRenewal(String(ctx.params?.renewalId || ''))
  } catch (error) {
    ctx.throw(getErrorStatus(error), error instanceof Error ? error.message : 'Approve renewal failed')
  }
}
