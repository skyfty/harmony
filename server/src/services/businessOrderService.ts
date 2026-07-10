import { Types } from 'mongoose'
import { BusinessOrderModel } from '@/models/BusinessOrder'
import { SceneSpotModel } from '@/models/SceneSpot'
import { AppUserModel } from '@/models/AppUser'
import { getBusinessOrderAnalytics } from '@/services/businessOrderAnalyticsService'
import { getBusinessContactPhone } from '@/services/businessConfigService'
import { buildBusinessOrderShareLinks } from '@/services/businessOrderShareService'
import { getBusinessServiceSnapshot } from '@/services/businessOrderStatusService'
import { createOrderPayment } from '@/services/paymentService'
import { listSceneSpotCategories } from '@/services/sceneSpotCategoryService'
import type {
  BusinessOrderDocument,
  BusinessOrderKind,
  BusinessOrderProductionNode,
  BusinessOrderServiceStatus,
  BusinessOrderTopStage,
} from '@/types/models'

const DEFAULT_SERVICE_DURATION_DAYS = 365
const DEFAULT_SERVICE_PRICE = 0
const DEFAULT_WARNING_DAYS = 15
const DEFAULT_PUBLIC_ORIGIN = 'https://v.touchmagic.cn'

export interface BusinessLandscapeOption {
  code: string
  label: string
}

export interface BusinessOrderCategoryOption {
  id: string
  name: string
}

export interface BusinessOrderRenewalHistoryItem {
  id: string
  orderNumber: string
  orderKind: BusinessOrderKind
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
  serviceStartAt: string | null
  serviceEndAt: string | null
  serviceStatus: BusinessOrderServiceStatus
  durationDays: number
  price: number
  createdAt: string
  approvedAt: string | null
}

export interface BusinessOrderRenewalPaymentResult {
  renewal: BusinessOrderRenewalHistoryItem
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

export interface BusinessOrderView {
  id: string
  orderNumber: string
  userId: string
  rootOrderId: string
  parentOrderId: string | null
  orderKind: BusinessOrderKind
  userInfo: {
    id: string
    displayName: string | null
    username: string | null
    phone: string | null
    contractStatus: 'unsigned' | 'signed'
  } | null
  scenicName: string
  addressText: string
  location: { lat: number; lng: number } | null
  contactPhone: string
  scenicArea: number | null
  sceneSpotCategoryId: string | null
  sceneSpotCategoryName: string | null
  specialLandscapeTags: string[]
  topStage: BusinessOrderTopStage
  productionProgress: Array<{
    code: string
    label: string
    status: 'pending' | 'active' | 'completed'
    activatedAt: string | null
    remark: string | null
    sortOrder: number
  }>
  delivery: {
    boundAt: string | null
    sceneId: string | null
    sceneSpotId: string | null
    sceneSpotTitle: string | null
  }
  service: {
    daysRemaining: number | null
    durationDays: number
    endAt: string | null
    price: number
    startAt: string | null
    status: BusinessOrderServiceStatus
    warningDays: number
  }
  contactPhoneForBusiness: string | null
  notes: string | null
  quotedAt: string | null
  signedAt: string | null
  productionStartedAt: string | null
  productionCompletedAt: string | null
  publishReadyAt: string | null
  publishedAt: string | null
  operatingAt: string | null
  renewalCount: number
  lastRenewedAt: string | null
  share: {
    miniProgramPath: string | null
    urlScheme: string | null
    wechatRuleLink: string | null
  }
  analyticsAvailable: boolean
  renewalHistory: BusinessOrderRenewalHistoryItem[]
  createdAt: string
  updatedAt: string
}

export interface BusinessOrderBootstrapData {
  contractStatus: 'unsigned' | 'signed'
  latestOrder: BusinessOrderView | null
  scenicTypes: BusinessOrderCategoryOption[]
  specialLandscapeOptions: BusinessLandscapeOption[]
  businessContactPhone: string
}

export interface CreateBusinessOrderInput {
  userId: string
  scenicName: string
  addressText: string
  location?: { lat?: number; lng?: number } | null
  contactPhone: string
  scenicArea?: number | null
  sceneSpotCategoryId?: string | null
  specialLandscapeTags?: string[]
}

export interface BusinessOrderRenewalPreview {
  currentServiceEndAt: string | null
  nextServiceStartAt: string
  nextServiceEndAt: string
  durationDays: number
  amount: number
}

export const BUSINESS_SPECIAL_LANDSCAPE_OPTIONS: BusinessLandscapeOption[] = [
  { code: 'light-show', label: '灯光秀' },
  { code: 'water-fountain', label: '水景喷泉' },
  { code: 'glass-skywalk', label: '玻璃栈道' },
  { code: 'night-performance', label: '夜游演艺' },
  { code: 'naked-eye-3d', label: '裸眼3D大屏' },
  { code: 'mountain-projection', label: '山体投影' },
  { code: 'interactive-device', label: '互动装置' },
  { code: 'ropeway-elevator', label: '索道/观光电梯' },
]

const PRODUCTION_TEMPLATE: Array<Pick<BusinessOrderProductionNode, 'code' | 'label' | 'sortOrder'>> = [
  { code: 'requirement-confirmation', label: '需求确认', sortOrder: 1 },
  { code: 'material-collection', label: '资料收集', sortOrder: 2 },
  { code: 'scene-production', label: '场景制作', sortOrder: 3 },
  { code: 'effect-review', label: '效果验收', sortOrder: 4 },
  { code: 'delivery-preparation', label: '交付准备', sortOrder: 5 },
]

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableString(value: unknown): string | null {
  const text = normalizeString(value)
  return text || null
}

function normalizeArea(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('景点面积格式无效')
  }
  return parsed
}

function normalizePositiveNumber(value: unknown, fallback: number, fieldLabel: string): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldLabel}无效`)
  }
  return Math.floor(parsed)
}

function normalizeNonNegativeNumber(value: unknown, fallback: number, fieldLabel: string): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel}无效`)
  }
  return parsed
}

