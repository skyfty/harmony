import type {
  AssetBundleHashAlgorithm,
  AssetBundlePersistedRole,
  AssetType as SchemaAssetType,
} from '@harmony/schema'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type { Document, Types } from 'mongoose'

export interface PermissionDocument extends Document<Types.ObjectId> {
  /** 中文：权限名称 */
  name: string
  /** 中文：权限代码（唯一标识） */
  code: string
  /** 中文：权限描述（可选） */
  description?: string
  /** 中文：权限分组（可选） */
  group?: string
  /** 中文：创建时间（由数据库维护） */
  createdAt: Date
  /** 中文：更新时间（由数据库维护） */
  updatedAt: Date
}

export interface RoleDocument extends Document<Types.ObjectId> {
  /** 中文：角色名称 */
  name: string
  /** 中文：角色代码（唯一标识） */
  code: string
  /** 中文：角色描述（可选） */
  description?: string
  /** 中文：关联的权限 ID 列表 */
  permissions: Types.ObjectId[]
  /** 中文：创建时间（由数据库维护） */
  createdAt: Date
  /** 中文：更新时间（由数据库维护） */
  updatedAt: Date
}

export interface UserDocument extends Document<Types.ObjectId> {
  /** 中文：登录用户名 */
  username: string
  /** 中文：哈希后的密码 */
  password: string
  /** 中文：显示名称（可选） */
  displayName?: string
  /** 中文：电子邮件地址（可选） */
  email?: string
  /** 中文：头像 URL（可选） */
  avatarUrl?: string
  /** 中文：手机号码（可选） */
  phone?: string
  /** 中文：用户简介（可选） */
  bio?: string
  /** 中文：性别（可选，male/female/other） */
  gender?: 'male' | 'female' | 'other'
  /** 中文：出生日期（可选） */
  birthDate?: Date
  /** 中文：账号状态（active 或 disabled） */
  status: 'active' | 'disabled'
  /** 中文：角色 ID 列表 */
  roles: Types.ObjectId[]
  /** 中文：作品分享次数（可选） */
  workShareCount?: number
  /** 中文：展览分享次数（可选） */
  exhibitionShareCount?: number
  /** 中文：创建时间（由数据库维护） */
  createdAt: Date
  /** 中文：更新时间（由数据库维护） */
  updatedAt: Date
}

export interface AdminPermissionDocument extends Document<Types.ObjectId> {
  name: string
  code: string
  description?: string
  group?: string
  createdAt: Date
  updatedAt: Date
}

