import { requestClient } from '#/api/request';

export interface SceneSpotCategoryItem {
  id: string;
  name: string;
  parentId: null | string;
  description: null | string;
  slug: null | string;
  sortOrder: number;
  enabled: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listSceneSpotCategoriesApi() {
  return requestClient.get<SceneSpotCategoryItem[]>('/admin/scene-spot-categories');
}

export async function createSceneSpotCategoryApi(payload: {
  description?: null | string;
  enabled?: boolean;
  name: string;
  parentId?: null | string;
  slug?: null | string;
  sortOrder?: number;
}) {
  return requestClient.post<SceneSpotCategoryItem>('/admin/scene-spot-categories', payload);
}

export async function updateSceneSpotCategoryApi(id: string, payload: {
  description?: null | string;
  enabled?: boolean;
  name?: string;
  parentId?: null | string;
  slug?: null | string;
  sortOrder?: number;
}) {
  return requestClient.put<SceneSpotCategoryItem>(`/admin/scene-spot-categories/${encodeURIComponent(id)}`, payload);
}

export async function deleteSceneSpotCategoryApi(id: string) {
  return requestClient.delete(`/admin/scene-spot-categories/${encodeURIComponent(id)}`);
}
