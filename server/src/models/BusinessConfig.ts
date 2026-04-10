import mongoose, { Schema, Document } from 'mongoose';

export interface IBusinessConfig extends Document {
  contactPhone: string;
  updatedAt: Date;
}

const BusinessConfigSchema: Schema = new Schema<IBusinessConfig>({
  contactPhone: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IBusinessConfig>('BusinessConfig', BusinessConfigSchema, 'business_config');