export interface AdminRoleDocument extends Document<Types.ObjectId> {
  name: string
  code: string
  description?: string
  permissions: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

export interface AdminDocument extends Document<Types.ObjectId> {
  username: string
  password: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  status: 'active' | 'disabled'
  roles: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

export interface AppUserDocument extends Document<Types.ObjectId> {
  miniAppId?: string
  username?: string
  password?: string
  authProvider: 'wechat-mini-program' | 'password'
  wxOpenId?: string
  wxUnionId?: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  phoneCountryCode?: string
  phoneBoundAt?: Date
  bio?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: Date
  lastLoginAt?: Date
  lastLoginSource?: string
  wechatProfileSyncedAt?: Date
  wechatIdentitySyncedAt?: Date
  status: 'active' | 'disabled'
  contractStatus: 'unsigned' | 'signed'
  currentVehicleId?: Types.ObjectId | null
  workShareCount?: number
  exhibitionShareCount?: number
  createdAt: Date
  updatedAt: Date
}

export type BusinessOrderTopStage = 'quote' | 'signing' | 'production' | 'publish' | 'operation'

export type BusinessOrderProductionNodeStatus = 'pending' | 'active' | 'completed'

export interface BusinessOrderProductionNode {
  code: string
  label: string
  status: BusinessOrderProductionNodeStatus
  activatedAt?: Date | null
  remark?: string | null
  sortOrder: number
}

export interface BusinessOrderDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  orderNumber: string
  scenicName: string
  addressText: string
  location?: {
    lat: number
    lng: number
  } | null
  contactPhone: string
  scenicArea?: number | null
  sceneSpotCategoryId?: Types.ObjectId | null
  specialLandscapeTags: string[]
  topStage: BusinessOrderTopStage
  productionProgress: BusinessOrderProductionNode[]
  contactPhoneForBusiness?: string | null
  notes?: string | null
  quotedAt?: Date | null
  signedAt?: Date | null
  productionStartedAt?: Date | null
  productionCompletedAt?: Date | null
  publishReadyAt?: Date | null
  publishedAt?: Date | null
  operatingAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface MiniAppWechatPayConfig {
  enabled: boolean
  mchId?: string
  serialNo?: string
  privateKey?: string
  apiV3Key?: string
  notifyUrl?: string
  baseUrl?: string
  platformPublicKey?: string
  callbackSkipVerifyInDev?: boolean
  mockPlatformPrivateKey?: string
}

export interface MiniAppDocument extends Document<Types.ObjectId> {
  miniAppId: string
  name: string
  appSecret: string
  enabled: boolean
  isDefault: boolean
  wechatPay: MiniAppWechatPayConfig
  createdAt: Date
  updatedAt: Date
}

export interface LoginAuditDocument extends Document<Types.ObjectId> {
  /** 中文：关联用户 ID（可选） */
  userId?: Types.ObjectId
  /** 中文：用户名（可选，便于查询） */
  username?: string
  /** 中文：动作，如 login/logout/token-refresh 等 */
  action: string
  /** 中文：是否成功 */
  success: boolean
  /** 中文：来源 IP（可选） */
  ip?: string
  /** 中文：User-Agent 字符串（可选） */
  userAgent?: string
  /** 中文：简化的设备/客户端信息（可选） */
  device?: string
  /** 中文：备注或失败原因（可选） */
  note?: string
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface PunchRecordDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  username?: string
  sceneId: string
  scenicId: string
  vehicleIdentifier?: string
  sceneName?: string
  nodeId: string
  nodeName?: string
  clientPunchTime?: Date
  behaviorPunchTime?: Date
  source?: string
  path?: string
  ip?: string
  userAgent?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface TravelRecordDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  username?: string
  sceneId: string
  scenicId: string
  vehicleIdentifier?: string
  sceneName?: string
  enterTime: Date
  leaveTime?: Date | null
  durationSeconds?: number | null
  status: 'active' | 'completed'
  source?: string
  path?: string
  ip?: string
  userAgent?: string
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface AnalyticsEventDocument extends Document<Types.ObjectId> {
  eventType: string
  userId?: Types.ObjectId | null
  sceneId?: Types.ObjectId | null
  sceneSpotId?: Types.ObjectId | null
  vehicleIdentifier?: string
  sessionId?: string
  source?: string
  device?: string
  path?: string
  dwellMs?: number
  metadata?: Record<string, unknown> | null
  occurredAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface RatingEntry {
  /** 中文：评分用户 ID */
  userId: Types.ObjectId
  /** 中文：评分分数 */
  score: number
  /** 中文：评分评论（可选） */
  comment?: string
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface VisitEntry {
  /** 中文：访问用户 ID */
  userId: Types.ObjectId
  /** 中文：访问时间 */
  visitedAt: Date
}

export interface WorkDocument extends Document<Types.ObjectId> {
  /** 中文：作品拥有者用户 ID */
  ownerId: Types.ObjectId
  /** 中文：作品标题 */
  title: string
  /** 中文：作品描述（可选） */
  description?: string
  /** 中文：媒体类型（image/video/model/other） */
  mediaType: 'image' | 'video' | 'model' | 'other'
  /** 中文：文件访问 URL */
  fileUrl: string
  /** 中文：缩略图 URL（可选） */
  thumbnailUrl?: string
  /** 中文：文件大小（字节，可选） */
  size?: number
  /** 中文：标签数组 */
  tags: string[]
  /** 中文：点赞用户 ID 列表 */
  likedBy: Types.ObjectId[]
  /** 中文：评分条目列表 */
  ratings: RatingEntry[]
  /** 中文：所属合集 ID 列表 */
  collections: Types.ObjectId[]
  /** 中文：评论数量 */
  commentCount: number
  /** 中文：分享次数 */
  shareCount: number
  /** 中文：额外元数据（可选） */
  metadata?: Record<string, unknown>
  /** 中文：地形散布预设类别（可选） */
  terrainScatterPreset?: TerrainScatterCategory | null
  /** 中文：创建时间（由数据库维护） */
  createdAt: Date
  /** 中文：更新时间（由数据库维护） */
  updatedAt: Date
}

export interface WorkRecordDocument extends Document<Types.ObjectId> {
  /** 中文：上传/关联用户 ID */
  userId: Types.ObjectId
  /** 中文：作品 ID */
  workId: Types.ObjectId
  /** 中文：文件名 */
  fileName: string
  /** 中文：文件 URL */
  fileUrl: string
  /** 中文：媒体类型（image/video/model/other） */
  mediaType: 'image' | 'video' | 'model' | 'other'
  /** 中文：文件大小（字节，可选） */
  fileSize?: number
  /** 中文：创建时间 */
  createdAt: Date
}

export interface WorkCollectionDocument extends Document<Types.ObjectId> {
  /** 中文：合集拥有者用户 ID */
  ownerId: Types.ObjectId
  /** 中文：合集标题 */
  title: string
  /** 中文：合集描述（可选） */
  description?: string
  /** 中文：封面图片 URL（可选） */
  coverUrl?: string
  /** 中文：合集内作品 ID 列表 */
  workIds: Types.ObjectId[]
  /** 中文：是否公开 */
  isPublic: boolean
  /** 中文：喜欢该合集的用户 ID 列表 */
  likes: Types.ObjectId[]
  /** 中文：评分条目列表 */
  ratings: RatingEntry[]
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface ExhibitionDocument extends Document<Types.ObjectId> {
  /** 中文：展览拥有者用户 ID */
  ownerId: Types.ObjectId
  /** 中文：展览名称 */
  name: string
  /** 中文：展览描述（可选） */
  description?: string
  /** 中文：封面 URL（可选） */
  coverUrl?: string
  /** 中文：多封面 URL 列表 */
  coverUrls: string[]
  /** 中文：关联场景标识（可选） */
  scene?: string
  /** 中文：展览开始时间（可选） */
  startDate?: Date
  /** 中文：展览结束时间（可选） */
  endDate?: Date
  /** 中文：展览包含的作品 ID 列表 */
  workIds: Types.ObjectId[]
  /** 中文：包含的合集 ID 列表 */
  collectionIds: Types.ObjectId[]
  /** 中文：展览状态（草稿/已发布/撤回） */
  status: 'draft' | 'published' | 'withdrawn'
  /** 中文：点赞用户 ID 列表 */
  likes: Types.ObjectId[]
  /** 中文：评分条目列表 */
  ratings: RatingEntry[]
  /** 中文：访问记录列表 */
  visits: VisitEntry[]
  /** 中文：分享次数 */
  shareCount: number
  /** 中文：额外元数据（可选） */
  metadata?: Record<string, unknown>
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface ProductUsageConfig {
  /** 中文：使用类型（永久或消耗性） */
  type: 'permanent' | 'consumable'
  /** 中文：每个展览的使用上限（可选） */
  perExhibitionLimit?: number | null
  /** 中文：互斥组标识（可选） */
  exclusiveGroup?: string | null
  /** 中文：是否可堆叠（可选） */
  stackable?: boolean
  /** 中文：备注（可选） */
  notes?: string
}

export interface WarehouseSnapshot {
  /** 中文：商品名称 */
  name: string
  /** 中文：商品价格（单位：分或元按约定） */
  price: number
  /** 中文：商品封面 URL（可选） */
  coverUrl?: string
  /** 中文：商品描述（可选） */
  description?: string
  /** 中文：商品使用配置快照（可选） */
  usageConfig?: ProductUsageConfig
}

export interface WarehouseDocument extends Document<Types.ObjectId> {
  /** 中文：所属用户 ID */
  userId: Types.ObjectId
  /** 中文：商品 ID */
  productId: Types.ObjectId
  /** 中文：当前库存数量 */
  quantity: number
  /** 中文：累计购买数量 */
  totalPurchased: number
  /** 中文：累计消耗数量 */
  totalConsumed: number
  /** 中文：商品快照信息 */
  productSnapshot: WarehouseSnapshot
  /** 中文：最新订单 ID（可选） */
  latestOrderId?: Types.ObjectId | null
  /** 中文：最近一次购买时间（可选） */
  lastPurchasedAt?: Date | null
  /** 中文：额外元数据（可选） */
  metadata?: Record<string, unknown>
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface ProductDocument extends Document<Types.ObjectId> {
  /** 中文：商品名称 */
  name: string
  /** 中文：短链接或标识符（slug） */
  slug: string
  /** 中文：商品分类 ID（可选） */
  categoryId?: Types.ObjectId | null
  /** 中文：商品价格 */
  price: number
  /** 中文：封面 URL（可选） */
  coverUrl?: string | null
  /** 中文：详细描述（可选） */
  description?: string
  /** 中文：标签数组 */
  tags: string[]
  /** 中文：使用配置（可选） */
  usageConfig?: ProductUsageConfig
  /** 中文：有效天数（可选） */
  validityDays?: number | null
  /** 中文：适用场景标签数组 */
  applicableSceneTags: string[]
  /** 中文：额外元数据（可选） */
  metadata?: Record<string, unknown> | null
  /** 中文：软删除标记 */
  isDeleted: boolean
  /** 中文：软删除时间（可选） */
  deletedAt?: Date | null
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface ProductCategoryDocument extends Document<Types.ObjectId> {
  /** 中文：分类名称 */
  name: string
  /** 中文：分类描述（可选） */
  description?: string | null
  /** 中文：排序值 */
  sortOrder: number
  /** 中文：是否启用 */
  enabled: boolean
  /** 中文：规范化名称 */
  normalizedName: string
  /** 中文：是否内置 */
  isBuiltin: boolean
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export type UserProductState = 'locked' | 'unused' | 'used' | 'expired'

export interface UserProductDocument extends Document<Types.ObjectId> {
  /** 中文：用户 ID */
  userId: Types.ObjectId
  /** 中文：商品 ID */
  productId: Types.ObjectId
  /** 中文：用户商品状态（locked/unused/used/expired） */
  state: UserProductState
  /** 中文：获取时间 */
  acquiredAt: Date
  /** 中文：使用时间（可选） */
  usedAt?: Date | null
  /** 中文：过期时间（可选） */
  expiresAt?: Date | null
  /** 中文：关联订单 ID（可选） */
  orderId?: Types.ObjectId | null
  /** 中文：额外元数据（可选） */
  metadata?: Record<string, unknown> | null
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface VehicleDocument extends Document<Types.ObjectId> {
  /** 中文：车辆唯一标识符（用于快速检索和外部关联） */
  identifier: string
  /** 中文：车辆名称 */
  name: string
  /** 中文：车辆描述 */
  description?: string
  /** 中文：车辆封面 URL */
  coverUrl?: string
  /** 中文：是否启用 */
  isActive: boolean
  /** 中文：是否默认车辆 */
  isDefault: boolean
  /** 中文：关联商品 ID（可选） */
  productId?: Types.ObjectId | null
  /** 中文：车辆最大速度（km/h） */
  maxSpeed?: number
  /** 中文：车辆加速度（m/s^2） */
  acceleration?: number
  /** 中文：刹车减速度（m/s^2） */
  braking?: number
  /** 中文：操控性系数（无单位） */
  handling?: number
  /** 中文：质量（kg） */
  mass?: number
  /** 中文：空气阻力系数（无单位） */
  drag?: number
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface UserVehicleDocument extends Document<Types.ObjectId> {
  /** 中文：用户 ID */
  userId: Types.ObjectId
  /** 中文：车辆 ID */
  vehicleId: Types.ObjectId
  /** 中文：拥有时间 */
  ownedAt: Date
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface SceneProductBindingDocument extends Document<Types.ObjectId> {
  /** 中文：场景 ID */
  sceneId: Types.ObjectId
  /** 中文：商品 ID */
  productId: Types.ObjectId
  /** 中文：是否启用绑定 */
  enabled: boolean
  /** 中文：元数据（可选） */
  metadata?: Record<string, unknown> | null
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface OrderItem {
  /** 中文：商品 ID */
  productId: Types.ObjectId
  /** 中文：订单项类型（用于区分产品/道具/装备等） */
  itemType: 'product' | 'prop' | 'equipment' | 'service' | 'other'
  /** 中文：商品名称（下单时快照） */
  name: string
  /** 中文：商品单价 */
  price: number
  /** 中文：购买数量 */
  quantity: number
}

export interface OrderDocument extends Document<Types.ObjectId> {
  /** 中文：下单用户 ID */
  userId: Types.ObjectId
  /** 中文：订单号（唯一标识） */
  orderNumber: string
  /** 中文：兼容字段，等同 orderStatus */
  status: 'pending' | 'paid' | 'completed' | 'cancelled'
  /** 中文：订单状态（pending/paid/completed/cancelled） */
  orderStatus: 'pending' | 'paid' | 'completed' | 'cancelled'
  /** 中文：支付状态（unpaid/processing/succeeded/failed/refunded/closed） */
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
  /** 中文：退款状态（none/applied/approved/rejected/processing/succeeded/failed） */
  refundStatus: 'none' | 'applied' | 'approved' | 'rejected' | 'processing' | 'succeeded' | 'failed'
  /** 中文：用户退款原因（可选） */
  refundReason?: string
  /** 中文：退款申请时间（可选） */
  refundRequestedAt?: Date
  /** 中文：退款审核时间（可选） */
  refundReviewedAt?: Date
  /** 中文：退款审核管理员 ID（可选） */
  refundReviewedBy?: Types.ObjectId | null
  /** 中文：退款驳回原因（可选） */
  refundRejectReason?: string
  /** 中文：退款金额（可选） */
  refundAmount?: number
  /** 中文：退款请求号（可选） */
  refundRequestNo?: string
  /** 中文：微信退款单号（可选） */
  refundId?: string
  /** 中文：退款完成时间（可选） */
  refundedAt?: Date
  /** 中文：退款结果信息（可选） */
  refundResult?: Record<string, unknown>
  /** 中文：履约状态（pending/fulfilled） */
  fulfillmentStatus?: 'pending' | 'fulfilled'
  /** 中文：履约完成时间（可选） */
  fulfilledAt?: Date
  /** 中文：订单总金额 */
  totalAmount: number
  /** 中文：支付方式（可选） */
  paymentMethod?: string
  /** 中文：支付通道（可选） */
  paymentProvider?: string
  /** 中文：预支付交易单号（可选） */
  prepayId?: string
  /** 中文：支付平台交易单号（可选） */
  transactionId?: string
  /** 中文：支付完成时间（可选） */
  paidAt?: Date
  /** 中文：支付结果信息（可选） */
  paymentResult?: Record<string, unknown>
  /** 中文：收货地址（可选） */
  shippingAddress?: string
  /** 中文：订单项列表 */
  items: OrderItem[]
  /** 中文：额外元数据（可选） */
  metadata?: Record<string, unknown>
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface UserSceneDocument extends Document<Types.ObjectId> {
  /** 中文：用户 ID（字符串形式） */
  userId: string
  /** 中文：场景 ID（字符串） */
  sceneId: string
  /** 中文：项目 ID */
  projectId: string
  /** 中文：场景名称 */
  name: string
  /** 中文：缩略图 URL（可选） */
  thumbnail?: string | null
  /** 中文：场景创建时间 */
  sceneCreatedAt: Date
  /** 中文：场景更新时间 */
  sceneUpdatedAt: Date

  /** 中文：bundle 文件存储 key */
  bundleFileKey: string
  /** 中文：bundle 文件大小（字节） */
  bundleFileSize: number
  /** 中文：bundle 文件类型（MIME，可选） */
  bundleFileType?: string | null
  /** 中文：bundle 原始文件名（可选） */
  bundleOriginalFilename?: string | null
  /** 中文：bundle 的 etag 或哈希 */
  bundleEtag: string
  /** 中文：记录创建时间 */
  createdAt: Date
  /** 中文：记录更新时间 */
  updatedAt: Date
}

export interface UserProjectDocument extends Document<Types.ObjectId> {
  /** 中文：用户 ID（字符串） */
  userId: string
  /** 中文：项目 ID */
  projectId: string
  /** 中文：项目分类 ID（可选） */
  categoryId?: string | null
  /** 中文：项目包含的场景 ID 列表 */
  sceneIds: string[]
  /** 中文：项目文档数据（任意结构） */
  document: Record<string, unknown>
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface UserProjectCategoryDocument extends Document<Types.ObjectId> {
  /** 中文：分类名称 */
  name: string
  /** 中文：分类描述（可选） */
  description?: string | null
  /** 中文：排序值 */
  sortOrder: number
  /** 中文：是否启用 */
  enabled: boolean
  /** 中文：规范化名称 */
  normalizedName: string
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export type AssetType = SchemaAssetType

export interface AssetCategoryDocument extends Document<Types.ObjectId> {
  /** 中文：分类名称 */
  name: string
  /** 中文：分类描述（可选） */
  description?: string
  /** 中文：父分类 ID（可选） */
  parentId?: Types.ObjectId | null
  /** 中文：分类深度（层级） */
  depth: number
  /** 中文：从根到当前的 ID 路径 */
  pathIds: Types.ObjectId[]
  /** 中文：从根到当前的名称路径 */
  pathNames: string[]
  /** 中文：根分类 ID */
  rootId: Types.ObjectId
  /** 中文：规范化名称（用于搜索/匹配） */
  normalizedName: string
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface AssetTagDocument extends Document<Types.ObjectId> {
  /** 中文：标签名称 */
  name: string
  /** 中文：标签描述（可选） */
  description?: string
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface AssetSeriesDocument extends Document<Types.ObjectId> {
  /** 中文：系列名称 */
  name: string
  /** 中文：系列描述（可选） */
  description?: string | null
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface AssetDocument extends Document<Types.ObjectId> {
  /** 中文：资源名称 */
  name: string
  /** 中文：分类 ID */
  categoryId: Types.ObjectId
  /** 中文：资源类型（来自 schema） */
  type: AssetType
  /** 中文：标签 ID 列表 */
  tags: Types.ObjectId[]
  /** 中文：所属系列 ID（可选） */
  seriesId?: Types.ObjectId | null
  /** 中文：文件大小（字节） */
  size: number
  /** 中文：主颜色（可选） */
  color?: string | null
  /** 中文：物体长度（可选，单位约定） */
  dimensionLength?: number | null
  /** 中文：物体宽度（可选） */
  dimensionWidth?: number | null
  /** 中文：物体高度（可选） */
  dimensionHeight?: number | null
  /** 中文：大小分类（可选） */
  sizeCategory?: string | null
  /** 中文：图片宽度（像素，可选） */
  imageWidth?: number | null
  /** 中文：图片高度（像素，可选） */
  imageHeight?: number | null
  /** 中文：文件访问 URL */
  url: string
  /** 中文：文件存储 key */
  fileKey: string
  /** 中文：预览图 URL（可选） */
  previewUrl?: string | null
  /** 中文：缩略图 URL（可选） */
  thumbnailUrl?: string | null
  /** 中文：原始内容哈希（来自 bundle/source 文件） */
  contentHash?: string | null
  /** 中文：原始内容哈希算法 */
  contentHashAlgorithm?: AssetBundleHashAlgorithm | null
  /** 中文：导入时的本地资产 ID（可选） */
  sourceLocalAssetId?: string | null
  /** 中文：bundle 持久化角色 */
  bundleRole?: AssetBundlePersistedRole | null
  /** 中文：所属主资源 ID（依赖资源可选） */
  bundlePrimaryAssetId?: Types.ObjectId | null
  /** 中文：资源描述（可选） */
  description?: string | null
  /** 中文：原始文件名（可选） */
  originalFilename?: string | null
  /** 中文：MIME 类型（可选） */
  mimeType?: string | null
  /** 中文：额外元数据 */
  metadata?: Record<string, unknown>
  /** 中文：地形散布预设（可选） */
  terrainScatterPreset?: TerrainScatterCategory | null
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

/**
 * 场景文档接口
 * 
 * 继承自MongoDB Document，用于定义场景数据模型的结构和字段。
 * 存储场景的基本信息、文件数据以及元数据。
 * 
 * @interface SceneDocument
 * @extends {Document<Types.ObjectId>}
 * 
 * @property {string} name - 场景名称，必填字段
 * @property {string | null} [description] - 场景描述，可选字段，支持null值
 * @property {string} fileKey - 文件存储的唯一标识键，必填字段
 * @property {string} fileUrl - 文件访问的完整URL地址，必填字段
 * @property {number} fileSize - 文件大小（单位：字节），必填字段
 * @property {string | null} [fileType] - 文件的MIME类型，可选字段，支持null值
 * @property {string | null} [originalFilename] - 文件原始名称，可选字段，支持null值
 * @property {Record<string, unknown> | null} [metadata] - 自定义元数据对象，可选字段，支持null值
 * @property {Types.ObjectId | null} publishedBy - 发布者账号ID，可为null表示未发布
 * @property {'User' | 'Admin'} publishedByType - 发布者账号类型，区分用户端与管理端
 * @property {Date} createdAt - 记录创建时间，由MongoDB自动管理
 * @property {Date} updatedAt - 记录最后修改时间，由MongoDB自动管理
 */
export interface SceneDocument extends Document<Types.ObjectId> {
  name: string
  fileKey: string
  fileUrl: string
  fileSize: number
  checkpointTotal: number
  fileType?: string | null
  originalFilename?: string | null
  publishedBy: Types.ObjectId | null
  publishedByType: 'User' | 'Admin'
  createdAt: Date
  updatedAt: Date
}

export interface SceneSpotDocument extends Document<Types.ObjectId> {
  sceneId: Types.ObjectId
  /** 中文：景点分类引用 */
  category?: Types.ObjectId | null
  title: string
  coverImage?: string | null
  slides: string[]
  description: string
  address: string
  phone?: string | null
  location?: { type: 'Point'; coordinates: number[] } | null
  order: number
  isHome: boolean
  isFeatured?: boolean
  isHot?: boolean
  averageRating: number
  ratingCount: number
  favoriteCount: number
  ratingTotalScore: number
  distance?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface HotSpotDocument extends Document<Types.ObjectId> {
  /** 中文：关联的 SceneSpot ID */
  sceneSpotId: Types.ObjectId
  /** 中文：排序字段（较小的值靠前） */
  order: number
  createdAt: Date
  updatedAt: Date
}

export interface FeaturedSpotDocument extends Document<Types.ObjectId> {
  /** 中文：关联的 SceneSpot ID */
  sceneSpotId: Types.ObjectId
  /** 中文：排序字段（较小的值靠前） */
  order: number
  createdAt: Date
  updatedAt: Date
}

export interface SceneSpotCategoryDocument extends Document<Types.ObjectId> {
  /** 中文：分类名称 */
  name: string
  /** 中文：分类描述（可选） */
  description?: string | null
  /** 中文：用于路由或接口的短标识（可选） */
  slug?: string | null
  /** 中文：排序值 */
  sortOrder: number
  /** 中文：是否启用 */
  enabled: boolean
  /** 中文：规范化名称 */
  normalizedName?: string | null
  /** 中文：是否内置 */
  isBuiltin: boolean
  /** 中文：创建时间 */
  createdAt: Date
  /** 中文：更新时间 */
  updatedAt: Date
}

export interface SceneSpotInteractionDocument extends Document<Types.ObjectId> {
  sceneSpotId: Types.ObjectId
  userId: Types.ObjectId
  favorited: boolean
  rating?: number | null
  createdAt: Date
  updatedAt: Date
}

export type SceneSpotCommentStatus = 'pending' | 'approved' | 'rejected'

export interface SceneSpotCommentDocument extends Document<Types.ObjectId> {
  sceneSpotId: Types.ObjectId
  userId: Types.ObjectId
  content: string
  status: SceneSpotCommentStatus
  rejectReason?: string | null
  reviewedAt?: Date | null
  reviewedBy?: Types.ObjectId | null
  editedAt?: Date | null
  editedBy?: Types.ObjectId | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface MiniEventDocument extends Document<Types.ObjectId> {
  title: string
  description?: string | null
  coverUrl?: string | null
  locationText?: string | null
  startAt?: Date | null
  endAt?: Date | null
  sceneId?: Types.ObjectId | null
  hotScore: number
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface MiniAchievementDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  title: string
  description: string
  progress: number
  scenicId?: Types.ObjectId | null
  achievedAt?: Date | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface AchievementDocument extends Document<Types.ObjectId> {
  /** 中文：成就名称 */
  name: string
  /** 中文：成就描述（可选） */
  description?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export type MedalRuleType =
  | 'enter_scenic'
  | 'punch_ratio_gte'
  | 'enter_count_gte'
  | 'punch_count_gte'
  | 'specific_scenic_set_complete'

export type MedalRuleScope = 'any_scenic' | 'specific_scenic'

export type MedalRuleCompleteType = 'enter_scenic' | 'punch_ratio_gte'

export interface MedalRule {
  type: MedalRuleType
  params?: Record<string, unknown> | null
  order?: number
}

export interface MedalDocument extends Document<Types.ObjectId> {
  name: string
  description?: string | null
  lockedIconUrl?: string | null
  unlockedIconUrl?: string | null
  enabled: boolean
  sort: number
  rules: MedalRule[]
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface UserMedalDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  medalId: Types.ObjectId
  awardedAt: Date
  triggerSource?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface RuleDocument extends Document<Types.ObjectId> {
  /** 中文：规则名称 */
  name: string
  /** 中文：适用景区的 Scene ID（为空表示任意景区） */
  scenicId?: Types.ObjectId | null
  /** 中文：进入景区条件，若为 true 则规则为“进入景区” */
  enterScenic?: boolean
  /** 中文：浏览百分比条件，0-100，默认 0 */
  viewPercentage?: number
  enabled: boolean
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface AchievementRuleDocument extends Document<Types.ObjectId> {
  achievementId: Types.ObjectId
  ruleId: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export interface MiniAddressDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  receiverName: string
  phone: string
  region: string
  detail: string
  isDefault: boolean
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export type MiniFeedbackCategory = 'bug' | 'ui' | 'feature' | 'content' | 'other'

export type MiniFeedbackStatus = 'new' | 'in_progress' | 'resolved' | 'closed'

export interface MiniFeedbackDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  category: MiniFeedbackCategory
  content: string
  contact?: string | null
  status: MiniFeedbackStatus
  reply?: string | null
  repliedAt?: Date | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface CouponDocument extends Document<Types.ObjectId> {
  typeId: Types.ObjectId
  title: string
  description: string
  validUntil: Date
  usageRules?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface CouponTypeDocument extends Document<Types.ObjectId> {
  name: string
  code: string
  iconUrl?: string
  sort: number
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type UserCouponStatus = 'unused' | 'used' | 'expired'

export interface UserCouponDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  couponId: Types.ObjectId
  status: UserCouponStatus
  claimedAt: Date
  usedAt?: Date | null
  expiresAt?: Date | null
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}
