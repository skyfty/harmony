import type { Coupon } from '@/types/coupon'
import { HttpError } from '@/api/http'
import { miniRequest } from './client'
import { ensureDevLogin } from './session'

type CouponsResponse = {
  total: number
  coupons: Coupon[]
}

type CouponListParams = {
  status?: 'unused' | 'used' | 'expired'
  keyword?: string
}

function buildQuery(params?: CouponListParams): string {
  if (!params) {
    return ''
  }
  const query = new URLSearchParams()
  if (params.status) {
    query.set('status', params.status)
  }
  if (params.keyword?.trim()) {
    query.set('keyword', params.keyword.trim())
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

export async function listMyCoupons(params?: CouponListParams): Promise<Coupon[]> {
  await ensureDevLogin()

  try {
    const res = await miniRequest<CouponsResponse>(`/coupons${buildQuery(params)}`, { method: 'GET' })
    return Array.isArray(res.coupons) ? res.coupons : []
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      return []
    }
    throw err
  }
}

export async function getMyCouponDetail(id: string): Promise<Coupon> {
  await ensureDevLogin()
  return miniRequest<Coupon>(`/coupons/${encodeURIComponent(id)}`, { method: 'GET' })
}

export async function useMyCoupon(id: string): Promise<Coupon> {
  await ensureDevLogin()
  return miniRequest<Coupon>(`/coupons/${encodeURIComponent(id)}/use`, { method: 'POST' })
}
