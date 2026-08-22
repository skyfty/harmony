import { requestClient } from '#/api/request';

interface ServerPageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type ControllableType = 'aircraft' | 'character' | 'ship' | 'vehicle';

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
  productId: null | string;
  product?: {
    categoryId: null | string;
    id: string;
    name: string;
    price: number;
    slug?: string;
  };
  runtimeConfig?: null | Record<string, unknown>;
  metadata?: null | Record<string, unknown>;
  createdAt: null | string;
  updatedAt: null | string;
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
  runtimeConfig?: null | Record<string, unknown>;
  metadata?: null | Record<string, unknown>;
}

function normalize<T>(result: ServerPageResult<T>) {
  return { items: result.data || [], total: result.total || 0 };
}

export async function listControllableAssetsApi(
  params: ListControllableAssetsParams,
) {
  return normalize(
    await requestClient.get<ServerPageResult<ControllableAssetItem>>(
      '/admin/controllable-assets',
      { params },
    ),
  );
}
export async function getControllableAssetApi(id: string) {
  return requestClient.get<ControllableAssetItem>(
    `/admin/controllable-assets/${id}`,
  );
}
export async function createControllableAssetApi(
  payload: ControllableAssetPayload,
) {
  return requestClient.post<ControllableAssetItem>(
    '/admin/controllable-assets',
    payload,
  );
}
export async function updateControllableAssetApi(
  id: string,
  payload: Partial<ControllableAssetPayload>,
) {
  return requestClient.put<ControllableAssetItem>(
    `/admin/controllable-assets/${id}`,
    payload,
  );
}
export async function deleteControllableAssetApi(id: string) {
  return requestClient.delete(`/admin/controllable-assets/${id}`);
}

export interface UserControllableAssetItem {
  id: string;
  userId: string;
  user: null | {
    displayName?: null | string;
    id: string;
    username?: null | string;
  };
  productId: null | string;
  product?: null | {
    id: string;
    name: string;
    price: number;
    slug: string;
  };
  controllableAssetId: null | string;
  controllableAsset: null | {
    id: string;
    identifier: string;
    isActive: boolean;
    isDefault: boolean;
    name: string;
    prefabUrl?: string;
    type: ControllableType;
  };
  state: string;
  source: 'admin-assign' | 'order';
  isSelected: boolean;
  acquiredAt: null | string;
  expiresAt: null | string;
  orderId: null | string;
  createdAt: null | string;
  updatedAt: null | string;
}

export interface ListUserControllableAssetsParams {
  keyword?: string;
  userId?: string;
  type?: ControllableType;
  page?: number;
  pageSize?: number;
}

export interface UserControllableAssetPayload {
  userId: string;
  controllableAssetId: string;
}

export async function listUserControllableAssetsApi(
  params: ListUserControllableAssetsParams,
) {
  return normalize(
    await requestClient.get<ServerPageResult<UserControllableAssetItem>>(
      '/admin/user-controllable-assets',
      { params },
    ),
  );
}

export async function createUserControllableAssetApi(
  payload: UserControllableAssetPayload,
) {
  return requestClient.post<UserControllableAssetItem>(
    '/admin/user-controllable-assets',
    payload,
  );
}

export async function deleteUserControllableAssetApi(id: string) {
  return requestClient.delete(
    `/admin/user-controllable-assets/${encodeURIComponent(id)}`,
  );
}
