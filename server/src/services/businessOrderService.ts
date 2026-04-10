import { Types } from 'mongoose'
import { BusinessOrderModel } from '@/models/BusinessOrder'
import { AppUserModel } from '@/models/AppUser'
import { listSceneSpotCategories } from '@/services/sceneSpotCategoryService'
import { getBusinessConfig } from './businessConfigService'
import type {
  BusinessOrderDocument,
  BusinessOrderProductionNode,
  BusinessOrderTopStage,
} from '@/types/models'

export interface BusinessLandscapeOption {
  code: string
  label: string
}

export interface BusinessOrderCategoryOption {
  id: string
  name: string
}

export interface BusinessOrderView {
  id: string
  orderNumber: string
  userId: string
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
  contactPhoneForBusiness: string | null
  notes: string | null
  quotedAt: string | null
  signedAt: string | null
  productionStartedAt: string | null
  productionCompletedAt: string | null
  publishReadyAt: string | null
  publishedAt: string | null
  operatingAt: string | null
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

// const DEFAULT_BUSINESS_CONTACT_PHONE = '400-000-0000'

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

function generateBusinessOrderNumber(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const random = Math.floor(Math.random() * 9000 + 1000)
  return `BO${stamp}${random}`
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

async function mapBusinessOrder(order: any, dependencies?: {
  categoryNameMap?: Map<string, string>
  userMap?: Map<string, any>
}): Promise<BusinessOrderView> {
  const categoryNameMap = dependencies?.categoryNameMap ?? await getCategoryNameMap()
  const userMap = dependencies?.userMap ?? await buildUserMap([String(order.userId)])
  const user = userMap.get(String(order.userId)) ?? null
  const categoryId = order.sceneSpotCategoryId ? String(order.sceneSpotCategoryId) : null
  return {
    id: String(order._id),
    orderNumber: String(order.orderNumber),
    userId: String(order.userId),
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
    contactPhoneForBusiness: typeof order.contactPhoneForBusiness === 'string' ? order.contactPhoneForBusiness : null,
    notes: typeof order.notes === 'string' ? order.notes : null,
    quotedAt: toIso(order.quotedAt),
    signedAt: toIso(order.signedAt),
    productionStartedAt: toIso(order.productionStartedAt),
    productionCompletedAt: toIso(order.productionCompletedAt),
    publishReadyAt: toIso(order.publishReadyAt),
    publishedAt: toIso(order.publishedAt),
    operatingAt: toIso(order.operatingAt),
    createdAt: toIso(order.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(order.updatedAt) ?? new Date().toISOString(),
  }
}

export async function getBusinessOrderBootstrap(userId: string): Promise<BusinessOrderBootstrapData> {
  const [user, latestOrder, categories, businessConfig] = await Promise.all([
    AppUserModel.findById(userId, { contractStatus: 1 }).lean().exec(),
    BusinessOrderModel.findOne({ userId }).sort({ createdAt: -1 }).lean().exec(),
    listSceneSpotCategories(),
    getBusinessConfig(),
  ])
  if (!user) {
    throw new Error('User not found')
  }
  const categoryNameMap = new Map(categories.filter((item) => item.enabled).map((item) => [item.id, item.name]))
  const userMap = new Map([[String(userId), { _id: userId, contractStatus: user.contractStatus }]])
  return {
    contractStatus: user.contractStatus === 'signed' ? 'signed' : 'unsigned',
    latestOrder: latestOrder ? await mapBusinessOrder(latestOrder, { categoryNameMap, userMap }) : null,
    scenicTypes: categories.filter((item) => item.enabled).map((item) => ({ id: item.id, name: item.name })),
    specialLandscapeOptions: BUSINESS_SPECIAL_LANDSCAPE_OPTIONS,
    businessContactPhone: businessConfig?.contactPhone || '',
  }
}

export async function createBusinessOrder(input: CreateBusinessOrderInput): Promise<BusinessOrderView> {
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

  const existingOrder = await BusinessOrderModel.findOne({
    userId: input.userId,
    topStage: { $in: ['quote', 'signing', 'production', 'publish'] },
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
    scenicName,
    addressText,
    location: normalizeLocation(input.location),
    contactPhone,
    scenicArea: normalizeArea(input.scenicArea),
    sceneSpotCategoryId: categoryId,
    specialLandscapeTags: ensureLandscapeTags(input.specialLandscapeTags),
    topStage: 'signing',
    productionProgress: buildProductionTemplate(),
    contactPhoneForBusiness: DEFAULT_BUSINESS_CONTACT_PHONE,
    quotedAt: now,
  })
  const view = await mapBusinessOrder(created.toObject(), {
    userMap: new Map([[String(user._id), user.toObject()]]),
  })
  return view
}

export async function getLatestBusinessOrderForUser(userId: string): Promise<BusinessOrderView | null> {
  const order = await BusinessOrderModel.findOne({ userId }).sort({ createdAt: -1 }).lean().exec()
  return order ? mapBusinessOrder(order) : null
}

export async function listBusinessOrders(params: {
  page?: number
  pageSize?: number
  keyword?: string
  topStage?: string
  contractStatus?: string
}): Promise<{ data: BusinessOrderView[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(Number(params.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(params.pageSize) || 20, 1), 100)
  const skip = (page - 1) * pageSize
  const filter: Record<string, unknown> = {}
  if (params.keyword && params.keyword.trim()) {
    const regex = new RegExp(params.keyword.trim(), 'i')
    filter.$or = [{ orderNumber: regex }, { scenicName: regex }, { addressText: regex }, { contactPhone: regex }]
  }
  if (params.topStage && ['quote', 'signing', 'production', 'publish', 'operation'].includes(params.topStage)) {
    filter.topStage = params.topStage
  }
  if (params.contractStatus && ['unsigned', 'signed'].includes(params.contractStatus)) {
    const users = await AppUserModel.find({ contractStatus: params.contractStatus }, { _id: 1 }).lean().exec()
    filter.userId = { $in: users.map((user: any) => user._id) }
  }
  const [rows, total, categoryNameMap] = await Promise.all([
    BusinessOrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec(),
    BusinessOrderModel.countDocuments(filter),
    getCategoryNameMap(),
  ])
  const userMap = await buildUserMap(rows.map((row: any) => String(row.userId)))
  const data = await Promise.all(rows.map((row: any) => mapBusinessOrder(row, { categoryNameMap, userMap })))
  return { data, total, page, pageSize }
}

export async function getBusinessOrderById(id: string): Promise<BusinessOrderView | null> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('Invalid business order id')
  }
  const row = await BusinessOrderModel.findById(id).lean().exec()
  return row ? mapBusinessOrder(row) : null
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

export async function markBusinessOrderSigned(id: string): Promise<BusinessOrderView> {
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
  return (await getBusinessOrderById(String(order._id))) as BusinessOrderView
}

export async function advanceBusinessOrderProduction(id: string, remark?: string | null): Promise<BusinessOrderView> {
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
  return (await getBusinessOrderById(String(order._id))) as BusinessOrderView
}

export async function completeBusinessOrderProduction(id: string): Promise<BusinessOrderView> {
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
  return (await getBusinessOrderById(String(order._id))) as BusinessOrderView
}

export async function completeBusinessOrderPublish(id: string): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (order.topStage !== 'publish') {
    throw new Error('当前订单不在发布阶段')
  }
  const now = new Date()
  order.topStage = 'operation'
  order.publishedAt = now
  order.operatingAt = now
  await order.save()
  return (await getBusinessOrderById(String(order._id))) as BusinessOrderView
}

export async function updateBusinessOrderAdminFields(id: string, payload: {
  notes?: unknown
  contactPhoneForBusiness?: unknown
}): Promise<BusinessOrderView> {
  const order = await loadBusinessOrderDocument(id)
  if (payload.notes !== undefined) {
    order.notes = normalizeNullableString(payload.notes)
  }
  if (payload.contactPhoneForBusiness !== undefined) {
    order.contactPhoneForBusiness = normalizeNullableString(payload.contactPhoneForBusiness) ?? DEFAULT_BUSINESS_CONTACT_PHONE
  }
  await order.save()
  return (await getBusinessOrderById(String(order._id))) as BusinessOrderView
}