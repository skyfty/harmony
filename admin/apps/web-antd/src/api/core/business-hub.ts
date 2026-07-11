import { requestClient } from '#/api/request';

interface ServerPageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type BusinessHubStage = 'lead' | 'quote' | 'signing' | 'production' | 'publish' | 'operation';
export type BusinessHubStatus = 'active' | 'paused' | 'completed' | 'archived';
export type BusinessHubTaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
export type BusinessHubTaskPriority = 'low' | 'medium' | 'high';
export type BusinessHubReminderStatus = 'open' | 'closed';
export type BusinessHubApprovalStatus = 'pending' | 'approved' | 'rejected';
export type BusinessHubRenewalStatus = 'pending' | 'approved' | 'rejected';
export type BusinessHubMaterialKind = 'poster' | 'qrcode' | 'copy' | 'link' | 'file';

export interface BusinessHubTaskItem {
  assignee: null | string;
  completedAt: null | string;
  createdAt: string;
  dueAt: null | string;
  id: string;
  priority: BusinessHubTaskPriority;
  remark: null | string;
  status: BusinessHubTaskStatus;
  title: string;
  updatedAt: string;
}

export interface BusinessHubReminderItem {
  closedAt: null | string;
  createdAt: string;
  dueAt: null | string;
  id: string;
  kind: 'service-expiring' | 'service-expired' | 'delivery-blocked' | 'workflow-note' | 'custom';
  message: null | string;
  status: BusinessHubReminderStatus;
  title: string;
  updatedAt: string;
}

export interface BusinessHubMaterialItem {
  content: null | string;
  createdAt: string;
  fileUrl: null | string;
  id: string;
  kind: BusinessHubMaterialKind;
  title: string;
  updatedAt: string;
  url: null | string;
}

export interface BusinessHubApprovalItem {
  createdAt: string;
  decidedAt: null | string;
  id: string;
  kind: 'quote' | 'signing' | 'delivery' | 'publish' | 'renewal' | 'custom';
  remark: null | string;
  status: BusinessHubApprovalStatus;
  title: string;
  updatedAt: string;
}

export interface BusinessHubRenewalItem {
  approvedAt: null | string;
  createdAt: string;
  durationDays: number;
  id: string;
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed';
  price: number;
  remark: null | string;
  renewalNumber: string;
  requestedAt: string;
  serviceEndAt: null | string;
  serviceStartAt: null | string;
  status: BusinessHubRenewalStatus;
  updatedAt: string;
}

export interface BusinessHubActivityItem {
  action: string;
  actorName: null | string;
  actorType: 'admin' | 'system';
  content: string;
  createdAt: string;
  id: string;
  updatedAt: string;
}

export interface BusinessHubProjectListItem {
  createdAt: string;
  customerName: string;
  customerPhone: string;
  deliverySceneSpotTitle: null | string;
  id: string;
  openReminderCount: number;
  pendingApprovalCount: number;
  projectNumber: string;
  renewalCount: number;
  renewalWarningDays: number;
  serviceDurationDays: number;
  serviceEndAt: null | string;
  servicePrice: number;
  serviceStartAt: null | string;
  serviceStatus: 'pending' | 'active' | 'expiring' | 'expired';
  sourceChannel: null | string;
  stage: BusinessHubStage;
  status: BusinessHubStatus;
  summary: null | string;
  taskCount: number;
  title: string;
  todoTaskCount: number;
  updatedAt: string;
  contractStatus: 'unsigned' | 'signed';
}

export interface BusinessHubProjectDetail extends BusinessHubProjectListItem {
  activityLogs: BusinessHubActivityItem[];
  approvals: BusinessHubApprovalItem[];
  delivery: {
    boundAt: null | string;
    sceneId: null | string;
    sceneSpotId: null | string;
    sceneSpotTitle: null | string;
  };
  materials: BusinessHubMaterialItem[];
  notes: null | string;
  reminders: BusinessHubReminderItem[];
  renewals: BusinessHubRenewalItem[];
  tasks: BusinessHubTaskItem[];
}

export interface BusinessHubDashboard {
  activeProjects: number;
  expiredProjects: number;
  expiringProjects: number;
  openReminders: number;
  pendingApprovals: number;
  todoTasks: number;
  totalProjects: number;
  totalRenewals: number;
}

export interface BusinessHubProjectQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
  serviceStatus?: '' | 'active' | 'expiring' | 'expired' | 'pending';
  stage?: '' | BusinessHubStage;
  status?: '' | BusinessHubStatus;
}

