import { requestClient } from '#/api/request';

export type SkinSlotKey =
  | 'hatAssetId'
  | 'glassesAssetId'
  | 'hairAssetId'
  | 'topAssetId'
  | 'pantsAssetId'
  | 'shoesAssetId';

export interface SkinCategoryItem {
  id: string;
  name: string;
  slotKey: SkinSlotKey;
  sortOrder: number;
  enabled: boolean;
  description: string | null;
  isBuiltin: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function listSkinCategoriesApi() {
  return requestClient.get<SkinCategoryItem[]>('/admin/skin-categories');
}

export async function createSkinCategoryApi(payload: {
  description?: string;
  enabled?: boolean;
  name: string;
  slotKey: SkinSlotKey;
  sortOrder?: number;
}) {
  return requestClient.post<SkinCategoryItem>('/admin/skin-categories', payload);
}

export async function updateSkinCategoryApi(
  id: string,
  payload: {
    description?: null | string;
    enabled?: boolean;
    name?: string;
    sortOrder?: number;
  },
) {
  return requestClient.put<SkinCategoryItem>(`/admin/skin-categories/${encodeURIComponent(id)}`, payload);
}

export async function deleteSkinCategoryApi(id: string) {
  return requestClient.delete(`/admin/skin-categories/${encodeURIComponent(id)}`);
}
