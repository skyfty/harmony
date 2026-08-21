import { requestClient } from '#/api/request';
import type { SkinSlotKey } from './skin-categories';

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
  categoryId: string | null;
  categoryName: string | null;
  slotKey: SkinSlotKey | null;
  sortOrder: number;
  description: string;
  prefabUrl: string;
  isActive: boolean;
  productId: string | null;
  product?: {
    id: string;
    name: string;
    slug: string;
    categoryId: string | null;
    price: number;
  };
  metadata?: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SkinPayload {
  identifier: string;
  name: string;
  categoryId: string;
  sortOrder?: number;
  description?: string;
  prefabUrl?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface ListSkinsParams {
  keyword?: string;
  categoryId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

function normalize(result: ServerPageResult<SkinItem>) {
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
  return requestClient.put<SkinItem>(`/admin/skins/${encodeURIComponent(id)}`, payload);
}

export async function deleteSkinApi(id: string) {
  return requestClient.delete(`/admin/skins/${encodeURIComponent(id)}`);
}
