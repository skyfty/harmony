import type { SkinSlotKey } from './skin-categories';

import { requestClient } from '#/api/request';

interface ServerPageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SkinItem {
  id: string;
  identifier: string;
  name: string;
  categoryId: null | string;
  categoryName: null | string;
  slotKey: null | SkinSlotKey;
  sortOrder: number;
  description: string;
  prefabUrl: string;
  isActive: boolean;
  productId: null | string;
  product?: {
    categoryId: null | string;
    id: string;
    name: string;
    price: number;
    slug: string;
  };
  metadata?: null | Record<string, unknown>;
  createdAt: null | string;
  updatedAt: null | string;
}

export interface SkinPayload {
  identifier: string;
  name: string;
  categoryId: string;
  sortOrder?: number;
  description?: string;
  prefabUrl?: string;
  isActive?: boolean;
  metadata?: null | Record<string, unknown>;
}

export interface ListSkinsParams {
  keyword?: string;
  categoryId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

function normalize<T>(result: ServerPageResult<T>) {
  return { items: result.data || [], total: result.total || 0 };
}

export async function listSkinsApi(params: ListSkinsParams) {
  return normalize(
    await requestClient.get<ServerPageResult<SkinItem>>('/admin/skins', {
      params,
    }),
  );
}

export async function getSkinApi(id: string) {
  return requestClient.get<SkinItem>(`/admin/skins/${encodeURIComponent(id)}`);
}

export async function createSkinApi(payload: SkinPayload) {
  return requestClient.post<SkinItem>('/admin/skins', payload);
}

export async function updateSkinApi(id: string, payload: Partial<SkinPayload>) {
  return requestClient.put<SkinItem>(
    `/admin/skins/${encodeURIComponent(id)}`,
    payload,
  );
}

export async function deleteSkinApi(id: string) {
  return requestClient.delete(`/admin/skins/${encodeURIComponent(id)}`);
}

export interface UserSkinItem {
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
  skinId: null | string;
  skin: null | {
    categoryId: null | string;
    categoryName: null | string;
    id: string;
    identifier: string;
    isActive: boolean;
    name: string;
    prefabUrl: string;
    slotKey: null | SkinSlotKey;
    sortOrder: number;
  };
  state: string;
  source: 'admin-assign' | 'order';
  acquiredAt: null | string;
  expiresAt: null | string;
  orderId: null | string;
  createdAt: null | string;
  updatedAt: null | string;
}

export interface ListUserSkinsParams {
  keyword?: string;
  userId?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
}

export interface UserSkinPayload {
  userId: string;
  skinId: string;
}

export async function listUserSkinsApi(params: ListUserSkinsParams) {
  return normalize(
    await requestClient.get<ServerPageResult<UserSkinItem>>(
      '/admin/user-skins',
      {
        params,
      },
    ),
  );
}

export async function createUserSkinApi(payload: UserSkinPayload) {
  return requestClient.post<UserSkinItem>('/admin/user-skins', payload);
}

export async function deleteUserSkinApi(id: string) {
  return requestClient.delete(`/admin/user-skins/${encodeURIComponent(id)}`);
}
