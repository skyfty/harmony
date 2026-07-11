export type BusinessHubStage = 'lead' | 'quote' | 'signing' | 'production' | 'publish' | 'operation'
export type BusinessHubStatus = 'active' | 'paused' | 'completed' | 'archived'
export type BusinessHubContractStatus = 'unsigned' | 'signed'
export type BusinessHubServiceStatus = 'pending' | 'active' | 'expiring' | 'expired'
export type BusinessHubTaskStatus = 'todo' | 'doing' | 'done' | 'blocked'
export type BusinessHubTaskPriority = 'low' | 'medium' | 'high'
export type BusinessHubReminderStatus = 'open' | 'closed'
export type BusinessHubApprovalStatus = 'pending' | 'approved' | 'rejected'
export type BusinessHubRenewalStatus = 'pending' | 'approved' | 'rejected'
export type BusinessHubMaterialKind = 'poster' | 'qrcode' | 'copy' | 'link' | 'file'

export interface BusinessHubDashboard {
  totalProjects: number
  activeProjects: number
  expiringProjects: number
  expiredProjects: number
  todoTasks: number
  openReminders: number
  pendingApprovals: number
  totalRenewals: number
}

export interface BusinessHubTask {
  id: string
  title: string
  status: BusinessHubTaskStatus
  priority: BusinessHubTaskPriority
  assignee: string | null
  dueAt: string | null
  remark: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BusinessHubReminder {
  id: string
  kind: 'service-expiring' | 'service-expired' | 'delivery-blocked' | 'workflow-note' | 'custom'
  title: string
  message: string | null
  status: BusinessHubReminderStatus
  dueAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BusinessHubMaterial {
  id: string
  kind: BusinessHubMaterialKind
  title: string
  content: string | null
  url: string | null
  fileUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface BusinessHubApproval {
  id: string
  kind: 'quote' | 'signing' | 'delivery' | 'publish' | 'renewal' | 'custom'
  title: string
  status: BusinessHubApprovalStatus
  remark: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BusinessHubRenewal {
  id: string
  renewalNumber: string
  status: BusinessHubRenewalStatus
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
  durationDays: number
  price: number
  serviceStartAt: string | null
  serviceEndAt: string | null
  requestedAt: string
  approvedAt: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface BusinessHubActivity {
  id: string
  action: string
  actorType: 'admin' | 'system'
  actorName: string | null
  content: string
  createdAt: string
  updatedAt: string
}

export interface BusinessHubProjectListItem {
  id: string
  projectNumber: string
  title: string
  customerName: string
  customerPhone: string
  sourceChannel: string | null
  summary: string | null
  stage: BusinessHubStage
  status: BusinessHubStatus
  contractStatus: BusinessHubContractStatus
  serviceStatus: BusinessHubServiceStatus
  serviceDurationDays: number
  servicePrice: number
  serviceStartAt: string | null
  serviceEndAt: string | null
  renewalWarningDays: number
  deliverySceneSpotTitle: string | null
  taskCount: number
  todoTaskCount: number
  openReminderCount: number
  pendingApprovalCount: number
  renewalCount: number
  updatedAt: string
  createdAt: string
}

export interface BusinessHubProject extends BusinessHubProjectListItem {
  notes: string | null
  delivery: {
    sceneId: string | null
    sceneSpotId: string | null
    sceneSpotTitle: string | null
    boundAt: string | null
  }
  tasks: BusinessHubTask[]
  reminders: BusinessHubReminder[]
  materials: BusinessHubMaterial[]
  approvals: BusinessHubApproval[]
  renewals: BusinessHubRenewal[]
  activityLogs: BusinessHubActivity[]
}

export interface BusinessHubBootstrapData {
  hasBoundPhone: boolean
  customerPhone: string | null
  dashboard: BusinessHubDashboard
  latestProject: BusinessHubProjectListItem | null
  projects: BusinessHubProjectListItem[]
}

export interface BusinessHubRenewalPreview {
  amount: number
  currentServiceEndAt: string | null
  durationDays: number
  nextServiceEndAt: string
  nextServiceStartAt: string
}

export interface CreateBusinessHubRenewalPayload {
  durationDays?: number | string
  price?: number | string
  remark?: string | null
}

export interface UpdateBusinessHubTaskPayload {
  status: BusinessHubTaskStatus
  remark?: string | null
}

export interface DecideBusinessHubApprovalPayload {
  status: BusinessHubApprovalStatus
  remark?: string | null
}
