import { requestClient } from '#/api/request';

interface ServerPageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

interface GridPageResult<T> {
  items: T[];
  total: number;
}

export type CouponStatus = 'unused' | 'used' | 'expired';

export interface CouponItem {
  id: string;
  name: string;
  title: string;
  description: string;
  validUntil: string;
  useConditions?: Record<string, unknown> | null;
  usageRules?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserCouponItem {
  id: string;
  userId: string;
  user: {
    id: string;
    username?: string | null;
    displayName?: string | null;
  } | null;
  couponId: string;
  coupon: {
    id: string;
    title: string;
    description: string;
    validUntil?: string | null;
  } | null;
  status: CouponStatus;
  claimedAt?: string | null;
  usedAt?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CouponStats {
  overview: {
    total: number;
    unused: number;
    used: number;
    expired: number;
  };
  byCoupon: Array<{
    couponId: string;
    title: string;
    total: number;
    unused: number;
    used: number;
    expired: number;
  }>;
}

export interface ListCouponsParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface CouponPayload {
  name?: string;
  title?: string;
  description: string;
  validUntil: string;
  usageRules?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListUserCouponsParams {
  keyword?: string;
  status?: CouponStatus;
  couponId?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}

export interface DistributeSinglePayload {
  userId: string;
  expiresAt?: string;
  metadata?: Record<string, unknown> | null;
}

export interface DistributeBatchPayload {
  userIds: string[];
  expiresAt?: string;
  metadata?: Record<string, unknown> | null;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listCouponsApi(params: ListCouponsParams) {
  const response = await requestClient.get<ServerPageResult<CouponItem>>('/admin/coupons', { params });
  return normalizeGridPage(response);
}

export async function getCouponApi(id: string) {
  return requestClient.get<CouponItem>(`/admin/coupons/${id}`);
}

export async function createCouponApi(payload: CouponPayload) {
  return requestClient.post<CouponItem>('/admin/coupons', payload);
}

export async function updateCouponApi(id: string, payload: Partial<CouponPayload>) {
  return requestClient.put<CouponItem>(`/admin/coupons/${id}`, payload);
}

export async function deleteCouponApi(id: string) {
  return requestClient.delete(`/admin/coupons/${id}`);
}

export async function listUserCouponsApi(params: ListUserCouponsParams) {
  const response = await requestClient.get<ServerPageResult<UserCouponItem>>('/admin/coupons/user-coupons', { params });
  return normalizeGridPage(response);
}

export async function distributeCouponApi(couponId: string, payload: DistributeSinglePayload) {
  return requestClient.post(`/admin/coupons/${couponId}/distribute`, payload);
}

export async function distributeCouponBatchApi(couponId: string, payload: DistributeBatchPayload) {
  return requestClient.post(`/admin/coupons/${couponId}/distribute/batch`, payload);
}

export async function useUserCouponByAdminApi(userCouponId: string) {
  return requestClient.post<UserCouponItem>(`/admin/coupons/user-coupons/${userCouponId}/use`);
}

export async function getCouponStatsApi(params?: { keyword?: string; couponId?: string }) {
  return requestClient.get<CouponStats>('/admin/coupons/stats', { params });
}
