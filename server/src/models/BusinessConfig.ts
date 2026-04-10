import { Schema, model } from 'mongoose'

export interface BusinessConfigDocument {
  contactPhone: string
  createdAt: Date
  updatedAt: Date
}

const businessConfigSchema = new Schema<BusinessConfigDocument>(
  {
    contactPhone: { type: String, required: true, trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

export const BusinessConfigModel = model<BusinessConfigDocument>('BusinessConfig', businessConfigSchema, 'business_config')