function normalizeLocation(value: CreateBusinessOrderInput['location']): { lat: number; lng: number } | null {
  if (!value) {
    return null
  }
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }
  return { lat, lng }
}

function buildProductionTemplate(): BusinessOrderProductionNode[] {
  return PRODUCTION_TEMPLATE.map((item) => ({
    ...item,
    status: 'pending',
    activatedAt: null,
    remark: null,
  }))
}

function toIso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function ensureObjectId(value: string | null | undefined, message: string): Types.ObjectId | null {
  if (!value) {
    return null
  }
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(message)
  }
  return new Types.ObjectId(value)
}

function ensureLandscapeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return []
  }
  const validCodes = new Set(BUSINESS_SPECIAL_LANDSCAPE_OPTIONS.map((item) => item.code))
  return Array.from(new Set(tags.map((item) => normalizeString(item)).filter((item) => validCodes.has(item))))
}

function generateBusinessOrderNumber(prefix = 'BO'): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const random = Math.floor(Math.random() * 9000 + 1000)
  return `${prefix}${stamp}${random}`
}

function buildScenePackageDownloadUrl(origin: string | undefined, sceneId: string): string {
  return new URL(`/api/mini/scenes/${encodeURIComponent(sceneId)}/package`, origin || DEFAULT_PUBLIC_ORIGIN).toString()
}

