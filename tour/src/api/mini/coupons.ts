import type { Coupon } from '@/types/coupon'
import { HttpError } from '@/api/http'
import { miniRequest } from './client'
import { ensureDevLogin } from './session'

type CouponsResponse = {
  total: number
  coupons: Coupon[]
}

export async function listMyCoupons(): Promise<Coupon[]> {
  await ensureDevLogin()

  try {
    const res = await miniRequest<CouponsResponse>('/coupons', { method: 'GET' })
    return Array.isArray(res.coupons) ? res.coupons : []
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      return []
    }
    throw err
  }
}
