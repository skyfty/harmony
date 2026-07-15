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

export type BusinessOrderTopStage = 'quote' | 'signing' | 'production' | 'publish' | 'operation';
export type BusinessOrderKind = 'new' | 'renewal';
export type BusinessOrderServiceStatus = 'pending' | 'active' | 'expiring' | 'expired';

export interface BusinessOrderProductionNode {
  activatedAt: null | string;
  code: string;
  label: string;
  remark: null | string;
  sortOrder: number;
  status: 'pending' | 'active' | 'completed';
}

export interface BusinessOrderRenewalHistoryItem {
  approvedAt: null | string;
  createdAt: string;
  durationDays: number;
  id: string;
  orderKind: BusinessOrderKind;
  orderNumber: string;
  price: number;
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed';
  serviceEndAt: null | string;
  serviceStartAt: null | string;
  serviceStatus: BusinessOrderServiceStatus;
}

export interface BusinessOrderItem {
  addressText: string;
  analyticsAvailable: boolean;
  contactPhone: string;
  contactPhoneForBusiness: null | string;
  createdAt: string;
  delivery: {
    boundAt: null | string;
    sceneId: null | string;
    sceneSpotId: null | string;
    sceneSpotTitle: null | string;
  };
  id: string;
  lastRenewedAt: null | string;
  notes: null | string;
  operatingAt: null | string;
  orderKind: BusinessOrderKind;
  orderNumber: string;
  parentOrderId: null | string;
  productionCompletedAt: null | string;
  productionProgress: BusinessOrderProductionNode[];
  productionStartedAt: null | string;
  publishReadyAt: null | string;
  publishedAt: null | string;
  quotedAt: null | string;
  renewalCount: number;
  renewalHistory: BusinessOrderRenewalHistoryItem[];
  rootOrderId: string;
  sceneSpotCategoryId: null | string;
  sceneSpotCategoryName: null | string;
  scenicArea: null | number;
  scenicName: string;
  service: {
    daysRemaining: null | number;
    durationDays: number;
    endAt: null | string;
    price: number;
    startAt: null | string;
    status: BusinessOrderServiceStatus;
    warningDays: number;
  };
  share: {
    miniProgramPath: null | string;
    urlScheme: null | string;
    wechatRuleLink: null | string;
  };
  signedAt: null | string;
  specialLandscapeTags: string[];
  topStage: BusinessOrderTopStage;
  updatedAt: string;
  userId: string;
  userInfo: null | {
    contractStatus: 'unsigned' | 'signed';
    displayName: null | string;
    id: string;
    phone: null | string;
    username: null | string;
  };
}

export interface BusinessOrderAnalyticsItem {
  charts: {
    breakdown: {
      categories: string[];
      dimension?: 'category' | 'checkpoint';
      granularity?: 'day' | 'month';
      metric?: 'pv' | 'uv' | 'newUsers' | 'punchCount';
      series: Array<{
        data: number[];
        name: string;
      }>;
      total: number;
    };
    trend: {
      categories: string[];
      dimension?: 'category' | 'checkpoint';
      granularity?: 'day' | 'month';
      metric?: 'pv' | 'uv' | 'newUsers' | 'punchCount';
      series: Array<{
        data: number[];
        name: string;
      }>;
      total: number;
    };
  };
  checkpointStats: Array<{
    nodeId: string;
    nodeName: string;
    punchCount: number;
    userCount: number;
  }>;
  overview: {
    todayNewUsers: number;
    todayUv: number;
    totalPunchCount: number;
    totalUv: number;
  };
  query: {
    end: string;
    sceneId: string;
    sceneSpotId: null | string;
    start: string;
  };
  visitTrend: Array<{
    date: string;
    newUsers: number;
    pv: number;
    uv: number;
  }>;
}

export interface BusinessOrderAnalyticsQueryParams {
  dimension?: 'category' | 'checkpoint';
  end?: string;
  granularity?: 'day' | 'month';
  limit?: number;
  metric?: 'pv' | 'uv' | 'newUsers' | 'punchCount';
  start?: string;
}

export interface BusinessConfigItem {
  contactPhone: string;
  updatedAt: null | string;
}

export interface ListBusinessOrdersParams {
  contractStatus?: '' | 'signed' | 'unsigned';
  keyword?: string;
  page?: number;
  pageSize?: number;
  serviceStatus?: '' | BusinessOrderServiceStatus;
  topStage?: '' | BusinessOrderTopStage;
  userId?: string;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listBusinessOrdersApi(params: ListBusinessOrdersParams) {
  const response = await requestClient.get<ServerPageResult<BusinessOrderItem>>('/admin/business-orders', {
    params,
  });
  return normalizeGridPage(response);
}

export async function getBusinessOrderApi(id: string) {
  return requestClient.get<BusinessOrderItem>(`/admin/business-orders/${id}`);
}

export async function getBusinessOrderAnalyticsApi(id: string, params?: BusinessOrderAnalyticsQueryParams) {
  return requestClient.get<BusinessOrderAnalyticsItem>(`/admin/business-orders/${id}/analytics`, {
    params,
  });
}

export async function listBusinessOrderRenewalsApi(id: string) {
  return requestClient.get<BusinessOrderRenewalHistoryItem[]>(`/admin/business-orders/${id}/renewals`);
}

export async function getBusinessConfigApi() {
  return requestClient.get<BusinessConfigItem>('/admin/business-config');
}

export async function updateBusinessConfigApi(payload: { contactPhone: string }) {
  return requestClient.put<BusinessConfigItem>('/admin/business-config', payload);
}

export async function updateBusinessOrderApi(id: string, payload: {
  contactPhoneForBusiness?: string;
  notes?: string;
  sceneSpotId?: string | null;
  renewalWarningDays?: number;
  serviceDurationDays?: number;
  serviceEndAt?: string | null;
  servicePrice?: number;
  serviceStartAt?: string | null;
}) {
  return requestClient.put<BusinessOrderItem>(`/admin/business-orders/${id}`, payload);
}

export async function signBusinessOrderApi(id: string) {
  return requestClient.post<BusinessOrderItem>(`/admin/business-orders/${id}/sign`, {});
}

export async function advanceBusinessOrderProductionApi(id: string, remark?: string) {
  return requestClient.post<BusinessOrderItem>(`/admin/business-orders/${id}/production/advance`, { remark });
}

export async function completeBusinessOrderProductionApi(id: string) {
  return requestClient.post<BusinessOrderItem>(`/admin/business-orders/${id}/production/complete`, {});
}

export async function completeBusinessOrderPublishApi(id: string) {
  return requestClient.post<BusinessOrderItem>(`/admin/business-orders/${id}/publish/complete`, {});
}

export async function completeBusinessOrderOperationApi(id: string) {
  return requestClient.post<BusinessOrderItem>(`/admin/business-orders/${id}/operation/complete`, {});
}

export async function approveBusinessOrderRenewalApi(id: string) {
  return requestClient.post<BusinessOrderItem>(`/admin/business-orders/${id}/renewal/approve`, {});
}
