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

export interface BusinessOrderProductionNode {
  activatedAt: null | string;
  code: string;
  label: string;
  remark: null | string;
  sortOrder: number;
  status: 'pending' | 'active' | 'completed';
}

export interface BusinessOrderItem {
  addressText: string;
  contactPhone: string;
  contactPhoneForBusiness: null | string;
  createdAt: string;
  id: string;
  notes: null | string;
  operatingAt: null | string;
  orderNumber: string;
  productionCompletedAt: null | string;
  productionProgress: BusinessOrderProductionNode[];
  productionStartedAt: null | string;
  publishReadyAt: null | string;
  publishedAt: null | string;
  quotedAt: null | string;
  sceneSpotCategoryId: null | string;
  sceneSpotCategoryName: null | string;
  scenicArea: null | number;
  scenicName: string;
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

export interface ListBusinessOrdersParams {
  contractStatus?: '' | 'signed' | 'unsigned';
  keyword?: string;
  page?: number;
  pageSize?: number;
  topStage?: '' | BusinessOrderTopStage;
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

export async function updateBusinessOrderApi(id: string, payload: { contactPhoneForBusiness?: string; notes?: string }) {
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