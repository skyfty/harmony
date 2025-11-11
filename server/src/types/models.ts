import type { Document, Types } from 'mongoose'

export interface PermissionDocument extends Document<Types.ObjectId> {
  name: string
  code: string
  description?: string
  group?: string
  createdAt: Date
  updatedAt: Date
}

export interface RoleDocument extends Document<Types.ObjectId> {
  name: string
  code: string
  description?: string
  permissions: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

export interface UserDocument extends Document<Types.ObjectId> {
  username: string
  password: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  bio?: string
  status: 'active' | 'disabled'
  roles: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

export interface RatingEntry {
  userId: Types.ObjectId
  score: number
  comment?: string
  createdAt: Date
  updatedAt: Date
}

export interface VisitEntry {
  userId: Types.ObjectId
  visitedAt: Date
}

export interface WorkDocument extends Document<Types.ObjectId> {
  ownerId: Types.ObjectId
  title: string
  description?: string
  mediaType: 'image' | 'video' | 'model' | 'other'
  fileUrl: string
  thumbnailUrl?: string
  size?: number
  tags: string[]
  likedBy: Types.ObjectId[]
  ratings: RatingEntry[]
  collections: Types.ObjectId[]
  commentCount: number
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface WorkRecordDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  workId: Types.ObjectId
  fileName: string
  fileUrl: string
  mediaType: 'image' | 'video' | 'model' | 'other'
  fileSize?: number
  createdAt: Date
}

export interface WorkCollectionDocument extends Document<Types.ObjectId> {
  ownerId: Types.ObjectId
  title: string
  description?: string
  coverUrl?: string
  workIds: Types.ObjectId[]
  isPublic: boolean
  likes: Types.ObjectId[]
  ratings: RatingEntry[]
  createdAt: Date
  updatedAt: Date
}

export interface ExhibitionDocument extends Document<Types.ObjectId> {
  ownerId: Types.ObjectId
  name: string
  description?: string
  coverUrl?: string
  coverUrls: string[]
  startDate?: Date
  endDate?: Date
  workIds: Types.ObjectId[]
  collectionIds: Types.ObjectId[]
  status: 'draft' | 'published' | 'withdrawn'
  likes: Types.ObjectId[]
  ratings: RatingEntry[]
  visits: VisitEntry[]
  shareCount: number
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface OptimizeProductPurchaseEntry {
  userId: Types.ObjectId
  orderId?: Types.ObjectId
  purchasedAt: Date
}

export interface OptimizeProductUsageConfig {
  type: 'permanent' | 'consumable'
  perExhibitionLimit?: number | null
  exclusiveGroup?: string | null
  stackable?: boolean
  notes?: string
}

export interface OptimizeProductDocument extends Document<Types.ObjectId> {
  name: string
  slug: string
  category: string
  price: number
  imageUrl?: string
  description?: string
  tags: string[]
  usageConfig?: OptimizeProductUsageConfig
  purchasedBy: OptimizeProductPurchaseEntry[]
  createdAt: Date
  updatedAt: Date
}

export interface OptimizeWarehouseSnapshot {
  name: string
  category: string
  price: number
  imageUrl?: string
  description?: string
  usageConfig?: OptimizeProductUsageConfig
}

export interface OptimizeWarehouseDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  productId: Types.ObjectId
  quantity: number
  totalPurchased: number
  totalConsumed: number
  productSnapshot: OptimizeWarehouseSnapshot
  latestOrderId?: Types.ObjectId | null
  lastPurchasedAt?: Date | null
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface OrderItem {
  productId: Types.ObjectId
  name: string
  price: number
  quantity: number
}

export interface OrderDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId
  orderNumber: string
  status: 'pending' | 'paid' | 'completed' | 'cancelled'
  totalAmount: number
  paymentMethod?: string
  shippingAddress?: string
  items: OrderItem[]
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface AssetCategoryDocument extends Document<Types.ObjectId> {
  name: string
  type: 'model' | 'image' | 'texture' | 'material' | 'file'
  description?: string
  createdAt: Date
  updatedAt: Date
}

export interface AssetTagDocument extends Document<Types.ObjectId> {
  name: string
  description?: string
  createdAt: Date
  updatedAt: Date
}

export interface AssetDocument extends Document<Types.ObjectId> {
  name: string
  categoryId: Types.ObjectId
  type: 'model' | 'image' | 'texture' | 'material' | 'file'
  tags: Types.ObjectId[]
  size: number
  url: string
  fileKey: string
  previewUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  originalFilename?: string | null
  mimeType?: string | null
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}
