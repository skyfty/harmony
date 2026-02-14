import type { AssetType as SchemaAssetType } from '@harmony/schema'
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
  /** 中文：商品分类 */
  category: string
  /** 中文：商品价格（单位：分或元按约定） */
  price: number
  /** 中文：商品图片 URL（可选） */
  imageUrl?: string
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
  /** 中文：商品分类 */
  category: string
  /** 中文：商品价格 */
  price: number
  /** 中文：图片 URL（可选） */
  imageUrl?: string
  /** 中文：封面 URL（可选） */
  coverUrl?: string | null
  /** 中文：摘要（可选） */
  summary?: string | null
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
  /** 中文：订单状态（pending/paid/completed/cancelled） */
  status: 'pending' | 'paid' | 'completed' | 'cancelled'
  /** 中文：订单总金额 */
  totalAmount: number
  /** 中文：支付方式（可选） */
  paymentMethod?: string
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
 * @property {Types.ObjectId | null} publishedBy - 发布者的用户ID，可为null表示未发布
 * @property {Date} createdAt - 记录创建时间，由MongoDB自动管理
 * @property {Date} updatedAt - 记录最后修改时间，由MongoDB自动管理
 */
export interface SceneDocument extends Document<Types.ObjectId> {
  name: string
  fileKey: string
  fileUrl: string
  fileSize: number
  fileType?: string | null
  originalFilename?: string | null
  publishedBy: Types.ObjectId | null
  createdAt: Date
  updatedAt: Date
}

export interface SceneSpotDocument extends Document<Types.ObjectId> {
  sceneId: Types.ObjectId
  title: string
  coverImage?: string | null
  slides: string[]
  description: string
  address: string
  order: number
  isFeatured: boolean
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

export interface CouponDocument extends Document<Types.ObjectId> {
  title: string
  description: string
  validUntil: Date
  usageRules?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
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
