import type { Coupon } from '@/types/coupon'
import { MiniApiError, buildQueryString, miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

type CouponsResponse = {
  total: number
  coupons: Coupon[]
}

type CouponListParams = {
  status?: 'unused' | 'used' | 'expired'
  keyword?: string
}

type CouponSceneItem = {
  id: string
  title: string
  description: string
  validUntil: string
  type?: {
    id: string
    name: string
    code: string
    iconUrl?: string | null
  } | null
  status: 'available' | 'unused' | 'used' | 'expired'
  claimedAt?: string | null
  usedAt?: string | null
  expiresAt?: string | null
  userCouponId?: string | null
  owned?: boolean
}

type GrantCouponResponse = {
  claimed: boolean
  couponId: string
  userCouponId: string
  status: 'available' | 'unused' | 'used' | 'expired'
}

function buildQuery(params?: CouponListParams): string {
  if (!params) {
    return ''
  }
  return buildQueryString({
    status: params.status,
    keyword: params.keyword?.trim(),
  })
}

export async function listMyCoupons(params?: CouponListParams): Promise<Coupon[]> {
  await ensureMiniAuth()

  try {
    const res = await miniRequest<CouponsResponse>(`/coupons${buildQuery(params)}`, { method: 'GET' })
    return Array.isArray(res.coupons) ? res.coupons : []
  } catch (err) {
    if (err instanceof MiniApiError && err.kind === 'auth') {
      return []
    }
    throw err
  }
}

export async function listCouponCatalog(params?: { couponIds?: string[] }): Promise<CouponSceneItem[]> {
  await ensureMiniAuth()
  try {
    const res = await miniRequest<{ total: number; coupons: CouponSceneItem[] }>('/coupons/catalog', {
      method: 'GET',
      query: params?.couponIds?.length ? { couponIds: params.couponIds.join(',') } : undefined,
    })
    return Array.isArray(res.coupons) ? res.coupons : []
  } catch (err) {
    if (err instanceof MiniApiError && err.kind === 'auth') {
      return []
    }
    throw err
  }
}

export async function getMyCouponDetail(id: string): Promise<Coupon> {
  await ensureMiniAuth()
  return miniRequest<Coupon>(`/coupons/${encodeURIComponent(id)}`, { method: 'GET' })
}

export async function useMyCoupon(id: string): Promise<Coupon> {
  await ensureMiniAuth()
  return miniRequest<Coupon>(`/coupons/${encodeURIComponent(id)}/use`, { method: 'POST' })
}

export async function grantCouponById(
  id: string,
  payload?: {
    sceneId?: string
    sceneName?: string
    nodeId?: string
    couponJson?: string
    triggeredAt?: string
    source?: string
    metadata?: Record<string, unknown>
  },
): Promise<GrantCouponResponse> {
  await ensureMiniAuth()
  return miniRequest<GrantCouponResponse>(`/coupons/${encodeURIComponent(id)}/grant`, {
    method: 'POST',
    body: payload ?? {},
  })
}
