import type { Address } from '@/types/address'
import { miniRequest } from './client'
import { ensureMiniAuth } from './session'

type ListAddressesResponse = {
  total: number
  addresses: Address[]
}

type UpsertAddressPayload = {
  id?: string
  receiverName: string
  phone: string
  region: string
  detail: string
  isDefault: boolean
}

export async function listAddresses(): Promise<Address[]> {
  await ensureMiniAuth()
  const response = await miniRequest<ListAddressesResponse>('/addresses', {
    method: 'GET',
  })
  return Array.isArray(response.addresses) ? response.addresses : []
}

export async function getAddressById(id: string): Promise<Address | null> {
  if (!id) {
    return null
  }
  await ensureMiniAuth()
  return await miniRequest<Address>(`/addresses/${encodeURIComponent(id)}`, {
    method: 'GET',
  })
}

export async function upsertAddress(payload: UpsertAddressPayload): Promise<Address> {
  await ensureMiniAuth()
  const requestBody = {
    receiverName: payload.receiverName,
    phone: payload.phone,
    region: payload.region,
    detail: payload.detail,
    isDefault: payload.isDefault,
  }

  if (payload.id) {
    return await miniRequest<Address>(`/addresses/${encodeURIComponent(payload.id)}`, {
      method: 'PATCH',
      body: requestBody,
    })
  }

  return await miniRequest<Address>('/addresses', {
    method: 'POST',
    body: requestBody,
  })
}

export async function removeAddress(id: string): Promise<boolean> {
  if (!id) return false
  await ensureMiniAuth()
  const response = await miniRequest<{ success?: boolean }>(`/addresses/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  return Boolean(response.success)
}
