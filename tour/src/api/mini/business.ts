import type { BusinessBootstrapData, BusinessOrder, CreateBusinessOrderPayload } from '@/types/business'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

export async function getBusinessBootstrap(): Promise<BusinessBootstrapData> {
  await ensureMiniAuth()
  return await miniRequest<BusinessBootstrapData>('/business-orders/bootstrap', {
    method: 'GET',
  })
}

export async function createBusinessOrder(payload: CreateBusinessOrderPayload): Promise<BusinessOrder> {
  await ensureMiniAuth()
  return await miniRequest<BusinessOrder>('/business-orders', {
    method: 'POST',
    body: payload,
  })
}

export async function getCurrentBusinessOrder(): Promise<BusinessOrder | null> {
  await ensureMiniAuth()
  const response = await miniRequest<{ order: BusinessOrder | null }>('/business-orders/current', {
    method: 'GET',
  })
  return response.order ?? null
}