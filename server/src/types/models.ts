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
  status: 'active' | 'disabled'
  roles: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

export interface AssetCategoryDocument extends Document<Types.ObjectId> {
  name: string
  type: 'model' | 'image' | 'texture' | 'file'
  description?: string
  createdAt: Date
  updatedAt: Date
}

export interface AssetDocument extends Document<Types.ObjectId> {
  name: string
  categoryId: Types.ObjectId
  type: 'model' | 'image' | 'texture' | 'file'
  size: number
  url: string
  previewUrl?: string | null
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}
