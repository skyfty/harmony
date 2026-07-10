import { Types } from 'mongoose'
import { SceneSpotModel } from '@/models/SceneSpot'
import { BusinessHubProjectModel } from '@/models/BusinessHubProject'
import { createOrderPayment } from '@/services/paymentService'

type BusinessHubStage = 'lead' | 'quote' | 'signing' | 'production' | 'publish' | 'operation'
type BusinessHubStatus = 'active' | 'paused' | 'completed' | 'archived'
type BusinessHubTaskStatus = 'todo' | 'doing' | 'done' | 'blocked'
type BusinessHubTaskPriority = 'low' | 'medium' | 'high'
type BusinessHubReminderStatus = 'open' | 'closed'
type BusinessHubApprovalStatus = 'pending' | 'approved' | 'rejected'
type BusinessHubRenewalStatus = 'pending' | 'approved' | 'rejected'
type BusinessHubMaterialKind = 'poster' | 'qrcode' | 'copy' | 'link' | 'file'

export interface BusinessHubTaskView {
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

export interface BusinessHubReminderView {
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

export interface BusinessHubMaterialView {
  id: string
  kind: BusinessHubMaterialKind
  title: string
  content: string | null
  url: string | null
  fileUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface BusinessHubApprovalView {
  id: string
  kind: 'quote' | 'signing' | 'delivery' | 'publish' | 'renewal' | 'custom'
  title: string
  status: BusinessHubApprovalStatus
  remark: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BusinessHubRenewalView {
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

export interface BusinessHubRenewalPaymentResult {
  renewal: BusinessHubRenewalView
  orderNumber: string
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
  payParams: {
    appId: string
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
  } | null
}

export interface BusinessHubActivityView {
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
  contractStatus: 'unsigned' | 'signed'
  serviceStatus: 'pending' | 'active' | 'expiring' | 'expired'
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

export interface BusinessHubProjectView extends BusinessHubProjectListItem {
  notes: string | null
  delivery: {
    sceneId: string | null
    sceneSpotId: string | null
    sceneSpotTitle: string | null
    boundAt: string | null
  }
  tasks: BusinessHubTaskView[]
  reminders: BusinessHubReminderView[]
  materials: BusinessHubMaterialView[]
  approvals: BusinessHubApprovalView[]
  renewals: BusinessHubRenewalView[]
  activityLogs: BusinessHubActivityView[]
}

export interface BusinessHubDashboardView {
  totalProjects: number
  activeProjects: number
  expiringProjects: number
  expiredProjects: number
  todoTasks: number
  openReminders: number
  pendingApprovals: number
  totalRenewals: number
}

export interface BusinessHubProjectQuery {
  keyword?: string
  stage?: BusinessHubStage
  status?: BusinessHubStatus
  serviceStatus?: 'pending' | 'active' | 'expiring' | 'expired'
  page?: number
  pageSize?: number
}

export interface BusinessHubProjectInput {
  title: string
  customerName: string
  customerPhone: string
  sourceChannel?: string | null
  summary?: string | null
  notes?: string | null
}

export interface BusinessHubProjectUpdateInput {
  title?: unknown
  customerName?: unknown
  customerPhone?: unknown
  sourceChannel?: unknown
  summary?: unknown
  notes?: unknown
  serviceDurationDays?: unknown
  servicePrice?: unknown
  serviceStartAt?: unknown
  serviceEndAt?: unknown
  renewalWarningDays?: unknown
  status?: unknown
}

export interface BusinessHubTaskInput {
  title: string
  status?: BusinessHubTaskStatus
  priority?: BusinessHubTaskPriority
  assignee?: string | null
  dueAt?: unknown
  remark?: string | null
}

export interface BusinessHubReminderInput {
  kind?: 'service-expiring' | 'service-expired' | 'delivery-blocked' | 'workflow-note' | 'custom'
  title: string
  message?: string | null
  dueAt?: unknown
}

export interface BusinessHubMaterialInput {
  kind?: BusinessHubMaterialKind
  title: string
  content?: string | null
  url?: string | null
  fileUrl?: string | null
}

export interface BusinessHubApprovalInput {
  kind?: 'quote' | 'signing' | 'delivery' | 'publish' | 'renewal' | 'custom'
  title: string
  remark?: string | null
}

export interface BusinessHubRenewalInput {
  durationDays?: unknown
  price?: unknown
  remark?: string | null
}

const DEFAULT_SERVICE_DURATION_DAYS = 365
const DEFAULT_SERVICE_PRICE = 0
const DEFAULT_WARNING_DAYS = 15

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableString(value: unknown): string | null {
  const text = normalizeString(value)
  return text || null
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('数值无效')
  }
  return Math.floor(parsed)
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('数值无效')
  }
  return parsed
}

function normalizeDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new Error('时间格式无效')
  }
  return date
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function toIso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function objectId(): string {
  return new Types.ObjectId().toString()
}

function generateProjectNumber(prefix = 'BH'): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const random = Math.floor(Math.random() * 9000 + 1000)
  return `${prefix}${stamp}${random}`
}

function generateRenewalNumber(prefix = 'BR'): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const random = Math.floor(Math.random() * 9000 + 1000)
  return `${prefix}${stamp}${random}`
}

function getServiceStatus(project: {
  serviceStartAt?: Date | null
  serviceEndAt?: Date | null
  stage?: BusinessHubStage
  renewalWarningDays?: number | null
}, now = new Date()): 'pending' | 'active' | 'expiring' | 'expired' {
  if ((project.stage ?? 'lead') !== 'operation' || !project.serviceStartAt || !project.serviceEndAt) {
    return 'pending'
  }
  const endAt = project.serviceEndAt.getTime()
  const diffDays = Math.ceil((endAt - now.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays <= 0) {
    return 'expired'
  }
  const warningDays = Math.max(Number(project.renewalWarningDays) || DEFAULT_WARNING_DAYS, 1)
  if (diffDays <= warningDays) {
    return 'expiring'
  }
  return 'active'
}

function buildDefaultTasks(): Array<{ _id: string; title: string; status: BusinessHubTaskStatus; priority: BusinessHubTaskPriority; assignee: string | null; dueAt: Date | null; remark: string | null; completedAt: Date | null; createdAt: Date; updatedAt: Date }> {
  const now = new Date()
  return [
    { _id: objectId(), title: '需求确认', status: 'doing', priority: 'high', assignee: null, dueAt: null, remark: null, completedAt: null, createdAt: now, updatedAt: now },
    { _id: objectId(), title: '资料收集', status: 'todo', priority: 'high', assignee: null, dueAt: null, remark: null, completedAt: null, createdAt: now, updatedAt: now },
    { _id: objectId(), title: '场景制作', status: 'todo', priority: 'medium', assignee: null, dueAt: null, remark: null, completedAt: null, createdAt: now, updatedAt: now },
    { _id: objectId(), title: '效果验收', status: 'todo', priority: 'medium', assignee: null, dueAt: null, remark: null, completedAt: null, createdAt: now, updatedAt: now },
    { _id: objectId(), title: '上线交付', status: 'todo', priority: 'high', assignee: null, dueAt: null, remark: null, completedAt: null, createdAt: now, updatedAt: now },
  ]
}

function buildInitialApprovals() {
  const now = new Date()
  return [
    {
      _id: objectId(),
      kind: 'quote' as const,
      title: '报价确认',
      status: 'pending' as const,
      remark: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function buildInitialReminders() {
  const now = new Date()
  return [
    {
      _id: objectId(),
      kind: 'workflow-note' as const,
      title: '请尽快确认客户需求与交付资料',
      message: '新项目已创建，可在任务板继续推进签约、制作与上线。',
      status: 'open' as const,
      dueAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function pushActivity(project: any, action: string, content: string, actorType: 'admin' | 'system' = 'system', actorName: string | null = null) {
  const now = new Date()
  project.activityLogs = [
    ...(Array.isArray(project.activityLogs) ? project.activityLogs : []),
    {
      _id: objectId(),
      action,
      actorType,
      actorName,
      content,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function refreshServiceStatus(project: any) {
  project.serviceStatus = getServiceStatus(project)
}

function mapTask(item: any): BusinessHubTaskView {
  return {
    id: String(item._id),
    title: String(item.title ?? ''),
    status: item.status === 'doing' || item.status === 'done' || item.status === 'blocked' ? item.status : 'todo',
    priority: item.priority === 'high' || item.priority === 'low' ? item.priority : 'medium',
    assignee: normalizeNullableString(item.assignee),
    dueAt: toIso(item.dueAt),
    remark: normalizeNullableString(item.remark),
    completedAt: toIso(item.completedAt),
    createdAt: toIso(item.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(item.updatedAt) ?? new Date().toISOString(),
  }
}

function mapReminder(item: any): BusinessHubReminderView {
  return {
    id: String(item._id),
    kind: item.kind || 'custom',
    title: String(item.title ?? ''),
    message: normalizeNullableString(item.message),
    status: item.status === 'closed' ? 'closed' : 'open',
    dueAt: toIso(item.dueAt),
    closedAt: toIso(item.closedAt),
    createdAt: toIso(item.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(item.updatedAt) ?? new Date().toISOString(),
  }
}

function mapMaterial(item: any): BusinessHubMaterialView {
  return {
    id: String(item._id),
    kind: item.kind || 'copy',
    title: String(item.title ?? ''),
    content: normalizeNullableString(item.content),
    url: normalizeNullableString(item.url),
    fileUrl: normalizeNullableString(item.fileUrl),
    createdAt: toIso(item.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(item.updatedAt) ?? new Date().toISOString(),
  }
}

function mapApproval(item: any): BusinessHubApprovalView {
  return {
    id: String(item._id),
    kind: item.kind || 'custom',
    title: String(item.title ?? ''),
    status: item.status === 'approved' || item.status === 'rejected' ? item.status : 'pending',
    remark: normalizeNullableString(item.remark),
    decidedAt: toIso(item.decidedAt),
    createdAt: toIso(item.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(item.updatedAt) ?? new Date().toISOString(),
  }
}

function mapRenewal(item: any): BusinessHubRenewalView {
  return {
    id: String(item._id),
    renewalNumber: String(item.renewalNumber ?? ''),
    status: item.status === 'approved' || item.status === 'rejected' ? item.status : 'pending',
    paymentStatus: item.paymentStatus || 'unpaid',
    durationDays: Math.max(Number(item.durationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1),
    price: Math.max(Number(item.price) || DEFAULT_SERVICE_PRICE, 0),
    serviceStartAt: toIso(item.serviceStartAt),
    serviceEndAt: toIso(item.serviceEndAt),
    requestedAt: toIso(item.requestedAt) ?? new Date().toISOString(),
    approvedAt: toIso(item.approvedAt),
    remark: normalizeNullableString(item.remark),
    createdAt: toIso(item.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(item.updatedAt) ?? new Date().toISOString(),
  }
}

function mapActivity(item: any): BusinessHubActivityView {
  return {
    id: String(item._id),
    action: String(item.action ?? ''),
    actorType: item.actorType === 'admin' ? 'admin' : 'system',
    actorName: normalizeNullableString(item.actorName),
    content: String(item.content ?? ''),
    createdAt: toIso(item.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(item.updatedAt) ?? new Date().toISOString(),
  }
}

function mapProject(project: any): BusinessHubProjectView {
  const tasks = Array.isArray(project.tasks) ? project.tasks : []
  const reminders = Array.isArray(project.reminders) ? project.reminders : []
  const approvals = Array.isArray(project.approvals) ? project.approvals : []
  const renewals = Array.isArray(project.renewals) ? project.renewals : []
  const openReminders = reminders.filter((item: any) => item.status !== 'closed').length
  const pendingApprovals = approvals.filter((item: any) => item.status === 'pending').length
  const todoTaskCount = tasks.filter((item: any) => item.status === 'todo' || item.status === 'doing' || item.status === 'blocked').length
  return {
    id: String(project._id),
    projectNumber: String(project.projectNumber ?? ''),
    title: String(project.title ?? ''),
    customerName: String(project.customerName ?? ''),
    customerPhone: String(project.customerPhone ?? ''),
    sourceChannel: normalizeNullableString(project.sourceChannel),
    summary: normalizeNullableString(project.summary),
    stage: project.stage || 'lead',
    status: project.status || 'active',
    contractStatus: project.contractStatus === 'signed' ? 'signed' : 'unsigned',
    serviceStatus: project.serviceStatus || getServiceStatus(project),
    serviceDurationDays: Math.max(Number(project.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1),
    servicePrice: Math.max(Number(project.servicePrice) || DEFAULT_SERVICE_PRICE, 0),
    serviceStartAt: toIso(project.serviceStartAt),
    serviceEndAt: toIso(project.serviceEndAt),
    renewalWarningDays: Math.max(Number(project.renewalWarningDays) || DEFAULT_WARNING_DAYS, 1),
    deliverySceneSpotTitle: normalizeNullableString(project.deliverySceneSpotTitle),
    taskCount: tasks.length,
    todoTaskCount,
    openReminderCount: openReminders,
    pendingApprovalCount: pendingApprovals,
    renewalCount: renewals.length,
    updatedAt: toIso(project.updatedAt) ?? new Date().toISOString(),
    createdAt: toIso(project.createdAt) ?? new Date().toISOString(),
    notes: normalizeNullableString(project.notes),
    delivery: {
      sceneId: project.deliverySceneId ? String(project.deliverySceneId) : null,
      sceneSpotId: project.deliverySceneSpotId ? String(project.deliverySceneSpotId) : null,
      sceneSpotTitle: normalizeNullableString(project.deliverySceneSpotTitle),
      boundAt: toIso(project.deliveryBoundAt),
    },
    tasks: tasks.map(mapTask),
    reminders: reminders.map(mapReminder),
    materials: Array.isArray(project.materials) ? project.materials.map(mapMaterial) : [],
    approvals: approvals.map(mapApproval),
    renewals: renewals.map(mapRenewal),
    activityLogs: Array.isArray(project.activityLogs) ? project.activityLogs.map(mapActivity) : [],
  }
}

function mapProjectListItem(project: any): BusinessHubProjectListItem {
  const tasks = Array.isArray(project.tasks) ? project.tasks : []
  const reminders = Array.isArray(project.reminders) ? project.reminders : []
  const approvals = Array.isArray(project.approvals) ? project.approvals : []
  const renewals = Array.isArray(project.renewals) ? project.renewals : []
  const openReminders = reminders.filter((item: any) => item.status !== 'closed').length
  const pendingApprovals = approvals.filter((item: any) => item.status === 'pending').length
  const todoTaskCount = tasks.filter((item: any) => item.status === 'todo' || item.status === 'doing' || item.status === 'blocked').length
  return {
    id: String(project._id),
    projectNumber: String(project.projectNumber ?? ''),
    title: String(project.title ?? ''),
    customerName: String(project.customerName ?? ''),
    customerPhone: String(project.customerPhone ?? ''),
    sourceChannel: normalizeNullableString(project.sourceChannel),
    summary: normalizeNullableString(project.summary),
    stage: project.stage || 'lead',
    status: project.status || 'active',
    contractStatus: project.contractStatus === 'signed' ? 'signed' : 'unsigned',
    serviceStatus: project.serviceStatus || getServiceStatus(project),
    serviceDurationDays: Math.max(Number(project.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1),
    servicePrice: Math.max(Number(project.servicePrice) || DEFAULT_SERVICE_PRICE, 0),
    serviceStartAt: toIso(project.serviceStartAt),
    serviceEndAt: toIso(project.serviceEndAt),
    renewalWarningDays: Math.max(Number(project.renewalWarningDays) || DEFAULT_WARNING_DAYS, 1),
    deliverySceneSpotTitle: normalizeNullableString(project.deliverySceneSpotTitle),
    taskCount: tasks.length,
    todoTaskCount,
    openReminderCount: openReminders,
    pendingApprovalCount: pendingApprovals,
    renewalCount: renewals.length,
    updatedAt: toIso(project.updatedAt) ?? new Date().toISOString(),
    createdAt: toIso(project.createdAt) ?? new Date().toISOString(),
  }
}

function buildQuery(query: BusinessHubProjectQuery): Record<string, unknown> {
  const keyword = normalizeString(query.keyword)
  const filters: Record<string, unknown> = {}
  if (keyword) {
    filters.$or = [
      { title: new RegExp(keyword, 'i') },
      { customerName: new RegExp(keyword, 'i') },
      { customerPhone: new RegExp(keyword, 'i') },
      { projectNumber: new RegExp(keyword, 'i') },
    ]
  }
  if (query.stage) {
    filters.stage = query.stage
  }
  if (query.status) {
    filters.status = query.status
  }
  if (query.serviceStatus) {
    filters.serviceStatus = query.serviceStatus
  }
  return filters
}

function ensureProjectDates(project: any) {
  if (project.serviceStartAt && project.serviceEndAt && project.serviceEndAt.getTime() <= project.serviceStartAt.getTime()) {
    throw new Error('服务结束时间必须晚于开始时间')
  }
  refreshServiceStatus(project)
}

async function loadProject(id: string): Promise<any> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('Invalid business project id')
  }
  const project = await BusinessHubProjectModel.findById(id).exec()
  if (!project) {
    throw new Error('Business project not found')
  }
  return project
}

export async function getBusinessHubDashboard(): Promise<BusinessHubDashboardView> {
  const projects = await BusinessHubProjectModel.find(
    {},
    {
      stage: 1,
      status: 1,
      serviceStatus: 1,
      tasks: 1,
      reminders: 1,
      approvals: 1,
      renewals: 1,
    },
  )
    .lean()
    .exec()

  const totalProjects = projects.length
  const activeProjects = projects.filter((item) => item.status === 'active').length
  const expiringProjects = projects.filter((item) => item.serviceStatus === 'expiring').length
  const expiredProjects = projects.filter((item) => item.serviceStatus === 'expired').length
  const todoTasks = projects.reduce((sum, item) => {
    const tasks = Array.isArray(item.tasks) ? item.tasks : []
    return sum + tasks.filter((task: any) => task.status !== 'done').length
  }, 0)
  const openReminders = projects.reduce((sum, item) => {
    const reminders = Array.isArray(item.reminders) ? item.reminders : []
    return sum + reminders.filter((reminder: any) => reminder.status !== 'closed').length
  }, 0)
  const pendingApprovals = projects.reduce((sum, item) => {
    const approvals = Array.isArray(item.approvals) ? item.approvals : []
    return sum + approvals.filter((approval: any) => approval.status === 'pending').length
  }, 0)
  const totalRenewals = projects.reduce((sum, item) => sum + (Array.isArray(item.renewals) ? item.renewals.length : 0), 0)

  return {
    totalProjects,
    activeProjects,
    expiringProjects,
    expiredProjects,
    todoTasks,
    openReminders,
    pendingApprovals,
    totalRenewals,
  }
}

export async function listBusinessHubProjects(query: BusinessHubProjectQuery) {
  const page = Math.max(Number(query.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)
  const filters = buildQuery(query)
  const [items, total] = await Promise.all([
    BusinessHubProjectModel.find(filters).sort({ updatedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean().exec(),
    BusinessHubProjectModel.countDocuments(filters).exec(),
  ])
  return {
    data: items.map((item) => ({
      id: String(item._id),
      projectNumber: String(item.projectNumber ?? ''),
      title: String(item.title ?? ''),
      customerName: String(item.customerName ?? ''),
      customerPhone: String(item.customerPhone ?? ''),
      sourceChannel: normalizeNullableString(item.sourceChannel),
      summary: normalizeNullableString(item.summary),
      stage: item.stage || 'lead',
      status: item.status || 'active',
      contractStatus: item.contractStatus === 'signed' ? 'signed' : 'unsigned',
      serviceStatus: item.serviceStatus || 'pending',
      serviceDurationDays: Math.max(Number(item.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1),
      servicePrice: Math.max(Number(item.servicePrice) || DEFAULT_SERVICE_PRICE, 0),
      serviceStartAt: toIso(item.serviceStartAt),
      serviceEndAt: toIso(item.serviceEndAt),
      renewalWarningDays: Math.max(Number(item.renewalWarningDays) || DEFAULT_WARNING_DAYS, 1),
      deliverySceneSpotTitle: normalizeNullableString(item.deliverySceneSpotTitle),
      taskCount: Array.isArray(item.tasks) ? item.tasks.length : 0,
      todoTaskCount: Array.isArray(item.tasks) ? item.tasks.filter((task: any) => task.status !== 'done').length : 0,
      openReminderCount: Array.isArray(item.reminders) ? item.reminders.filter((reminder: any) => reminder.status !== 'closed').length : 0,
      pendingApprovalCount: Array.isArray(item.approvals) ? item.approvals.filter((approval: any) => approval.status === 'pending').length : 0,
      renewalCount: Array.isArray(item.renewals) ? item.renewals.length : 0,
      updatedAt: toIso(item.updatedAt) ?? new Date().toISOString(),
      createdAt: toIso(item.createdAt) ?? new Date().toISOString(),
    })),
    total,
    page,
    pageSize,
  }
}

export async function getBusinessHubProject(id: string): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  return mapProject(project.toObject ? project.toObject() : project)
}

export async function createBusinessHubProject(input: BusinessHubProjectInput): Promise<BusinessHubProjectView> {
  const title = normalizeString(input.title)
  const customerName = normalizeString(input.customerName)
  const customerPhone = normalizeString(input.customerPhone)
  if (!title) throw new Error('项目名称不能为空')
  if (!customerName) throw new Error('客户名称不能为空')
  if (!customerPhone) throw new Error('客户电话不能为空')

  const now = new Date()
  const created = await BusinessHubProjectModel.create({
    projectNumber: generateProjectNumber(),
    title,
    customerName,
    customerPhone,
    sourceChannel: normalizeNullableString(input.sourceChannel),
    summary: normalizeNullableString(input.summary),
    notes: normalizeNullableString(input.notes),
    stage: 'quote',
    status: 'active',
    contractStatus: 'unsigned',
    serviceStatus: 'pending',
    serviceDurationDays: DEFAULT_SERVICE_DURATION_DAYS,
    servicePrice: DEFAULT_SERVICE_PRICE,
    serviceStartAt: null,
    serviceEndAt: null,
    renewalWarningDays: DEFAULT_WARNING_DAYS,
    tasks: buildDefaultTasks(),
    reminders: buildInitialReminders(),
    materials: [],
    approvals: buildInitialApprovals(),
    renewals: [],
    activityLogs: [],
    analyticsSnapshot: null,
  })
  pushActivity(created, 'project.created', `创建商业项目「${title}」`, 'system')
  await created.save()
  return mapProject(created.toObject())
}

export async function updateBusinessHubProject(id: string, input: BusinessHubProjectUpdateInput): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  if (input.title !== undefined) project.title = normalizeString(input.title) || project.title
  if (input.customerName !== undefined) project.customerName = normalizeString(input.customerName) || project.customerName
  if (input.customerPhone !== undefined) project.customerPhone = normalizeString(input.customerPhone) || project.customerPhone
  if (input.sourceChannel !== undefined) project.sourceChannel = normalizeNullableString(input.sourceChannel)
  if (input.summary !== undefined) project.summary = normalizeNullableString(input.summary)
  if (input.notes !== undefined) project.notes = normalizeNullableString(input.notes)
  if (input.serviceDurationDays !== undefined) project.serviceDurationDays = normalizePositiveNumber(input.serviceDurationDays, DEFAULT_SERVICE_DURATION_DAYS)
  if (input.servicePrice !== undefined) project.servicePrice = normalizeNonNegativeNumber(input.servicePrice, DEFAULT_SERVICE_PRICE)
  if (input.renewalWarningDays !== undefined) project.renewalWarningDays = normalizePositiveNumber(input.renewalWarningDays, DEFAULT_WARNING_DAYS)
  if (input.serviceStartAt !== undefined) project.serviceStartAt = normalizeDate(input.serviceStartAt)
  if (input.serviceEndAt !== undefined) project.serviceEndAt = normalizeDate(input.serviceEndAt)
  if (input.status !== undefined) {
    const status = normalizeString(input.status)
    if (status === 'active' || status === 'paused' || status === 'completed' || status === 'archived') {
      project.status = status
    }
  }
  ensureProjectDates(project)
  pushActivity(project, 'project.updated', `更新商业项目「${project.title}」`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function signBusinessHubProject(id: string): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  project.stage = 'signing'
  project.contractStatus = 'signed'
  const quoteApproval = Array.isArray(project.approvals)
    ? project.approvals.find((item: any) => item.kind === 'quote' && item.status === 'pending')
    : null
  if (quoteApproval) {
    quoteApproval.status = 'approved'
    quoteApproval.decidedAt = new Date()
  }
  pushActivity(project, 'project.signed', `项目「${project.title}」进入签约阶段`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function advanceBusinessHubProduction(id: string, remark?: string | null): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  if (project.stage !== 'production') {
    throw new Error('当前项目不在制作阶段')
  }
  const tasks = Array.isArray(project.tasks) ? [...project.tasks] : []
  const activeIndex = tasks.findIndex((task: any) => task.status === 'doing')
  if (activeIndex === -1) {
    throw new Error('当前没有可推进的任务')
  }
  const now = new Date()
  tasks[activeIndex] = {
    ...tasks[activeIndex],
    status: 'done',
    completedAt: tasks[activeIndex].completedAt ?? now,
    remark: normalizeNullableString(remark) ?? tasks[activeIndex].remark ?? null,
    updatedAt: now,
  }
  const nextIndex = tasks.findIndex((task: any, index: number) => index > activeIndex && task.status === 'todo')
  if (nextIndex >= 0) {
    tasks[nextIndex] = { ...tasks[nextIndex], status: 'doing', updatedAt: now }
  }
  project.tasks = tasks as any
  pushActivity(project, 'project.production.advance', `推进项目「${project.title}」制作任务`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function completeBusinessHubProduction(id: string): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  if (project.stage !== 'production') {
    throw new Error('当前项目不在制作阶段')
  }
  const now = new Date()
  project.tasks = (Array.isArray(project.tasks) ? project.tasks : []).map((task: any) => ({
    ...task,
    status: 'done',
    completedAt: task.completedAt ?? now,
    updatedAt: now,
  })) as any
  project.stage = 'publish'
  pushActivity(project, 'project.production.completed', `项目「${project.title}」完成制作，进入发布阶段`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function completeBusinessHubPublish(id: string): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  if (project.stage !== 'publish') {
    throw new Error('当前项目不在发布阶段')
  }
  project.stage = 'operation'
  project.serviceStartAt = project.serviceStartAt ?? new Date()
  project.serviceEndAt = project.serviceEndAt ?? addDays(project.serviceStartAt, Math.max(Number(project.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1))
  refreshServiceStatus(project)
  const deliveryApproval = Array.isArray(project.approvals)
    ? project.approvals.find((item: any) => item.kind === 'delivery' && item.status === 'pending')
    : null
  if (deliveryApproval) {
    deliveryApproval.status = 'approved'
    deliveryApproval.decidedAt = new Date()
  }
  pushActivity(project, 'project.publish.completed', `项目「${project.title}」发布完成，进入运营阶段`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function completeBusinessHubOperation(id: string): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  if (project.stage !== 'operation') {
    throw new Error('当前项目不在运营阶段')
  }
  refreshServiceStatus(project)
  pushActivity(project, 'project.operation.confirmed', `项目「${project.title}」运营状态已确认`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function bindBusinessHubDelivery(id: string, sceneSpotId: string): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  if (!Types.ObjectId.isValid(sceneSpotId)) {
    throw new Error('Invalid scene spot id')
  }
  const spot = await SceneSpotModel.findById(sceneSpotId).lean().exec()
  if (!spot) {
    throw new Error('Scene spot not found')
  }
  project.deliverySceneSpotId = new Types.ObjectId(sceneSpotId)
  project.deliverySceneId = new Types.ObjectId(String(spot.sceneId))
  project.deliverySceneSpotTitle = String(spot.title ?? '')
  project.deliveryBoundAt = new Date()
  const deliveryApproval = Array.isArray(project.approvals)
    ? project.approvals.find((item: any) => item.kind === 'delivery' && item.status === 'pending')
    : null
  if (deliveryApproval) {
    deliveryApproval.title = `交付绑定：${project.deliverySceneSpotTitle}`
    deliveryApproval.decidedAt = null
  } else {
    project.approvals = [
      ...(Array.isArray(project.approvals) ? project.approvals : []),
      {
        _id: objectId(),
        kind: 'delivery',
        title: `交付绑定：${project.deliverySceneSpotTitle}`,
        status: 'pending',
        remark: null,
        decidedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any
  }
  pushActivity(project, 'project.delivery.bound', `绑定交付场景「${project.deliverySceneSpotTitle}」`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function createBusinessHubTask(id: string, input: BusinessHubTaskInput): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  const title = normalizeString(input.title)
  if (!title) {
    throw new Error('任务名称不能为空')
  }
  const now = new Date()
  const task = {
    _id: objectId(),
    title,
    status: input.status || 'todo',
    priority: input.priority || 'medium',
    assignee: normalizeNullableString(input.assignee),
    dueAt: normalizeDate(input.dueAt),
    remark: normalizeNullableString(input.remark),
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  project.tasks = [...(Array.isArray(project.tasks) ? project.tasks : []), task] as any
  pushActivity(project, 'task.created', `新增任务：${title}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function updateBusinessHubTask(taskId: string, input: Partial<BusinessHubTaskInput & { status: BusinessHubTaskStatus }>): Promise<BusinessHubProjectView> {
  const project = await BusinessHubProjectModel.findOne({ 'tasks._id': taskId }).exec()
  if (!project) {
    throw new Error('Business project not found')
  }
  const task = (project.tasks as any[]).find((item) => String(item._id) === taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  if (input.title !== undefined) task.title = normalizeString(input.title) || task.title
  if (input.priority !== undefined) task.priority = input.priority
  if (input.assignee !== undefined) task.assignee = normalizeNullableString(input.assignee)
  if (input.dueAt !== undefined) task.dueAt = normalizeDate(input.dueAt)
  if (input.remark !== undefined) task.remark = normalizeNullableString(input.remark)
  if (input.status !== undefined) {
    task.status = input.status
    task.completedAt = input.status === 'done' ? (task.completedAt || new Date()) : null
  }
  task.updatedAt = new Date()
  pushActivity(project, 'task.updated', `更新任务：${task.title}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function updateBusinessHubTaskForPhone(
  taskId: string,
  phone: string | null | undefined,
  input: Partial<BusinessHubTaskInput & { status: BusinessHubTaskStatus }>,
): Promise<BusinessHubProjectView> {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    throw new Error('请先绑定手机号后再操作任务')
  }
  const project = await BusinessHubProjectModel.findOne({ 'tasks._id': taskId, customerPhone: normalizedPhone }).exec()
  if (!project) {
    const accessible = await BusinessHubProjectModel.findOne({ 'tasks._id': taskId }).lean().exec()
    if (accessible) {
      throw new Error('无权访问该商业项目')
    }
    throw new Error('Task not found')
  }
  const task = (project.tasks as any[]).find((item) => String(item._id) === taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  if (input.title !== undefined) task.title = normalizeString(input.title) || task.title
  if (input.priority !== undefined) task.priority = input.priority
  if (input.assignee !== undefined) task.assignee = normalizeNullableString(input.assignee)
  if (input.dueAt !== undefined) task.dueAt = normalizeDate(input.dueAt)
  if (input.remark !== undefined) task.remark = normalizeNullableString(input.remark)
  if (input.status !== undefined) {
    task.status = input.status
    task.completedAt = input.status === 'done' ? (task.completedAt || new Date()) : null
  }
  task.updatedAt = new Date()
  pushActivity(project, 'task.updated', `更新任务：${task.title}`, 'system')
  await project.save()
  return mapProject(project.toObject())
}

export async function closeBusinessHubTask(taskId: string): Promise<BusinessHubProjectView> {
  return updateBusinessHubTask(taskId, { status: 'done' })
}

export async function blockBusinessHubTask(taskId: string, remark?: string | null): Promise<BusinessHubProjectView> {
  return updateBusinessHubTask(taskId, { status: 'blocked', remark: remark ?? '任务阻塞' })
}

export async function createBusinessHubReminder(id: string, input: BusinessHubReminderInput): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  const title = normalizeString(input.title)
  if (!title) {
    throw new Error('提醒标题不能为空')
  }
  const now = new Date()
  project.reminders = [
    ...(Array.isArray(project.reminders) ? project.reminders : []),
    {
      _id: objectId(),
      kind: input.kind || 'custom',
      title,
      message: normalizeNullableString(input.message),
      status: 'open',
      dueAt: normalizeDate(input.dueAt),
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ] as any
  pushActivity(project, 'reminder.created', `新增提醒：${title}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function closeBusinessHubReminder(reminderId: string): Promise<BusinessHubProjectView> {
  const project = await BusinessHubProjectModel.findOne({ 'reminders._id': reminderId }).exec()
  if (!project) {
    throw new Error('Business project not found')
  }
  const reminder = (project.reminders as any[]).find((item) => String(item._id) === reminderId)
  if (!reminder) {
    throw new Error('Reminder not found')
  }
  reminder.status = 'closed'
  reminder.closedAt = new Date()
  reminder.updatedAt = new Date()
  pushActivity(project, 'reminder.closed', `关闭提醒：${reminder.title}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function closeBusinessHubReminderForPhone(reminderId: string, phone: string | null | undefined): Promise<BusinessHubProjectView> {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    throw new Error('请先绑定手机号后再操作提醒')
  }
  const project = await BusinessHubProjectModel.findOne({ 'reminders._id': reminderId, customerPhone: normalizedPhone }).exec()
  if (!project) {
    const accessible = await BusinessHubProjectModel.findOne({ 'reminders._id': reminderId }).lean().exec()
    if (accessible) {
      throw new Error('无权访问该商业项目')
    }
    throw new Error('Reminder not found')
  }
  const reminder = (project.reminders as any[]).find((item) => String(item._id) === reminderId)
  if (!reminder) {
    throw new Error('Reminder not found')
  }
  reminder.status = 'closed'
  reminder.closedAt = new Date()
  reminder.updatedAt = new Date()
  pushActivity(project, 'reminder.closed', `关闭提醒：${reminder.title}`, 'system')
  await project.save()
  return mapProject(project.toObject())
}

export async function createBusinessHubMaterial(id: string, input: BusinessHubMaterialInput): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  const title = normalizeString(input.title)
  if (!title) {
    throw new Error('素材标题不能为空')
  }
  const now = new Date()
  project.materials = [
    ...(Array.isArray(project.materials) ? project.materials : []),
    {
      _id: objectId(),
      kind: input.kind || 'copy',
      title,
      content: normalizeNullableString(input.content),
      url: normalizeNullableString(input.url),
      fileUrl: normalizeNullableString(input.fileUrl),
      createdAt: now,
      updatedAt: now,
    },
  ] as any
  pushActivity(project, 'material.created', `新增素材：${title}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function deleteBusinessHubMaterial(materialId: string): Promise<BusinessHubProjectView> {
  const project = await BusinessHubProjectModel.findOne({ 'materials._id': materialId }).exec()
  if (!project) {
    throw new Error('Business project not found')
  }
  const materials = Array.isArray(project.materials) ? project.materials.filter((item: any) => String(item._id) !== materialId) : []
  project.materials = materials as any
  pushActivity(project, 'material.deleted', '删除素材', 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function createBusinessHubApproval(id: string, input: BusinessHubApprovalInput): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  const title = normalizeString(input.title)
  if (!title) {
    throw new Error('审批标题不能为空')
  }
  const now = new Date()
  project.approvals = [
    ...(Array.isArray(project.approvals) ? project.approvals : []),
    {
      _id: objectId(),
      kind: input.kind || 'custom',
      title,
      status: 'pending',
      remark: normalizeNullableString(input.remark),
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ] as any
  pushActivity(project, 'approval.created', `新增审批：${title}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function decideBusinessHubApproval(approvalId: string, status: BusinessHubApprovalStatus, remark?: string | null): Promise<BusinessHubProjectView> {
  const project = await BusinessHubProjectModel.findOne({ 'approvals._id': approvalId }).exec()
  if (!project) {
    throw new Error('Business project not found')
  }
  const approval = (project.approvals as any[]).find((item) => String(item._id) === approvalId)
  if (!approval) {
    throw new Error('Approval not found')
  }
  approval.status = status
  approval.remark = normalizeNullableString(remark) ?? approval.remark ?? null
  approval.decidedAt = new Date()
  approval.updatedAt = new Date()
  if (approval.kind === 'signing' && status === 'approved') {
    project.contractStatus = 'signed'
    project.stage = project.stage === 'lead' ? 'signing' : project.stage
  }
  if (approval.kind === 'renewal' && status === 'approved') {
    const renewal = (Array.isArray(project.renewals) ? project.renewals : []).find((item: any) => item.status === 'pending')
    if (renewal) {
      renewal.status = 'approved'
      renewal.paymentStatus = 'succeeded'
      renewal.approvedAt = new Date()
    }
  }
  pushActivity(project, 'approval.decided', `${status === 'approved' ? '通过' : '驳回'}审批：${approval.title}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function decideBusinessHubApprovalForPhone(
  approvalId: string,
  phone: string | null | undefined,
  status: BusinessHubApprovalStatus,
  remark?: string | null,
): Promise<BusinessHubProjectView> {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    throw new Error('请先绑定手机号后再处理审批')
  }
  const project = await BusinessHubProjectModel.findOne({ 'approvals._id': approvalId, customerPhone: normalizedPhone }).exec()
  if (!project) {
    const accessible = await BusinessHubProjectModel.findOne({ 'approvals._id': approvalId }).lean().exec()
    if (accessible) {
      throw new Error('无权访问该商业项目')
    }
    throw new Error('Approval not found')
  }
  const approval = (project.approvals as any[]).find((item) => String(item._id) === approvalId)
  if (!approval) {
    throw new Error('Approval not found')
  }
  approval.status = status
  approval.remark = normalizeNullableString(remark) ?? approval.remark ?? null
  approval.decidedAt = new Date()
  approval.updatedAt = new Date()
  if (approval.kind === 'signing' && status === 'approved') {
    project.contractStatus = 'signed'
    project.stage = project.stage === 'lead' ? 'signing' : project.stage
  }
  if (approval.kind === 'renewal' && status === 'approved') {
    const renewal = (Array.isArray(project.renewals) ? project.renewals : []).find((item: any) => item.status === 'pending')
    if (renewal) {
      renewal.status = 'approved'
      renewal.paymentStatus = 'succeeded'
      renewal.approvedAt = new Date()
    }
  }
  pushActivity(project, 'approval.decided', `${status === 'approved' ? '通过' : '驳回'}审批：${approval.title}`, 'system')
  await project.save()
  return mapProject(project.toObject())
}

export async function createBusinessHubRenewal(id: string, input: BusinessHubRenewalInput): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  const durationDays = normalizePositiveNumber(input.durationDays, Math.max(Number(project.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1))
  const price = normalizeNonNegativeNumber(input.price, Math.max(Number(project.servicePrice) || DEFAULT_SERVICE_PRICE, 0))
  const currentEndAt = project.serviceEndAt ? new Date(project.serviceEndAt) : null
  const now = new Date()
  const nextStartAt = currentEndAt && currentEndAt.getTime() > now.getTime() ? currentEndAt : now
  const nextEndAt = addDays(nextStartAt, durationDays)
  const renewal = {
    _id: objectId(),
    renewalNumber: generateRenewalNumber(),
    status: 'pending' as const,
    paymentStatus: 'unpaid' as const,
    durationDays,
    price,
    serviceStartAt: nextStartAt,
    serviceEndAt: nextEndAt,
    requestedAt: now,
    approvedAt: null,
    remark: normalizeNullableString(input.remark),
    createdAt: now,
    updatedAt: now,
  }
  project.renewals = [...(Array.isArray(project.renewals) ? project.renewals : []), renewal] as any
  project.approvals = [
    ...(Array.isArray(project.approvals) ? project.approvals : []),
    {
      _id: objectId(),
      kind: 'renewal',
      title: `续费审批：${renewal.renewalNumber}`,
      status: 'pending',
      remark: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ] as any
  pushActivity(project, 'renewal.created', `创建续费单：${renewal.renewalNumber}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function approveBusinessHubRenewal(renewalId: string): Promise<BusinessHubProjectView> {
  const project = await BusinessHubProjectModel.findOne({ 'renewals._id': renewalId }).exec()
  if (!project) {
    throw new Error('Business project not found')
  }
  const renewal = (project.renewals as any[]).find((item) => String(item._id) === renewalId)
  if (!renewal) {
    throw new Error('Renewal not found')
  }
  renewal.status = 'approved'
  renewal.paymentStatus = 'succeeded'
  renewal.approvedAt = new Date()
  renewal.updatedAt = new Date()
  project.serviceStartAt = renewal.serviceStartAt ?? project.serviceStartAt
  project.serviceEndAt = renewal.serviceEndAt ?? project.serviceEndAt
  project.serviceDurationDays = renewal.durationDays ?? project.serviceDurationDays
  project.servicePrice = renewal.price ?? project.servicePrice
  refreshServiceStatus(project)
  const approval = Array.isArray(project.approvals)
    ? project.approvals.find((item: any) => item.kind === 'renewal' && item.status === 'pending')
    : null
  if (approval) {
    approval.status = 'approved'
    approval.decidedAt = new Date()
  }
  pushActivity(project, 'renewal.approved', `审批续费：${renewal.renewalNumber}`, 'admin')
  await project.save()
  return mapProject(project.toObject())
}

export async function createBusinessHubRenewalPaymentForPhone(
  id: string,
  phone: string | null | undefined,
  openId: string,
  miniAppId: string | undefined,
  input: BusinessHubRenewalInput = {},
): Promise<BusinessHubRenewalPaymentResult> {
  const project = await loadProject(id)
  ensureProjectOwnedByPhone(project, phone)
  const updated = await createBusinessHubRenewal(id, input)
  const renewal = updated.renewals[updated.renewals.length - 1]
  if (!renewal) {
    throw new Error('创建续费单失败')
  }

  const paymentResult = await createOrderPayment({
    channel: 'wechat',
    miniAppId,
    orderNumber: renewal.renewalNumber,
    description: `${updated.title} 续费`,
    amount: renewal.price,
    openId,
    attach: JSON.stringify({
      businessHubProjectId: updated.id,
      renewalId: renewal.id,
      phone: normalizePhone(phone),
      type: 'business-hub-renewal',
    }),
  })

  return {
    renewal,
    orderNumber: renewal.renewalNumber,
    paymentStatus: paymentResult.status === 'pending' ? 'processing' : 'failed',
    payParams: paymentResult.payParams ?? null,
  }
}

export async function applyBusinessHubRenewalPaymentSuccess(params: {
  renewalOrderNumber: string
  transactionId?: string
  notifyId?: string
  transaction: Record<string, unknown>
  origin?: string
}): Promise<BusinessHubProjectView | null> {
  const project = await BusinessHubProjectModel.findOne({ 'renewals.renewalNumber': params.renewalOrderNumber }).exec()
  if (!project) {
    return null
  }

  const renewal = (project.renewals as any[]).find((item) => String(item.renewalNumber) === params.renewalOrderNumber)
  if (!renewal) {
    return null
  }

  const now = new Date()
  if (renewal.status === 'approved' && renewal.paymentStatus === 'succeeded') {
    return mapProject(project.toObject())
  }

  renewal.status = 'approved'
  renewal.paymentStatus = 'succeeded'
  renewal.approvedAt = now
  renewal.updatedAt = now
  project.serviceStartAt = renewal.serviceStartAt ?? project.serviceStartAt
  project.serviceEndAt = renewal.serviceEndAt ?? project.serviceEndAt
  project.serviceDurationDays = renewal.durationDays ?? project.serviceDurationDays
  project.servicePrice = renewal.price ?? project.servicePrice
  refreshServiceStatus(project)
  const approval = Array.isArray(project.approvals)
    ? project.approvals.find((item: any) => item.kind === 'renewal' && item.status === 'pending')
    : null
  if (approval) {
    approval.status = 'approved'
    approval.decidedAt = now
    approval.updatedAt = now
  }
  pushActivity(project, 'renewal.paid', `续费支付成功：${renewal.renewalNumber}`, 'system')
  await project.save()
  return mapProject(project.toObject())
}

export async function applyBusinessHubRenewalPaymentFailure(params: {
  renewalOrderNumber: string
  notifyId?: string
  transaction: Record<string, unknown>
}): Promise<BusinessHubProjectView | null> {
  const project = await BusinessHubProjectModel.findOne({ 'renewals.renewalNumber': params.renewalOrderNumber }).exec()
  if (!project) {
    return null
  }
  const renewal = (project.renewals as any[]).find((item) => String(item.renewalNumber) === params.renewalOrderNumber)
  if (!renewal) {
    return null
  }
  if (renewal.paymentStatus !== 'succeeded') {
    renewal.paymentStatus = 'failed'
    renewal.updatedAt = new Date()
    pushActivity(project, 'renewal.payment_failed', `续费支付失败：${renewal.renewalNumber}`, 'system')
    await project.save()
  }
  return mapProject(project.toObject())
}

export async function summarizeBusinessHubProject(id: string): Promise<BusinessHubProjectListItem> {
  const project = await loadProject(id)
  return mapProjectListItem(project.toObject())
}

function normalizePhone(value: unknown): string {
  return normalizeString(value)
}

function ensureProjectOwnedByPhone(project: any, phone?: string | null): void {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    throw new Error('请先绑定手机号后再查看商务项目')
  }
  if (normalizePhone(project.customerPhone) !== normalizedPhone) {
    throw new Error('无权访问该商业项目')
  }
}

function buildDashboardFromProjects(projects: BusinessHubProjectListItem[]): BusinessHubDashboardView {
  const totalProjects = projects.length
  const activeProjects = projects.filter((item) => item.status === 'active').length
  const expiringProjects = projects.filter((item) => item.serviceStatus === 'expiring').length
  const expiredProjects = projects.filter((item) => item.serviceStatus === 'expired').length
  const todoTasks = projects.reduce((sum, item) => sum + item.todoTaskCount, 0)
  const openReminders = projects.reduce((sum, item) => sum + item.openReminderCount, 0)
  const pendingApprovals = projects.reduce((sum, item) => sum + item.pendingApprovalCount, 0)
  const totalRenewals = projects.reduce((sum, item) => sum + item.renewalCount, 0)

  return {
    totalProjects,
    activeProjects,
    expiringProjects,
    expiredProjects,
    todoTasks,
    openReminders,
    pendingApprovals,
    totalRenewals,
  }
}

export interface BusinessHubMiniBootstrapView {
  hasBoundPhone: boolean
  customerPhone: string | null
  dashboard: BusinessHubDashboardView
  latestProject: BusinessHubProjectListItem | null
  projects: BusinessHubProjectListItem[]
}

export interface BusinessHubRenewalPreviewView {
  amount: number
  currentServiceEndAt: string | null
  durationDays: number
  nextServiceEndAt: string
  nextServiceStartAt: string
}

export async function listBusinessHubProjectsForPhone(phone?: string | null): Promise<BusinessHubProjectListItem[]> {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    return []
  }

  const projects = await BusinessHubProjectModel.find({ customerPhone: normalizedPhone })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean()
    .exec()

  return projects.map(mapProjectListItem)
}

export async function getBusinessHubProjectForPhone(id: string, phone?: string | null): Promise<BusinessHubProjectView> {
  const project = await loadProject(id)
  ensureProjectOwnedByPhone(project, phone)
  return mapProject(project.toObject())
}

export async function getBusinessHubBootstrapForPhone(phone?: string | null): Promise<BusinessHubMiniBootstrapView> {
  const projects = await listBusinessHubProjectsForPhone(phone)
  return {
    hasBoundPhone: Boolean(normalizePhone(phone)),
    customerPhone: normalizePhone(phone) || null,
    dashboard: buildDashboardFromProjects(projects),
    latestProject: projects[0] ?? null,
    projects,
  }
}

export async function getBusinessHubRenewalPreviewForPhone(id: string, phone?: string | null): Promise<BusinessHubRenewalPreviewView> {
  const project = await loadProject(id)
  ensureProjectOwnedByPhone(project, phone)
  const currentServiceEndAt = project.serviceEndAt ? new Date(project.serviceEndAt) : null
  const durationDays = Math.max(Number(project.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1)
  const amount = Math.max(Number(project.servicePrice) || DEFAULT_SERVICE_PRICE, 0)
  const now = new Date()
  const nextServiceStartAt = currentServiceEndAt && currentServiceEndAt.getTime() > now.getTime() ? currentServiceEndAt : now
  const nextServiceEndAt = addDays(nextServiceStartAt, durationDays)

  return {
    amount,
    currentServiceEndAt: toIso(currentServiceEndAt),
    durationDays,
    nextServiceStartAt: nextServiceStartAt.toISOString(),
    nextServiceEndAt: nextServiceEndAt.toISOString(),
  }
}

export async function createBusinessHubRenewalForPhone(id: string, phone?: string | null, input: BusinessHubRenewalInput = {}): Promise<BusinessHubRenewalView> {
  const project = await loadProject(id)
  ensureProjectOwnedByPhone(project, phone)
  const updated = await createBusinessHubRenewal(id, input)
  const renewal = updated.renewals[updated.renewals.length - 1]
  if (!renewal) {
    throw new Error('创建续费单失败')
  }
  return renewal
}