export function getBusinessHubDashboardApi() {
  return requestClient.get<BusinessHubDashboard>('/admin/business-hub/dashboard');
}

export async function listBusinessHubProjectsApi(params: BusinessHubProjectQuery) {
  const response = await requestClient.get<ServerPageResult<BusinessHubProjectListItem>>('/admin/business-hub/projects', {
    params,
  });
  return {
    items: response.data || [],
    total: response.total || 0,
    page: response.page || 1,
    pageSize: response.pageSize || 20,
  };
}

export function getBusinessHubProjectApi(id: string) {
  return requestClient.get<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}`);
}

export function createBusinessHubProjectApi(payload: {
  customerName: string;
  customerPhone: string;
  notes?: string;
  sourceChannel?: string;
  summary?: string;
  title: string;
}) {
  return requestClient.post<BusinessHubProjectDetail>('/admin/business-hub/projects', payload);
}

export function updateBusinessHubProjectApi(id: string, payload: Partial<{
  customerName: string;
  customerPhone: string;
  notes: string;
  renewalWarningDays: number;
  serviceDurationDays: number;
  serviceEndAt: string | null;
  servicePrice: number;
  serviceStartAt: string | null;
  sourceChannel: string | null;
  status: BusinessHubStatus;
  summary: string | null;
  title: string;
}>) {
  return requestClient.put<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}`, payload);
}

export function signBusinessHubProjectApi(id: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/sign`, {});
}

export function advanceBusinessHubProductionApi(id: string, remark?: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/production/advance`, { remark });
}

export function completeBusinessHubProductionApi(id: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/production/complete`, {});
}

export function completeBusinessHubPublishApi(id: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/publish/complete`, {});
}

export function completeBusinessHubOperationApi(id: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/operation/complete`, {});
}

export function bindBusinessHubDeliveryApi(id: string, payload: { sceneSpotId: string }) {
  return requestClient.put<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/delivery-binding`, payload);
}

export function createBusinessHubTaskApi(id: string, payload: {
  assignee?: string | null;
  dueAt?: string | null;
  priority?: BusinessHubTaskPriority;
  remark?: string | null;
  status?: BusinessHubTaskStatus;
  title: string;
}) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/tasks`, payload);
}

export function updateBusinessHubTaskApi(taskId: string, payload: Partial<{
  assignee: string | null;
  dueAt: string | null;
  priority: BusinessHubTaskPriority;
  remark: string | null;
  status: BusinessHubTaskStatus;
  title: string;
}>) {
  return requestClient.put<BusinessHubProjectDetail>(`/admin/business-hub/tasks/${taskId}`, payload);
}

export function completeBusinessHubTaskApi(taskId: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/tasks/${taskId}/complete`, {});
}

export function blockBusinessHubTaskApi(taskId: string, remark?: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/tasks/${taskId}/block`, { remark });
}

export function createBusinessHubReminderApi(id: string, payload: {
  dueAt?: string | null;
  kind?: BusinessHubReminderItem['kind'];
  message?: string | null;
  title: string;
}) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/reminders`, payload);
}

export function closeBusinessHubReminderApi(reminderId: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/reminders/${reminderId}/close`, {});
}

export function createBusinessHubMaterialApi(id: string, payload: {
  content?: string | null;
  fileUrl?: string | null;
  kind?: BusinessHubMaterialKind;
  title: string;
  url?: string | null;
}) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/materials`, payload);
}

export function deleteBusinessHubMaterialApi(materialId: string) {
  return requestClient.delete<BusinessHubProjectDetail>(`/admin/business-hub/materials/${materialId}`);
}

export function createBusinessHubApprovalApi(id: string, payload: {
  kind?: BusinessHubApprovalItem['kind'];
  remark?: string | null;
  title: string;
}) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/approvals`, payload);
}

export function decideBusinessHubApprovalApi(approvalId: string, payload: {
  remark?: string | null;
  status: 'approved' | 'rejected';
}) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/approvals/${approvalId}/decide`, payload);
}

export function createBusinessHubRenewalApi(id: string, payload: {
  durationDays?: number;
  price?: number;
  remark?: string | null;
}) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/projects/${id}/renewals`, payload);
}

export function approveBusinessHubRenewalApi(renewalId: string) {
  return requestClient.post<BusinessHubProjectDetail>(`/admin/business-hub/renewals/${renewalId}/approve`, {});
}
