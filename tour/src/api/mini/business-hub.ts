import type {
  BusinessHubBootstrapData,
  BusinessHubProject,
  BusinessHubProject,
  BusinessHubProjectListItem,
  BusinessHubRenewal,
  BusinessHubRenewalPreview,
  CreateBusinessHubRenewalPayload,
  DecideBusinessHubApprovalPayload,
  UpdateBusinessHubTaskPayload,
} from '@/types/business-hub'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

export interface BusinessHubRenewalCheckoutResult {
  renewal: BusinessHubRenewal
  orderNumber: string
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
  payParams?: {
    appId: string
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
  } | null
}

export async function getBusinessHubBootstrap(): Promise<BusinessHubBootstrapData> {
  await ensureMiniAuth()
  return await miniRequest<BusinessHubBootstrapData>('/business-hub/bootstrap', {
    method: 'GET',
  })
}

export async function listBusinessHubProjects(): Promise<BusinessHubProjectListItem[]> {
  await ensureMiniAuth()
  return await miniRequest<BusinessHubProjectListItem[]>('/business-hub/projects', {
    method: 'GET',
  })
}

export async function getBusinessHubProjectDetail(id: string): Promise<BusinessHubProject> {
  await ensureMiniAuth()
  return await miniRequest<BusinessHubProject>(`/business-hub/projects/${encodeURIComponent(id)}`, {
    method: 'GET',
  })
}

export async function getBusinessHubRenewalPreview(id: string): Promise<BusinessHubRenewalPreview> {
  await ensureMiniAuth()
  return await miniRequest<BusinessHubRenewalPreview>(`/business-hub/projects/${encodeURIComponent(id)}/renewal-preview`, {
    method: 'GET',
  })
}

export async function createBusinessHubRenewal(id: string, payload: CreateBusinessHubRenewalPayload = {}): Promise<BusinessHubRenewalCheckoutResult> {
  await ensureMiniAuth()
  return await miniRequest<BusinessHubRenewalCheckoutResult>(`/business-hub/projects/${encodeURIComponent(id)}/renewals`, {
    method: 'POST',
    body: payload,
  })
}

export async function updateBusinessHubTaskStatus(taskId: string, payload: UpdateBusinessHubTaskPayload): Promise<BusinessHubProject> {
  await ensureMiniAuth()
  return await miniRequest<BusinessHubProject>(`/business-hub/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'POST',
    body: payload,
  })
}

export async function closeBusinessHubReminder(reminderId: string): Promise<BusinessHubProject> {
  await ensureMiniAuth()
  return await miniRequest<BusinessHubProject>(`/business-hub/reminders/${encodeURIComponent(reminderId)}/close`, {
    method: 'POST',
  })
}

export async function decideBusinessHubApproval(approvalId: string, payload: DecideBusinessHubApprovalPayload): Promise<BusinessHubProject> {
  await ensureMiniAuth()
  return await miniRequest<BusinessHubProject>(`/business-hub/approvals/${encodeURIComponent(approvalId)}/decide`, {
    method: 'POST',
    body: payload,
  })
}