function parseDateValue(value: unknown, fieldLabel: string): Date | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldLabel}无效`)
  }
  return date
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function computeRenewalWindow(order: {
  serviceDurationDays?: number | null
  serviceEndAt?: Date | null
  servicePrice?: number | null
}, now = new Date()): { currentServiceEndAt: Date | null; durationDays: number; amount: number; nextServiceEndAt: Date; nextServiceStartAt: Date } {
  const durationDays = Math.max(Number(order.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1)
  const amount = Math.max(Number(order.servicePrice) || DEFAULT_SERVICE_PRICE, 0)
  const currentServiceEndAt = order.serviceEndAt ? new Date(order.serviceEndAt) : null
  const nextServiceStartAt = currentServiceEndAt && currentServiceEndAt.getTime() > now.getTime() ? currentServiceEndAt : now
  const nextServiceEndAt = addDays(nextServiceStartAt, durationDays)
  return {
    currentServiceEndAt,
    nextServiceStartAt,
    nextServiceEndAt,
    durationDays,
    amount,
  }
}

function normalizeBusinessPaymentStatus(value: unknown): 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed' {
  if (
    value === 'unpaid' ||
    value === 'processing' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'refunded' ||
    value === 'closed'
  ) {
    return value
  }
  return 'unpaid'
}

function buildRenewalHistoryItem(item: any): BusinessOrderRenewalHistoryItem {
  return {
    id: String(item._id),
    orderNumber: String(item.orderNumber),
    orderKind: item.orderKind === 'renewal' ? 'renewal' : 'new',
    paymentStatus: normalizeBusinessPaymentStatus(item.paymentStatus),
    serviceStartAt: toIso(item.serviceStartAt),
    serviceEndAt: toIso(item.serviceEndAt),
    serviceStatus: getBusinessServiceSnapshot({
      serviceStartAt: item.serviceStartAt ? new Date(item.serviceStartAt) : null,
      serviceEndAt: item.serviceEndAt ? new Date(item.serviceEndAt) : null,
      renewalWarningDays: item.renewalWarningDays ?? DEFAULT_WARNING_DAYS,
      topStage: item.topStage ?? 'operation',
    }).status,
    durationDays: Math.max(Number(item.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1),
    price: Math.max(Number(item.servicePrice) || DEFAULT_SERVICE_PRICE, 0),
    createdAt: toIso(item.createdAt) ?? new Date().toISOString(),
    approvedAt: toIso(item.renewalApprovedAt),
  }
}

async function getCategoryNameMap(): Promise<Map<string, string>> {
  const categories = await listSceneSpotCategories()
  return new Map(categories.filter((item) => item.enabled).map((item) => [item.id, item.name]))
}

async function buildUserMap(userIds: string[]): Promise<Map<string, any>> {
  if (!userIds.length) {
    return new Map()
  }
  const users = await AppUserModel.find(
    { _id: { $in: userIds } },
    { _id: 1, username: 1, displayName: 1, phone: 1, contractStatus: 1 },
  )
    .lean()
    .exec()
  return new Map(users.map((user: any) => [String(user._id), user]))
}

async function loadRenewalRows(rootOrderId: string): Promise<any[]> {
  return BusinessOrderModel.find({ rootOrderId, parentOrderId: { $ne: null }, orderKind: 'renewal' })
    .sort({ createdAt: -1 })
    .lean()
    .exec()
}

async function mapBusinessOrder(order: any, dependencies?: {
  categoryNameMap?: Map<string, string>
  includeRenewals?: boolean
  origin?: string
  renewalRows?: any[]
  userMap?: Map<string, any>
}): Promise<BusinessOrderView> {
  const categoryNameMap = dependencies?.categoryNameMap ?? await getCategoryNameMap()
  const userMap = dependencies?.userMap ?? await buildUserMap([String(order.userId)])
  const renewalRows = dependencies?.renewalRows ?? (dependencies?.includeRenewals ? await loadRenewalRows(String(order._id)) : [])
  const user = userMap.get(String(order.userId)) ?? null
  const categoryId = order.sceneSpotCategoryId ? String(order.sceneSpotCategoryId) : null
  const serviceStartAt = order.serviceStartAt ? new Date(order.serviceStartAt) : null
  const serviceEndAt = order.serviceEndAt ? new Date(order.serviceEndAt) : null
  const warningDays = Math.max(Number(order.renewalWarningDays) || DEFAULT_WARNING_DAYS, 1)
  const serviceSnapshot = getBusinessServiceSnapshot({
    serviceStartAt,
    serviceEndAt,
    topStage: order.topStage,
    renewalWarningDays: warningDays,
  })
  const sceneId = order.deliverySceneId ? String(order.deliverySceneId) : null
  const sceneSpotId = order.deliverySceneSpotId ? String(order.deliverySceneSpotId) : null
  const sceneSpotTitle = normalizeNullableString(order.deliverySceneSpotTitle)
  const share = sceneId && sceneSpotId && sceneSpotTitle
    ? buildBusinessOrderShareLinks({
      sceneId,
      sceneSpotId,
      sceneSpotTitle,
      packageUrl: buildScenePackageDownloadUrl(dependencies?.origin, sceneId),
    })
    : null

  return {
    id: String(order._id),
    orderNumber: String(order.orderNumber),
    userId: String(order.userId),
    rootOrderId: String(order.rootOrderId ?? order._id),
    parentOrderId: order.parentOrderId ? String(order.parentOrderId) : null,
    orderKind: order.orderKind === 'renewal' ? 'renewal' : 'new',
    userInfo: user
      ? {
        id: String(user._id),
        displayName: user.displayName ?? null,
        username: user.username ?? null,
        phone: user.phone ?? null,
        contractStatus: user.contractStatus === 'signed' ? 'signed' : 'unsigned',
      }
      : null,
    scenicName: String(order.scenicName ?? ''),
    addressText: String(order.addressText ?? ''),
    location:
      order.location && Number.isFinite(Number(order.location.lat)) && Number.isFinite(Number(order.location.lng))
        ? { lat: Number(order.location.lat), lng: Number(order.location.lng) }
        : null,
    contactPhone: String(order.contactPhone ?? ''),
    scenicArea: Number.isFinite(Number(order.scenicArea)) ? Number(order.scenicArea) : null,
    sceneSpotCategoryId: categoryId,
    sceneSpotCategoryName: categoryId ? categoryNameMap.get(categoryId) ?? null : null,
    specialLandscapeTags: Array.isArray(order.specialLandscapeTags) ? order.specialLandscapeTags.map(String) : [],
    topStage: order.topStage,
    productionProgress: Array.isArray(order.productionProgress)
      ? order.productionProgress
        .slice()
        .sort((left: any, right: any) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0))
        .map((node: any) => ({
          code: String(node.code ?? ''),
          label: String(node.label ?? ''),
          status: node.status === 'completed' ? 'completed' : node.status === 'active' ? 'active' : 'pending',
          activatedAt: toIso(node.activatedAt),
          remark: typeof node.remark === 'string' ? node.remark : null,
          sortOrder: Number(node.sortOrder ?? 0),
        }))
      : [],
    delivery: {
      sceneSpotId,
      sceneId,
      sceneSpotTitle,
      boundAt: toIso(order.deliveryBoundAt),
    },
    service: {
      startAt: toIso(order.serviceStartAt),
      endAt: toIso(order.serviceEndAt),
      status: serviceSnapshot.status,
      daysRemaining: serviceSnapshot.daysRemaining,
      warningDays,
      durationDays: Math.max(Number(order.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1),
      price: Math.max(Number(order.servicePrice) || DEFAULT_SERVICE_PRICE, 0),
    },
    contactPhoneForBusiness: typeof order.contactPhoneForBusiness === 'string' ? order.contactPhoneForBusiness : null,
    notes: typeof order.notes === 'string' ? order.notes : null,
    quotedAt: toIso(order.quotedAt),
    signedAt: toIso(order.signedAt),
    productionStartedAt: toIso(order.productionStartedAt),
    productionCompletedAt: toIso(order.productionCompletedAt),
    publishReadyAt: toIso(order.publishReadyAt),
    publishedAt: toIso(order.publishedAt),
    operatingAt: toIso(order.operatingAt),
    renewalCount: Math.max(Number(order.renewalCount) || 0, 0),
    lastRenewedAt: toIso(order.lastRenewedAt),
    share: {
      wechatRuleLink: share?.wechatRuleLink ?? null,
      urlScheme: share?.urlScheme ?? null,
      miniProgramPath: share?.miniProgramPath ?? null,
    },
    analyticsAvailable: order.topStage === 'operation' && Boolean(sceneId && sceneSpotId),
    renewalHistory: renewalRows.map((item) => ({
      ...buildRenewalHistoryItem(item),
    })),
    createdAt: toIso(order.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(order.updatedAt) ?? new Date().toISOString(),
  }
}

async function refreshServiceStatus(order: BusinessOrderDocument): Promise<void> {
  const snapshot = getBusinessServiceSnapshot({
    serviceStartAt: order.serviceStartAt ?? null,
    serviceEndAt: order.serviceEndAt ?? null,
    renewalWarningDays: order.renewalWarningDays ?? DEFAULT_WARNING_DAYS,
    topStage: order.topStage,
  })
  order.serviceStatus = snapshot.status
}

export async function getBusinessOrderBootstrap(userId: string, origin?: string): Promise<BusinessOrderBootstrapData> {
  const [user, latestOrder, categories, businessContactPhone] = await Promise.all([
    AppUserModel.findById(userId, { contractStatus: 1 }).lean().exec(),
    BusinessOrderModel.findOne({ userId, parentOrderId: null }).sort({ createdAt: -1 }).lean().exec(),
    listSceneSpotCategories(),
    getBusinessContactPhone(),
  ])
  if (!user) {
    throw new Error('User not found')
  }
  const categoryNameMap = new Map(categories.filter((item) => item.enabled).map((item) => [item.id, item.name]))
  const userMap = new Map([[String(userId), { _id: userId, contractStatus: user.contractStatus }]])
  return {
    contractStatus: user.contractStatus === 'signed' ? 'signed' : 'unsigned',
    latestOrder: latestOrder ? await mapBusinessOrder(latestOrder, { categoryNameMap, userMap, origin }) : null,
    scenicTypes: categories.filter((item) => item.enabled).map((item) => ({ id: item.id, name: item.name })),
    specialLandscapeOptions: BUSINESS_SPECIAL_LANDSCAPE_OPTIONS,
    businessContactPhone,
  }
}

export async function createBusinessOrder(input: CreateBusinessOrderInput, origin?: string): Promise<BusinessOrderView> {
  const scenicName = normalizeString(input.scenicName)
  const addressText = normalizeString(input.addressText)
  const contactPhone = normalizeString(input.contactPhone)
  if (!scenicName) {
    throw new Error('景点名称不能为空')
  }
  if (!addressText) {
    throw new Error('地址不能为空')
  }
  if (!contactPhone) {
    throw new Error('联系电话不能为空')
  }

  const user = await AppUserModel.findById(input.userId).exec()
  if (!user) {
    throw new Error('User not found')
  }
  const businessContactPhone = await getBusinessContactPhone()

  const existingOrder = await BusinessOrderModel.findOne({
    userId: input.userId,
    parentOrderId: null,
    topStage: { $in: ['signing', 'production', 'publish'] },
  })
    .sort({ createdAt: -1 })
    .lean()
    .exec()
  if (existingOrder) {
    throw new Error('当前已有进行中的商业订单')
  }

  const categoryId = ensureObjectId(normalizeNullableString(input.sceneSpotCategoryId), '景点类型无效')
  const now = new Date()
  const created = await BusinessOrderModel.create({
    userId: new Types.ObjectId(input.userId),
    orderNumber: generateBusinessOrderNumber(),
    orderKind: 'new',
    scenicName,
    addressText,
    location: normalizeLocation(input.location),
    contactPhone,
    scenicArea: normalizeArea(input.scenicArea),
    sceneSpotCategoryId: categoryId,
    specialLandscapeTags: ensureLandscapeTags(input.specialLandscapeTags),
    topStage: 'signing',
    productionProgress: buildProductionTemplate(),
    contactPhoneForBusiness: businessContactPhone,
    quotedAt: now,
    serviceDurationDays: DEFAULT_SERVICE_DURATION_DAYS,
    servicePrice: DEFAULT_SERVICE_PRICE,
    renewalWarningDays: DEFAULT_WARNING_DAYS,
    serviceStatus: 'pending',
  })
  created.rootOrderId = created._id
  await created.save()

  const view = await mapBusinessOrder(created.toObject(), {
    userMap: new Map([[String(user._id), user.toObject()]]),
    origin,
  })
  return view
}

export async function getLatestBusinessOrderForUser(userId: string, origin?: string): Promise<BusinessOrderView | null> {
  const order = await BusinessOrderModel.findOne({ userId, parentOrderId: null }).sort({ createdAt: -1 }).lean().exec()
  return order ? mapBusinessOrder(order, { origin }) : null
}

export async function listBusinessOrders(params: {
  page?: number
  pageSize?: number
  keyword?: string
  topStage?: string
  contractStatus?: string
  userId?: string
  serviceStatus?: string
  origin?: string
}): Promise<{ data: BusinessOrderView[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(Number(params.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(params.pageSize) || 20, 1), 100)
  const skip = (page - 1) * pageSize
  const applyDynamicServiceFilter = Boolean(params.serviceStatus && ['pending', 'active', 'expiring', 'expired'].includes(params.serviceStatus))
  const filter: Record<string, unknown> = { parentOrderId: null }
  const userObjectId = ensureObjectId(normalizeNullableString(params.userId), 'Invalid user id')
  if (userObjectId) {
    filter.userId = userObjectId
  }
  if (params.keyword && params.keyword.trim()) {
    const regex = new RegExp(params.keyword.trim(), 'i')
    filter.$or = [{ orderNumber: regex }, { scenicName: regex }, { addressText: regex }, { contactPhone: regex }]
  }
  if (params.topStage && ['quote', 'signing', 'production', 'publish', 'operation'].includes(params.topStage)) {
    filter.topStage = params.topStage
  }
  if (params.contractStatus && ['unsigned', 'signed'].includes(params.contractStatus)) {
    const users = await AppUserModel.find({ contractStatus: params.contractStatus }, { _id: 1 }).lean().exec()
    const contractUserIds = users.map((user: any) => user._id)
    if (userObjectId) {
      filter.userId = contractUserIds.some((id: any) => String(id) === String(userObjectId)) ? userObjectId : { $in: [] }
    } else {
      filter.userId = { $in: contractUserIds }
    }
  }
  const [rows, total, categoryNameMap] = await Promise.all([
    applyDynamicServiceFilter
      ? BusinessOrderModel.find(filter).sort({ createdAt: -1 }).lean().exec()
      : BusinessOrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec(),
    BusinessOrderModel.countDocuments(filter),
    getCategoryNameMap(),
  ])
  const userMap = await buildUserMap(rows.map((row: any) => String(row.userId)))
  const mappedRows = await Promise.all(rows.map(async (row: any) => mapBusinessOrder(row, {
    categoryNameMap,
    userMap,
    origin: params.origin,
  })))
  const filteredRows = applyDynamicServiceFilter
    ? mappedRows.filter((item) => item.service.status === params.serviceStatus)
    : mappedRows
  const data = applyDynamicServiceFilter ? filteredRows.slice(skip, skip + pageSize) : filteredRows
  const normalizedTotal = applyDynamicServiceFilter ? filteredRows.length : total
  return { data, total: normalizedTotal, page, pageSize }
}

export async function listBusinessOrdersForUser(userId: string, origin?: string): Promise<BusinessOrderView[]> {
  const rows = await BusinessOrderModel.find({ userId, parentOrderId: null }).sort({ createdAt: -1 }).lean().exec()
  if (!rows.length) {
    return []
  }
  const [categoryNameMap, userMap] = await Promise.all([
    getCategoryNameMap(),
    buildUserMap([userId]),
  ])
  return Promise.all(rows.map((row) => mapBusinessOrder(row, { categoryNameMap, userMap, origin })))
}

export async function getBusinessOrderById(id: string, options?: {
  includeRenewals?: boolean
  origin?: string
}): Promise<BusinessOrderView | null> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('Invalid business order id')
  }
  const row = await BusinessOrderModel.findById(id).lean().exec()
  return row ? mapBusinessOrder(row, { includeRenewals: options?.includeRenewals, origin: options?.origin }) : null
}

export async function getBusinessOrderDetailForUser(id: string, userId: string, origin?: string): Promise<BusinessOrderView | null> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('Invalid business order id')
  }
  const row = await BusinessOrderModel.findOne({ _id: id, userId, parentOrderId: null }).lean().exec()
  return row ? mapBusinessOrder(row, { includeRenewals: true, origin }) : null
}

async function loadBusinessOrderDocument(id: string): Promise<BusinessOrderDocument> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('Invalid business order id')
  }
  const order = await BusinessOrderModel.findById(id).exec()
  if (!order) {
    throw new Error('Business order not found')
  }
  return order
}

async function loadRootOrderById(id: string): Promise<BusinessOrderDocument> {
  const order = await loadBusinessOrderDocument(id)
  if (order.parentOrderId) {
    const rootId = String(order.rootOrderId ?? order.parentOrderId)
    return loadBusinessOrderDocument(rootId)
  }
  return order
}

export async function markBusinessOrderSigned(id: string, origin?: string): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (order.topStage !== 'signing') {
    throw new Error('当前订单不在签约阶段')
  }
  const now = new Date()
  order.topStage = 'production'
  order.signedAt = now
  order.productionStartedAt = now
  order.productionProgress = order.productionProgress.map((node, index) => ({
    ...node,
    status: index === 0 ? 'active' : 'pending',
    activatedAt: index === 0 ? now : node.activatedAt ?? null,
  })) as any
  await order.save()
  await AppUserModel.findByIdAndUpdate(order.userId, { contractStatus: 'signed' }).exec()
  return (await getBusinessOrderById(String(order._id), { includeRenewals: true, origin })) as BusinessOrderView
}

export async function advanceBusinessOrderProduction(id: string, remark?: string | null, origin?: string): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (order.topStage !== 'production') {
    throw new Error('当前订单不在制作阶段')
  }
  const nodes = Array.isArray(order.productionProgress) ? [...order.productionProgress].sort((a, b) => a.sortOrder - b.sortOrder) : []
  const activeIndex = nodes.findIndex((node) => node.status === 'active')
  if (activeIndex === -1) {
    throw new Error('当前没有可推进的制作节点')
  }
  const now = new Date()
  nodes[activeIndex] = {
    ...nodes[activeIndex],
    status: 'completed',
    remark: normalizeNullableString(remark) ?? nodes[activeIndex].remark ?? null,
    activatedAt: nodes[activeIndex].activatedAt ?? now,
  }
  if (activeIndex + 1 < nodes.length) {
    nodes[activeIndex + 1] = {
      ...nodes[activeIndex + 1],
      status: 'active',
      activatedAt: nodes[activeIndex + 1].activatedAt ?? now,
    }
  }
  order.productionProgress = nodes as any
  await order.save()
  return (await getBusinessOrderById(String(order._id), { includeRenewals: true, origin })) as BusinessOrderView
}

export async function completeBusinessOrderProduction(id: string, origin?: string): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (order.topStage !== 'production') {
    throw new Error('当前订单不在制作阶段')
  }
  const now = new Date()
  order.productionProgress = order.productionProgress.map((node) => ({
    ...node,
    status: 'completed',
    activatedAt: node.activatedAt ?? now,
  })) as any
  order.topStage = 'publish'
  order.productionCompletedAt = now
  order.publishReadyAt = now
  await order.save()
  return (await getBusinessOrderById(String(order._id), { includeRenewals: true, origin })) as BusinessOrderView
}

export async function completeBusinessOrderPublish(id: string, origin?: string): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (order.topStage !== 'publish') {
    throw new Error('当前订单不在发布阶段')
  }
  order.publishedAt = new Date()
  await order.save()
  return (await getBusinessOrderById(String(order._id), { includeRenewals: true, origin })) as BusinessOrderView
}

export async function bindBusinessOrderDelivery(id: string, sceneSpotId: string, origin?: string): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (order.parentOrderId) {
    throw new Error('续费记录不允许绑定交付场景')
  }
  if (!Types.ObjectId.isValid(sceneSpotId)) {
    throw new Error('Invalid scene spot id')
  }
  const spot = await SceneSpotModel.findById(sceneSpotId).lean().exec()
  if (!spot) {
    throw new Error('Scene spot not found')
  }
  order.deliverySceneSpotId = new Types.ObjectId(sceneSpotId)
  order.deliverySceneId = new Types.ObjectId(String(spot.sceneId))
  order.deliverySceneSpotTitle = String(spot.title ?? '')
  order.deliveryBoundAt = new Date()
  await order.save()
  return (await getBusinessOrderById(String(order._id), { includeRenewals: true, origin })) as BusinessOrderView
}

export async function completeBusinessOrderOperation(id: string, origin?: string): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (order.topStage !== 'publish') {
    throw new Error('当前订单不在发布阶段')
  }
  if (!order.publishedAt) {
    throw new Error('请先完成发布')
  }
  if (!order.deliverySceneId || !order.deliverySceneSpotId) {
    throw new Error('请先绑定交付场景')
  }
  const now = new Date()
  const durationDays = Math.max(Number(order.serviceDurationDays) || DEFAULT_SERVICE_DURATION_DAYS, 1)
  order.topStage = 'operation'
  order.operatingAt = now
  order.serviceStartAt = order.serviceStartAt ?? now
  order.serviceEndAt = order.serviceEndAt ?? addDays(order.serviceStartAt, durationDays)
  await refreshServiceStatus(order)
  await order.save()
  return (await getBusinessOrderById(String(order._id), { includeRenewals: true, origin })) as BusinessOrderView
}

export async function updateBusinessOrderAdminFields(id: string, payload: {
  notes?: unknown
  contactPhoneForBusiness?: unknown
  serviceDurationDays?: unknown
  servicePrice?: unknown
  serviceStartAt?: unknown
  serviceEndAt?: unknown
  renewalWarningDays?: unknown
}, origin?: string): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (payload.notes !== undefined) {
    order.notes = normalizeNullableString(payload.notes)
  }
  if (payload.contactPhoneForBusiness !== undefined) {
    order.contactPhoneForBusiness =
      normalizeNullableString(payload.contactPhoneForBusiness) ??
      (await getBusinessContactPhone())
  }
  if (payload.serviceDurationDays !== undefined) {
    order.serviceDurationDays = normalizePositiveNumber(payload.serviceDurationDays, DEFAULT_SERVICE_DURATION_DAYS, '服务时长')
  }
  if (payload.servicePrice !== undefined) {
    order.servicePrice = normalizeNonNegativeNumber(payload.servicePrice, DEFAULT_SERVICE_PRICE, '服务价格')
  }
  if (payload.renewalWarningDays !== undefined) {
    order.renewalWarningDays = normalizePositiveNumber(payload.renewalWarningDays, DEFAULT_WARNING_DAYS, '续费提醒天数')
  }
  if (payload.serviceStartAt !== undefined) {
    order.serviceStartAt = parseDateValue(payload.serviceStartAt, '服务开始时间')
  }
  if (payload.serviceEndAt !== undefined) {
    order.serviceEndAt = parseDateValue(payload.serviceEndAt, '服务结束时间')
  }
  if (order.serviceStartAt && order.serviceEndAt && order.serviceEndAt.getTime() <= order.serviceStartAt.getTime()) {
    throw new Error('服务结束时间必须晚于开始时间')
  }
  await refreshServiceStatus(order)
  await order.save()
  return (await getBusinessOrderById(String(order._id), { includeRenewals: true, origin })) as BusinessOrderView
}

export async function getBusinessOrderRenewalPreview(id: string, userId?: string): Promise<BusinessOrderRenewalPreview> {
  const rootOrder = await loadRootOrderById(id)
  if (userId && String(rootOrder.userId) !== userId) {
    throw new Error('Business order not found')
  }
  if (rootOrder.topStage !== 'operation') {
    throw new Error('未进入运营的订单不可续费')
  }
  const preview = computeRenewalWindow(rootOrder)
  return {
    currentServiceEndAt: toIso(preview.currentServiceEndAt),
    nextServiceStartAt: preview.nextServiceStartAt.toISOString(),
    nextServiceEndAt: preview.nextServiceEndAt.toISOString(),
    durationDays: preview.durationDays,
    amount: preview.amount,
  }
}

export async function createBusinessOrderRenewal(id: string, userId: string): Promise<BusinessOrderRenewalHistoryItem> {
  const rootOrder = await loadRootOrderById(id)
  if (String(rootOrder.userId) !== userId) {
    throw new Error('Business order not found')
  }
  if (rootOrder.parentOrderId) {
    throw new Error('续费请基于主订单发起')
  }
  if (rootOrder.topStage !== 'operation') {
    throw new Error('未进入运营的订单不可续费')
  }
  const existingPendingRenewal = await BusinessOrderModel.findOne({
    rootOrderId: rootOrder._id,
    parentOrderId: rootOrder._id,
    orderKind: 'renewal',
    renewalApprovedAt: null,
  })
    .lean()
    .exec()
  if (existingPendingRenewal) {
    throw new Error('当前已有待处理的续费申请')
  }

  const preview = computeRenewalWindow(rootOrder)
  const created = await BusinessOrderModel.create({
    userId: rootOrder.userId,
    orderNumber: generateBusinessOrderNumber('BR'),
    rootOrderId: rootOrder._id,
    parentOrderId: rootOrder._id,
    orderKind: 'renewal',
    scenicName: rootOrder.scenicName,
    addressText: rootOrder.addressText,
    location: rootOrder.location ?? null,
    contactPhone: rootOrder.contactPhone,
    scenicArea: rootOrder.scenicArea ?? null,
    sceneSpotCategoryId: rootOrder.sceneSpotCategoryId ?? null,
    specialLandscapeTags: rootOrder.specialLandscapeTags ?? [],
    topStage: 'operation',
    productionProgress: [],
    deliverySceneSpotId: rootOrder.deliverySceneSpotId ?? null,
    deliverySceneId: rootOrder.deliverySceneId ?? null,
    deliverySceneSpotTitle: rootOrder.deliverySceneSpotTitle ?? null,
    deliveryBoundAt: rootOrder.deliveryBoundAt ?? null,
    contactPhoneForBusiness: rootOrder.contactPhoneForBusiness ?? null,
    notes: rootOrder.notes ?? null,
    serviceDurationDays: preview.durationDays,
    servicePrice: preview.amount,
    serviceStartAt: preview.nextServiceStartAt,
    serviceEndAt: preview.nextServiceEndAt,
    serviceStatus: 'pending',
    paymentStatus: 'unpaid',
    paymentMethod: 'wechat',
    paymentProvider: null,
    prepayId: null,
    transactionId: null,
    paidAt: null,
    paymentResult: null,
    renewalWarningDays: rootOrder.renewalWarningDays ?? DEFAULT_WARNING_DAYS,
    renewalCount: rootOrder.renewalCount ?? 0,
    quotedAt: new Date(),
    publishedAt: rootOrder.publishedAt ?? null,
    operatingAt: rootOrder.operatingAt ?? null,
  })
  return {
    ...buildRenewalHistoryItem(created.toObject()),
  }
}

export async function createBusinessOrderRenewalPayment(
  id: string,
  userId: string,
  miniAppId: string | undefined,
  openId: string,
  origin?: string,
): Promise<BusinessOrderRenewalPaymentResult> {
  const rootOrder = await loadRootOrderById(id)
  if (String(rootOrder.userId) !== userId) {
    throw new Error('Business order not found')
  }
  if (rootOrder.parentOrderId) {
    throw new Error('续费请基于主订单发起')
  }
  if (rootOrder.topStage !== 'operation') {
    throw new Error('未进入运营的订单不可续费')
  }

  const now = new Date()
  let renewalOrder = await BusinessOrderModel.findOne({
    rootOrderId: rootOrder._id,
    parentOrderId: rootOrder._id,
    orderKind: 'renewal',
    renewalApprovedAt: null,
  }).exec()

  const preview = computeRenewalWindow(rootOrder, now)
  if (!renewalOrder) {
    renewalOrder = await BusinessOrderModel.create({
      userId: rootOrder.userId,
      orderNumber: generateBusinessOrderNumber('BR'),
      rootOrderId: rootOrder._id,
      parentOrderId: rootOrder._id,
      orderKind: 'renewal',
      scenicName: rootOrder.scenicName,
      addressText: rootOrder.addressText,
      location: rootOrder.location ?? null,
      contactPhone: rootOrder.contactPhone,
      scenicArea: rootOrder.scenicArea ?? null,
      sceneSpotCategoryId: rootOrder.sceneSpotCategoryId ?? null,
      specialLandscapeTags: rootOrder.specialLandscapeTags ?? [],
      topStage: 'operation',
      productionProgress: [],
      deliverySceneSpotId: rootOrder.deliverySceneSpotId ?? null,
      deliverySceneId: rootOrder.deliverySceneId ?? null,
      deliverySceneSpotTitle: rootOrder.deliverySceneSpotTitle ?? null,
      deliveryBoundAt: rootOrder.deliveryBoundAt ?? null,
      contactPhoneForBusiness: rootOrder.contactPhoneForBusiness ?? null,
      notes: rootOrder.notes ?? null,
      serviceDurationDays: preview.durationDays,
      servicePrice: preview.amount,
      serviceStartAt: preview.nextServiceStartAt,
      serviceEndAt: preview.nextServiceEndAt,
      serviceStatus: 'pending',
      paymentStatus: 'unpaid',
      paymentMethod: 'wechat',
      paymentProvider: null,
      prepayId: null,
      transactionId: null,
      paidAt: null,
      paymentResult: null,
      renewalWarningDays: rootOrder.renewalWarningDays ?? DEFAULT_WARNING_DAYS,
      renewalCount: rootOrder.renewalCount ?? 0,
      quotedAt: now,
      publishedAt: rootOrder.publishedAt ?? null,
      operatingAt: rootOrder.operatingAt ?? null,
    })
  } else {
    renewalOrder.serviceDurationDays = preview.durationDays
    renewalOrder.servicePrice = preview.amount
    renewalOrder.serviceStartAt = preview.nextServiceStartAt
    renewalOrder.serviceEndAt = preview.nextServiceEndAt
    renewalOrder.serviceStatus = 'pending'
    renewalOrder.paymentStatus = 'unpaid'
    renewalOrder.paymentMethod = 'wechat'
    renewalOrder.paymentProvider = null
    renewalOrder.prepayId = null
    renewalOrder.transactionId = null
    renewalOrder.paidAt = null
    renewalOrder.paymentResult = null
    renewalOrder.renewalWarningDays = rootOrder.renewalWarningDays ?? DEFAULT_WARNING_DAYS
    renewalOrder.renewalCount = rootOrder.renewalCount ?? 0
    renewalOrder.quotedAt = now
    await renewalOrder.save()
  }

  const paymentResult = await createOrderPayment({
    channel: 'wechat',
    miniAppId,
    orderNumber: renewalOrder.orderNumber,
    description: `${rootOrder.scenicName} 续费`,
    amount: preview.amount,
    openId,
    attach: JSON.stringify({
      businessOrderId: String(rootOrder._id ?? ''),
      renewalOrderId: String(renewalOrder._id ?? ''),
      userId,
      type: 'business-renewal',
    }),
  })

  renewalOrder.paymentProvider = paymentResult.provider
  renewalOrder.paymentStatus = paymentResult.status === 'pending' ? 'processing' : 'failed'
  renewalOrder.prepayId = paymentResult.prepayId ?? null
  renewalOrder.paymentResult = {
    ...(renewalOrder.paymentResult ?? {}),
    prepay: paymentResult.raw ?? null,
    requestedAt: now.toISOString(),
  }
  await renewalOrder.save()

  return {
    renewal: buildRenewalHistoryItem(renewalOrder.toObject()),
    orderNumber: renewalOrder.orderNumber,
    paymentStatus: normalizeBusinessPaymentStatus(renewalOrder.paymentStatus),
    payParams: paymentResult.payParams ?? null,
  }
}

export async function approveBusinessOrderRenewal(id: string, origin?: string): Promise<BusinessOrderView> {
  const renewalOrder = await loadBusinessOrderDocument(id)
  if (renewalOrder.orderKind !== 'renewal' || !renewalOrder.parentOrderId) {
    throw new Error('当前订单不是续费订单')
  }
  if (renewalOrder.renewalApprovedAt) {
    throw new Error('该续费订单已审批')
  }
  const rootOrder = await loadBusinessOrderDocument(String(renewalOrder.rootOrderId ?? renewalOrder.parentOrderId))
  const now = new Date()
  const rootWasActive = Boolean(rootOrder.serviceEndAt && rootOrder.serviceEndAt.getTime() > now.getTime())
  renewalOrder.renewalApprovedAt = now
  renewalOrder.lastRenewedAt = now
  renewalOrder.serviceStatus = 'active'
  await renewalOrder.save()

  rootOrder.serviceStartAt = rootWasActive ? (rootOrder.serviceStartAt ?? now) : now
  rootOrder.serviceEndAt = renewalOrder.serviceEndAt ?? rootOrder.serviceEndAt
  rootOrder.lastRenewedAt = now
  rootOrder.renewalCount = Math.max(Number(rootOrder.renewalCount) || 0, 0) + 1
  rootOrder.serviceDurationDays = renewalOrder.serviceDurationDays ?? rootOrder.serviceDurationDays
  rootOrder.servicePrice = renewalOrder.servicePrice ?? rootOrder.servicePrice
  await refreshServiceStatus(rootOrder)
  await rootOrder.save()

  return (await getBusinessOrderById(String(rootOrder._id), { includeRenewals: true, origin })) as BusinessOrderView
}

export async function listBusinessOrderRenewals(id: string): Promise<BusinessOrderRenewalHistoryItem[]> {
  const rootOrder = await loadRootOrderById(id)
  const rows = await loadRenewalRows(String(rootOrder._id))
  return rows.map((item) => ({
    ...buildRenewalHistoryItem(item),
  }))
}

export async function applyBusinessOrderRenewalPaymentSuccess(params: {
  renewalOrderNumber: string
  transactionId?: string
  notifyId?: string
  transaction: Record<string, unknown>
  origin?: string
}): Promise<BusinessOrderView | null> {
  const renewalOrder = await BusinessOrderModel.findOne({ orderNumber: params.renewalOrderNumber }).exec()
  if (!renewalOrder) {
    return null
  }
  if (renewalOrder.orderKind !== 'renewal' || !renewalOrder.parentOrderId) {
    throw new Error('当前订单不是续费订单')
  }
  if (renewalOrder.renewalApprovedAt) {
    const rootOrder = await loadBusinessOrderDocument(String(renewalOrder.rootOrderId ?? renewalOrder.parentOrderId))
    return (await getBusinessOrderById(String(rootOrder._id), { includeRenewals: true, origin: params.origin })) as BusinessOrderView
  }

  const rootOrder = await loadBusinessOrderDocument(String(renewalOrder.rootOrderId ?? renewalOrder.parentOrderId))
  const now = params.transaction && typeof params.transaction === 'object' ? new Date() : new Date()
  const preview = computeRenewalWindow(rootOrder, now)
  const rootWasActive = Boolean(rootOrder.serviceEndAt && rootOrder.serviceEndAt.getTime() > now.getTime())

  renewalOrder.serviceStartAt = preview.nextServiceStartAt
  renewalOrder.serviceEndAt = preview.nextServiceEndAt
  renewalOrder.serviceDurationDays = preview.durationDays
  renewalOrder.servicePrice = preview.amount
  renewalOrder.serviceStatus = 'active'
  renewalOrder.paymentStatus = 'succeeded'
  renewalOrder.paymentProvider = 'wechat'
  renewalOrder.transactionId = params.transactionId ?? renewalOrder.transactionId ?? null
  renewalOrder.paidAt = now
  renewalOrder.paymentResult = {
    ...(renewalOrder.paymentResult ?? {}),
    notifyId: params.notifyId ?? null,
    paid: params.transaction,
  }
  renewalOrder.renewalApprovedAt = now
  renewalOrder.lastRenewedAt = now
  await renewalOrder.save()

  rootOrder.serviceStartAt = rootWasActive ? (rootOrder.serviceStartAt ?? now) : now
  rootOrder.serviceEndAt = preview.nextServiceEndAt
  rootOrder.lastRenewedAt = now
  rootOrder.renewalCount = Math.max(Number(rootOrder.renewalCount) || 0, 0) + 1
  rootOrder.serviceDurationDays = preview.durationDays
  rootOrder.servicePrice = preview.amount
  await refreshServiceStatus(rootOrder)
  await rootOrder.save()

  return (await getBusinessOrderById(String(rootOrder._id), { includeRenewals: true, origin: params.origin })) as BusinessOrderView
}

export async function applyBusinessOrderRenewalPaymentFailure(params: {
  renewalOrderNumber: string
  notifyId?: string
  transaction: Record<string, unknown>
}): Promise<void> {
  const renewalOrder = await BusinessOrderModel.findOne({ orderNumber: params.renewalOrderNumber }).exec()
  if (!renewalOrder || renewalOrder.orderKind !== 'renewal' || !renewalOrder.parentOrderId) {
    return
  }
  if (renewalOrder.renewalApprovedAt) {
    return
  }

  renewalOrder.paymentStatus = 'failed'
  renewalOrder.paymentProvider = 'wechat'
  renewalOrder.paymentResult = {
    ...(renewalOrder.paymentResult ?? {}),
    notifyId: params.notifyId ?? null,
    failed: params.transaction,
  }
  await renewalOrder.save()
}

export async function getBusinessOrderAnalyticsByOrder(id: string, userId?: string, options?: {
  dimension?: 'checkpoint' | 'category'
  granularity?: 'day' | 'month'
  limit?: number
  metric?: 'pv' | 'uv' | 'newUsers' | 'punchCount'
  start?: string
  end?: string
}) {
  const rootOrder = await loadRootOrderById(id)
  if (userId && String(rootOrder.userId) !== userId) {
    throw new Error('Business order not found')
  }
  if (!rootOrder.deliverySceneId || !rootOrder.deliverySceneSpotId) {
    throw new Error('当前订单未绑定交付场景')
  }
  return getBusinessOrderAnalytics({
    sceneId: String(rootOrder.deliverySceneId),
    sceneSpotId: String(rootOrder.deliverySceneSpotId),
    dimension: options?.dimension,
    granularity: options?.granularity,
    start: options?.start,
    limit: options?.limit,
    metric: options?.metric,
    end: options?.end,
  })
}
