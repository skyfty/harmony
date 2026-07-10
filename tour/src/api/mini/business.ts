import type {
  BusinessBootstrapData,
  BusinessOrder,
  BusinessOrderAnalytics,
  BusinessOrderRenewalPreview,
  BusinessRenewalPaymentResult,
  BusinessRenewalHistoryItem,
  CreateBusinessOrderPayload,
} from '@/types/business'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

export async function getBusinessBootstrap(): Promise<BusinessBootstrapData> {
  await ensureMiniAuth()
  return await miniRequest<BusinessBootstrapData>('/business-orders/bootstrap', {
    method: 'GET',
  })
}

export async function listBusinessOrders(): Promise<BusinessOrder[]> {
  await ensureMiniAuth()
  return await miniRequest<BusinessOrder[]>('/business-orders', {
    method: 'GET',
  })
}

export async function getBusinessOrderDetail(id: string): Promise<BusinessOrder> {
  await ensureMiniAuth()
  return await miniRequest<BusinessOrder>(`/business-orders/${encodeURIComponent(id)}`, {
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

export async function getBusinessOrderRenewalPreview(id: string): Promise<BusinessOrderRenewalPreview> {
  await ensureMiniAuth()
  return await miniRequest<BusinessOrderRenewalPreview>(`/business-orders/${encodeURIComponent(id)}/renewal-preview`, {
    method: 'GET',
  })
}

export async function createBusinessOrderRenewal(id: string): Promise<BusinessRenewalHistoryItem> {
  await ensureMiniAuth()
  return await miniRequest<BusinessRenewalHistoryItem>(`/business-orders/${encodeURIComponent(id)}/renew`, {
    method: 'POST',
  })
}

export async function payBusinessOrderRenewal(id: string): Promise<BusinessRenewalPaymentResult> {
  await ensureMiniAuth()
  return await miniRequest<BusinessRenewalPaymentResult>(`/business-orders/${encodeURIComponent(id)}/renew/pay`, {
    method: 'POST',
  })
}

export async function getBusinessOrderAnalytics(id: string): Promise<BusinessOrderAnalytics> {
  await ensureMiniAuth()
  return await miniRequest<BusinessOrderAnalytics>(`/business-orders/${encodeURIComponent(id)}/analytics`, {
    method: 'GET',
  })
}
