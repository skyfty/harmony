import { appConfig } from '@/config/env'
import { BusinessConfigModel } from '@/models/BusinessConfig'

export interface BusinessConfigView {
  contactPhone: string
  updatedAt: Date | null
}

function normalizePhone(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveFallbackPhone(): string {
  return normalizePhone(appConfig.business.contactPhone) || '400-000-0000'
}

export async function getBusinessConfig(): Promise<BusinessConfigView> {
  const config = await BusinessConfigModel.findOne().sort({ updatedAt: -1 }).lean().exec()
  const storedPhone = normalizePhone(config?.contactPhone)
  return {
    contactPhone: storedPhone || resolveFallbackPhone(),
    updatedAt: config?.updatedAt ?? null,
  }
}

export async function getBusinessContactPhone(): Promise<string> {
  return (await getBusinessConfig()).contactPhone
}

export async function updateBusinessConfig(contactPhone: string): Promise<BusinessConfigView> {
  const normalizedPhone = normalizePhone(contactPhone)
  if (!normalizedPhone) {
    throw new Error('contactPhone is required')
  }

  const existing = await BusinessConfigModel.findOne().exec()
  const saved = existing
    ? await BusinessConfigModel.findByIdAndUpdate(
        existing._id,
        { contactPhone: normalizedPhone },
        { new: true, runValidators: true },
      ).lean().exec()
    : await BusinessConfigModel.create({ contactPhone: normalizedPhone }).then((document) => document.toObject())

  return {
    contactPhone: normalizePhone(saved?.contactPhone) || normalizedPhone,
    updatedAt: saved?.updatedAt ?? null,
  }
}