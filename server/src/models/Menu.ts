import { Schema, model } from 'mongoose'
import type { MenuDocument } from '@/types/models'

const menuSchema = new Schema<MenuDocument>(
  {
    name: { type: String, required: true, trim: true },
    icon: { type: String },
    routeName: { type: String },
    order: { type: Number, default: 0 },
    permission: { type: String },
    parentId: { type: Schema.Types.ObjectId, ref: 'Menu', default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

menuSchema.index({ routeName: 1 })
menuSchema.index({ parentId: 1, order: 1 })

export const MenuModel = model<MenuDocument>('Menu', menuSchema)
