import { requestClient } from '#/api/request';

interface ServerPageResult<T> { data: T[]; page: number; pageSize: number; total: number }

export type ControllableType = 'vehicle' | 'character' | 'ship' | 'aircraft';

export interface ControllableAssetItem {
  id: string;
  identifier: string;
  name: string;
  type: ControllableType;
  sortOrder: number;
  description: string;
  prefabUrl?: string;
  isActive: boolean;
  isDefault: boolean;
  productId: string | null;
  product?: { id: string; name: string; slug?: string; categoryId: string | null; price: number };
  runtimeConfig?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ListControllableAssetsParams {
  keyword?: string;
  type?: ControllableType;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ControllableAssetPayload {
  identifier: string;
  name: string;
  type: ControllableType;
  sortOrder?: number;
  description?: string;
  prefabUrl?: string;
  isActive?: boolean;
  isDefault?: boolean;
  categoryId?: string;
  runtimeConfig?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

function normalize(result: ServerPageResult<ControllableAssetItem>) {
  return { items: result.data || [], total: result.total || 0 };
}

export async function listControllableAssetsApi(params: ListControllableAssetsParams) {
  return normalize(await requestClient.get<ServerPageResult<ControllableAssetItem>>('/admin/controllable-assets', { params }));
}
export async function getControllableAssetApi(id: string) {
  return requestClient.get<ControllableAssetItem>(`/admin/controllable-assets/${id}`);
}
export async function createControllableAssetApi(payload: ControllableAssetPayload) {
  return requestClient.post<ControllableAssetItem>('/admin/controllable-assets', payload);
}
export async function updateControllableAssetApi(id: string, payload: Partial<ControllableAssetPayload>) {
  return requestClient.put<ControllableAssetItem>(`/admin/controllable-assets/${id}`, payload);
}
export async function deleteControllableAssetApi(id: string) {
  return requestClient.delete(`/admin/controllable-assets/${id}`);
}
